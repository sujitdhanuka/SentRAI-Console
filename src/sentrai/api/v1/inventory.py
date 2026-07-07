"""
Module A API — AI Model Inventory & Risk Triage (REC 23, 16)
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sentrai.compliance.sutras_validator import validate_sutras_compliance
from sentrai.domain.enums import ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment
from sentrai.domain.model_inventory import AIModelEntry, triage_ai_model
from sentrai.api.middleware.auth import get_required_user
from sentrai.domain.user import Role, User
from sentrai.infrastructure.database import get_db
from sentrai.infrastructure.orm_models import AIModelORM, ModelLedgerEventORM
from sentrai.infrastructure.repositories.model_repository import SQLAlchemyAIModelRepository

router = APIRouter(prefix="/inventory", tags=["AI Model Inventory"])


# ── Pydantic schemas ────────────────────────────────────────────────────────

class ModelRegisterRequest(BaseModel):
    name: str
    model_type: ModelType
    functional_area: str
    use_case_description: str
    target_customer_segments: list[str] = []
    owner_team: str = "UNASSIGNED"
    developed_by: str = "unknown"
    deployment_date: datetime | None = None
    dependencies: list[dict[str, Any]] = []
    performance_benchmarks: list[dict[str, Any]] = []
    sutras_alignment: list[SutraAlignment] = []
    human_oversight_required: bool = True
    autonomous_scope: str | None = None
    board_policy_ref: str = ""
    last_red_team_date: datetime | None = None
    next_audit_due: datetime | None = None
    source_ref: str | None = None  # repo-relative file path, set by codebase discovery
    project_id: uuid.UUID | None = None


class ModelResponse(BaseModel):
    model_id: uuid.UUID
    name: str
    risk_level: RiskLevel
    triaged_risk_level: RiskLevel
    lifecycle_stage: ModelLifecycleStage
    human_oversight_required: bool
    source_ref: str | None = None
    project_id: uuid.UUID | None = None
    registered_at: datetime
    compliance_pass: bool = False
    open_gap_count: int = 0
    use_case_description: str | None = None
    owner_team: str | None = None
    board_policy_ref: str | None = None
    autonomous_scope: str | None = None
    last_red_team_date: datetime | None = None
    sutras_alignment: list[str] = []

    class Config:
        from_attributes = True


class LifecycleUpdateRequest(BaseModel):
    stage: ModelLifecycleStage
    actor: str
    notes: str = ""


class GrievanceUpdateRequest(BaseModel):
    count_delta: int = 1
    resolution_notes: str


class GovernanceUpdateRequest(BaseModel):
    """
    Fields a human reviewer fills in to close the gaps flagged by codebase
    discovery (or left blank at manual registration) — owner, policy
    reference, oversight posture, sutras declared, and red-team history.
    Re-triages risk and re-runs the Sutras compliance check after saving.
    """
    owner_team: str | None = None
    board_policy_ref: str | None = None
    human_oversight_required: bool | None = None
    autonomous_scope: str | None = None
    sutras_alignment: list[SutraAlignment] | None = None
    last_red_team_date: datetime | None = None
    use_case_description: str | None = None
    actor: str = "dashboard_user"


def _orm_to_entry(orm: AIModelORM) -> AIModelEntry:
    """Reconstructs a domain AIModelEntry from a persisted row, for re-triage/validation."""
    return AIModelEntry(
        model_id=orm.id,
        name=orm.name,
        model_type=ModelType(orm.model_type),
        functional_area=orm.functional_area,
        use_case_description=orm.use_case_description,
        target_customer_segments=orm.target_customer_segments,
        risk_level=RiskLevel(orm.risk_level),
        lifecycle_stage=ModelLifecycleStage(orm.lifecycle_stage),
        owner_team=orm.owner_team,
        developed_by=orm.developed_by,
        deployment_date=orm.deployment_date,
        dependencies=[],
        performance_benchmarks=[],
        sutras_alignment=[SutraAlignment(s) for s in (orm.sutras_alignment or [])],
        human_oversight_required=orm.human_oversight_required,
        autonomous_scope=orm.autonomous_scope,
        board_policy_ref=orm.board_policy_ref,
        last_red_team_date=orm.last_red_team_date,
        next_audit_due=orm.next_audit_due,
        grievance_count=orm.grievance_count,
        grievance_resolution_notes=orm.grievance_resolution_notes,
        source_ref=orm.source_ref,
        registered_at=orm.registered_at,
        updated_at=orm.updated_at,
        is_active=orm.is_active,
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/models", response_model=ModelResponse, status_code=status.HTTP_201_CREATED)
async def register_model(
    payload: ModelRegisterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_required_user),
) -> ModelResponse:
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Global Admins cannot register models. Must be a tenant user.")
    # Check for duplicates in the same project
    existing = await db.execute(
        select(AIModelORM).where(
            AIModelORM.name == payload.name,
            AIModelORM.project_id == payload.project_id,
            AIModelORM.is_active.is_(True),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A model named '{payload.name}' already exists in this project.",
        )

    entry = AIModelEntry.create(
        name=payload.name,
        model_type=payload.model_type,
        functional_area=payload.functional_area,
        use_case_description=payload.use_case_description,
        target_customer_segments=payload.target_customer_segments,
        risk_level=RiskLevel.LOW,           # will be overridden by triage
        lifecycle_stage=ModelLifecycleStage.DESIGN,
        owner_team=payload.owner_team,
        developed_by=payload.developed_by,
        deployment_date=payload.deployment_date,
        dependencies=payload.dependencies,
        performance_benchmarks=payload.performance_benchmarks,
        sutras_alignment=payload.sutras_alignment,
        human_oversight_required=payload.human_oversight_required,
        autonomous_scope=payload.autonomous_scope,
        board_policy_ref=payload.board_policy_ref,
        last_red_team_date=payload.last_red_team_date,
        next_audit_due=payload.next_audit_due,
        source_ref=payload.source_ref,
        project_id=payload.project_id,
    )
    triaged = triage_ai_model(entry)
    entry.risk_level = triaged

    repo = SQLAlchemyAIModelRepository(db)
    await repo.save(entry)

    ledger = ModelLedgerEventORM(
        model_id=entry.model_id,
        event_type="MODEL_REGISTERED",
        event_data={
            "triaged_risk_level": triaged.value,
            "functional_area": entry.functional_area,
            **({"source_ref": entry.source_ref} if entry.source_ref else {}),
        },
        actor="system",
        occurred_at=entry.registered_at,
    )
    db.add(ledger)
    await db.flush()

    # Reload from database to ensure formatting matches
    orm = await db.get(AIModelORM, entry.model_id)
    report = validate_sutras_compliance(_orm_to_entry(orm))
    return ModelResponse(
        model_id=orm.id,
        name=orm.name,
        risk_level=RiskLevel(orm.risk_level),
        triaged_risk_level=triaged,
        lifecycle_stage=ModelLifecycleStage(orm.lifecycle_stage),
        human_oversight_required=orm.human_oversight_required,
        source_ref=orm.source_ref,
        project_id=orm.project_id,
        registered_at=orm.registered_at,
        compliance_pass=report.overall_pass,
        open_gap_count=len(report.blocking_gaps),
        use_case_description=orm.use_case_description,
        owner_team=orm.owner_team,
        board_policy_ref=orm.board_policy_ref,
        autonomous_scope=orm.autonomous_scope,
        last_red_team_date=orm.last_red_team_date,
        sutras_alignment=orm.sutras_alignment or [],
    )


@router.get("/models", response_model=list[ModelResponse])
async def list_models(
    risk_level: RiskLevel | None = None,
    project_id: uuid.UUID | None = None,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_required_user),
) -> list[ModelResponse]:
    repo = SQLAlchemyAIModelRepository(db)
    tenant_id = None if current_user.role == Role.ADMIN else current_user.tenant_id
    models = await repo.list_all(active_only=active_only, risk_level=risk_level, project_id=project_id, tenant_id=tenant_id)
    responses = []
    for m in models:
        orm = await db.get(AIModelORM, m.model_id)
        report = validate_sutras_compliance(_orm_to_entry(orm))
        responses.append(ModelResponse(
            model_id=orm.id,
            name=orm.name,
            risk_level=RiskLevel(orm.risk_level),
            triaged_risk_level=RiskLevel(orm.risk_level),
            lifecycle_stage=ModelLifecycleStage(orm.lifecycle_stage),
            human_oversight_required=orm.human_oversight_required,
            source_ref=orm.source_ref,
            project_id=orm.project_id,
            registered_at=orm.registered_at,
            compliance_pass=report.overall_pass,
            open_gap_count=len(report.blocking_gaps),
            use_case_description=orm.use_case_description,
            owner_team=orm.owner_team,
            board_policy_ref=orm.board_policy_ref,
            autonomous_scope=orm.autonomous_scope,
            last_red_team_date=orm.last_red_team_date,
            sutras_alignment=orm.sutras_alignment or [],
        ))
    return responses


@router.patch("/models/{model_id}/lifecycle")
async def update_lifecycle(
    model_id: uuid.UUID,
    payload: LifecycleUpdateRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    orm = await db.get(AIModelORM, model_id)
    if not orm:
        raise HTTPException(status_code=404, detail="Model not found")

    prev_stage = orm.lifecycle_stage
    orm.lifecycle_stage = payload.stage.value
    orm.updated_at = datetime.now(timezone.utc)

    ledger = ModelLedgerEventORM(
        model_id=model_id,
        event_type="LIFECYCLE_UPDATED",
        event_data={"from": prev_stage, "to": payload.stage.value, "notes": payload.notes},
        actor=payload.actor,
        occurred_at=datetime.now(timezone.utc),
    )
    db.add(ledger)

    return {"model_id": model_id, "stage": payload.stage, "actor": payload.actor}


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_model(
    model_id: uuid.UUID,
    permanent: bool = False,
    actor: str = "dashboard_user",
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Removes a model from the active inventory — typically used to discard a
    discovery false-positive (e.g. a settings/UI file flagged by a loose
    pattern match rather than an actual model). Soft-deletes by default
    (is_active=False, kept for audit history); pass permanent=true to hard
    delete the row and its ledger trail entirely.
    """
    orm = await db.get(AIModelORM, model_id)
    if not orm:
        raise HTTPException(status_code=404, detail="Model not found")

    if permanent:
        await db.execute(
            ModelLedgerEventORM.__table__.delete().where(ModelLedgerEventORM.model_id == model_id)
        )
        await db.delete(orm)
    else:
        orm.is_active = False
        orm.updated_at = datetime.now(timezone.utc)
        db.add(ModelLedgerEventORM(
            model_id=model_id,
            event_type="MODEL_DEACTIVATED",
            event_data={"reason": "removed_via_dashboard"},
            actor=actor,
            occurred_at=orm.updated_at,
        ))

    await db.flush()


@router.patch("/models/{model_id}/grievances")
async def record_grievance(
    model_id: uuid.UUID,
    payload: GrievanceUpdateRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    orm = await db.get(AIModelORM, model_id)
    if not orm:
        raise HTTPException(status_code=404, detail="Model not found")

    orm.grievance_count += payload.count_delta
    orm.grievance_resolution_notes = payload.resolution_notes
    orm.updated_at = datetime.now(timezone.utc)

    ledger = ModelLedgerEventORM(
        model_id=model_id,
        event_type="GRIEVANCE_RECORDED",
        event_data={"delta": payload.count_delta, "total": orm.grievance_count},
        actor="system",
        occurred_at=datetime.now(timezone.utc),
    )
    db.add(ledger)

    return {"model_id": model_id, "grievance_count": orm.grievance_count}


@router.patch("/models/{model_id}/governance")
async def update_governance(
    model_id: uuid.UUID,
    payload: GovernanceUpdateRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Closes governance gaps on an existing model — typically used to complete
    a model imported via codebase discovery. Only provided fields are
    changed; risk is re-triaged and the Sutras compliance report is
    recomputed against the updated record.
    """
    orm = await db.get(AIModelORM, model_id)
    if not orm:
        raise HTTPException(status_code=404, detail="Model not found")

    changes: dict[str, Any] = {}
    if payload.owner_team is not None:
        changes["owner_team"] = (orm.owner_team, payload.owner_team)
        orm.owner_team = payload.owner_team
    if payload.board_policy_ref is not None:
        changes["board_policy_ref"] = (orm.board_policy_ref, payload.board_policy_ref)
        orm.board_policy_ref = payload.board_policy_ref
    if payload.human_oversight_required is not None:
        changes["human_oversight_required"] = (orm.human_oversight_required, payload.human_oversight_required)
        orm.human_oversight_required = payload.human_oversight_required
    if payload.autonomous_scope is not None:
        changes["autonomous_scope"] = (orm.autonomous_scope, payload.autonomous_scope)
        orm.autonomous_scope = payload.autonomous_scope
    if payload.sutras_alignment is not None:
        changes["sutras_alignment"] = (orm.sutras_alignment, [s.value for s in payload.sutras_alignment])
        orm.sutras_alignment = [s.value for s in payload.sutras_alignment]
    if payload.last_red_team_date is not None:
        changes["last_red_team_date"] = (str(orm.last_red_team_date), str(payload.last_red_team_date))
        orm.last_red_team_date = payload.last_red_team_date
    if payload.use_case_description is not None:
        orm.use_case_description = payload.use_case_description

    orm.updated_at = datetime.now(timezone.utc)

    # Re-triage with updated facts — closing gaps can raise or lower risk
    # (e.g. declaring autonomous_scope without oversight escalates risk).
    entry = _orm_to_entry(orm)
    new_risk = triage_ai_model(entry)
    if new_risk != RiskLevel(orm.risk_level):
        changes["risk_level"] = (orm.risk_level, new_risk.value)
        orm.risk_level = new_risk.value

    if changes:
        db.add(ModelLedgerEventORM(
            model_id=model_id,
            event_type="GOVERNANCE_UPDATED",
            event_data={k: {"from": v[0], "to": v[1]} for k, v in changes.items()},
            actor=payload.actor,
            occurred_at=orm.updated_at,
        ))

    entry = _orm_to_entry(orm)
    report = validate_sutras_compliance(entry)
    
    from sentrai.compliance.frameworks_validator import validate_nist_rmf, validate_eu_ai_act, validate_iso_42001
    nist = validate_nist_rmf(entry)
    eu = validate_eu_ai_act(entry)
    iso = validate_iso_42001(entry)
    
    comp_dict = report.as_dict()
    comp_dict["nist_rmf"] = nist.as_dict()
    comp_dict["eu_ai_act"] = eu.as_dict()
    comp_dict["iso_42001"] = iso.as_dict()

    return {
        "model_id": str(model_id),
        "risk_level": orm.risk_level,
        "fields_changed": list(changes.keys()),
        "compliance": comp_dict,
    }


@router.get("/models/{model_id}/compliance-check")
async def compliance_check(
    model_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Live compliance report for a model against RBI FREE-AI, NIST AI RMF, and EU AI Act.
    """
    orm = await db.get(AIModelORM, model_id)
    if not orm:
        raise HTTPException(status_code=404, detail="Model not found")

    entry = _orm_to_entry(orm)
    report = validate_sutras_compliance(entry)
    
    # Import and compute other frameworks
    from sentrai.compliance.frameworks_validator import validate_nist_rmf, validate_eu_ai_act, validate_iso_42001
    nist = validate_nist_rmf(entry)
    eu = validate_eu_ai_act(entry)
    iso = validate_iso_42001(entry)
    
    res = report.as_dict()
    res["nist_rmf"] = nist.as_dict()
    res["eu_ai_act"] = eu.as_dict()
    res["iso_42001"] = iso.as_dict()
    return res


@router.get("/models/{model_id}/ledger")
async def get_ledger(
    model_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    q = (
        select(ModelLedgerEventORM)
        .where(ModelLedgerEventORM.model_id == model_id)
        .order_by(ModelLedgerEventORM.occurred_at)
    )
    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        {
            "event_id": str(r.id),
            "event_type": r.event_type,
            "event_data": r.event_data,
            "actor": r.actor,
            "occurred_at": r.occurred_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/models/{model_id}/export-pdf")
async def export_pdf(
    model_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Generates and downloads a compliance audit report as a PDF.
    """
    from fastapi import Response
    from sentrai.compliance.pdf_generator import generate_compliance_pdf
    
    orm = await db.get(AIModelORM, model_id)
    if not orm:
        raise HTTPException(status_code=404, detail="Model not found")

    entry = _orm_to_entry(orm)
    pdf_bytes = generate_compliance_pdf(entry)
    
    headers = {
        "Content-Disposition": f"attachment; filename=sentrai-compliance-{model_id}.pdf"
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)

