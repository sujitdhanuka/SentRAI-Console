"""
Module C API — AI Audit Framework & Explainability (REC 24)
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from sentrai.domain.audit import (
    AuditFinding,
    ExplainabilityRecord,
    generate_audit_trail_payload,
)
from sentrai.domain.enums import AuditType, RiskLevel, SutraAlignment
from sentrai.infrastructure.database import get_db
from sentrai.infrastructure.orm_models import AIAuditTrailORM, AIModelORM

router = APIRouter(prefix="/audit", tags=["AI Audit Framework"])


class AuditChecklistPayload(BaseModel):
    auditor_ref: str
    audit_type: AuditType
    audit_period_days: int = 180
    # Dimension 1 — Data
    training_data_bias_checked: bool = False
    data_consent_verified: bool = False
    data_sources_documented: bool = False
    sensitive_attributes_excluded: bool = False
    # Dimension 2 — Model
    model_architecture_reviewed: bool = False
    decision_logic_documented: bool = False
    adversarial_robustness_tested: bool = False
    performance_benchmarks_met: bool = False
    # Dimension 3 — Output
    fairness_metrics: dict[str, float] = Field(default_factory=dict)
    explainability_score: float = 0.0
    bcp_verified: bool = False
    human_override_tested: bool = False
    # 7 Sutras
    trust_verified: bool = False
    human_oversight_verified: bool = False
    innovation_not_stifled: bool = True
    fairness_metrics_passed: bool = False
    accountability_chain_documented: bool = False
    explainability_verified: bool = False


class AuditFindingPayload(BaseModel):
    category: str
    severity: str  # "critical" | "major" | "minor" | "observation"
    description: str
    sutra_violated: SutraAlignment | None = None
    remediation_required: bool = True
    remediation_deadline_days: int | None = None


class ExplainabilityPayload(BaseModel):
    decision_ref: str
    top_features: dict[str, float]
    decision_outcome: str
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    explanation_method: str = "SHAP"
    human_readable_summary: str
    is_contestable: bool = True


class AuditResponse(BaseModel):
    audit_id: uuid.UUID
    model_id: uuid.UUID
    overall_verdict: str
    sutras_compliance: dict[str, bool]
    explainability_score: float
    next_audit_due: datetime | None
    created_at: datetime


@router.get("/models/{model_id}/audits")
async def list_audits(
    model_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Lists past audit trails for a model — backs the UI audit history view."""
    from sqlalchemy import select as sa_select

    q = (
        sa_select(AIAuditTrailORM)
        .where(AIAuditTrailORM.model_id == model_id)
        .order_by(AIAuditTrailORM.created_at.desc())
    )
    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        {
            "audit_id": str(r.id),
            "audit_type": r.audit_type,
            "auditor_ref": r.auditor_ref,
            "risk_level": r.risk_level,
            "overall_verdict": r.overall_verdict,
            "explainability_score": r.explainability_score,
            "sutras_compliance": r.sutras_compliance,
            "findings": r.findings,
            "next_audit_due": r.next_audit_due.isoformat() if r.next_audit_due else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/models/{model_id}/initiate", response_model=AuditResponse, status_code=status.HTTP_201_CREATED)
async def initiate_audit(
    model_id: uuid.UUID,
    payload: AuditChecklistPayload,
    db: AsyncSession = Depends(get_db),
) -> AuditResponse:
    model = await db.get(AIModelORM, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    now = datetime.now(timezone.utc)
    period_start = now - timedelta(days=payload.audit_period_days)

    trail = generate_audit_trail_payload(
        model_id=model_id,
        audit_type=payload.audit_type,
        auditor_ref=payload.auditor_ref,
        risk_level=RiskLevel(model.risk_level),
        audit_period_start=period_start,
        audit_period_end=now,
        **payload.model_dump(exclude={"auditor_ref", "audit_type", "audit_period_days"}),
    )

    # Next audit due: HIGH = 6 months, MEDIUM = 12 months, LOW = 24 months
    audit_intervals = {RiskLevel.HIGH: 180, RiskLevel.MEDIUM: 365, RiskLevel.LOW: 730}
    days_to_next = audit_intervals[RiskLevel(model.risk_level)]
    trail.next_audit_due = now + timedelta(days=days_to_next)

    # With no findings yet, verdict reflects whether the checklist itself
    # was satisfied; subsequent add_finding() calls can only downgrade it.
    checklist_dimensions = [
        trail.training_data_bias_checked, trail.data_consent_verified,
        trail.data_sources_documented, trail.sensitive_attributes_excluded,
        trail.model_architecture_reviewed, trail.decision_logic_documented,
        trail.adversarial_robustness_tested, trail.performance_benchmarks_met,
        trail.bcp_verified, trail.human_override_tested,
    ]
    sutras_passed = all(trail.sutras_compliance.values())
    trail.overall_verdict = "COMPLIANT" if (any(checklist_dimensions) and sutras_passed) else "CONDITIONAL"

    orm = AIAuditTrailORM(
        id=trail.audit_id,
        model_id=trail.model_id,
        audit_type=trail.audit_type.value,
        auditor_ref=trail.auditor_ref,
        risk_level=trail.risk_level.value,
        audit_period_start=trail.audit_period_start,
        audit_period_end=trail.audit_period_end,
        input_data_audit={
            "bias_checked": trail.training_data_bias_checked,
            "consent_verified": trail.data_consent_verified,
            "sources_documented": trail.data_sources_documented,
            "sensitive_excluded": trail.sensitive_attributes_excluded,
        },
        model_algo_audit={
            "architecture_reviewed": trail.model_architecture_reviewed,
            "logic_documented": trail.decision_logic_documented,
            "adversarial_tested": trail.adversarial_robustness_tested,
            "benchmarks_met": trail.performance_benchmarks_met,
        },
        output_behaviour_audit={
            "bcp_verified": trail.bcp_verified,
            "human_override_tested": trail.human_override_tested,
        },
        fairness_metrics=trail.fairness_metrics,
        explainability_score=trail.explainability_score,
        sutras_compliance=trail.sutras_compliance,
        findings=[],
        overall_verdict=trail.overall_verdict,
        next_audit_due=trail.next_audit_due,
        created_at=trail.created_at,
    )
    db.add(orm)

    # Update model's next_audit_due
    model.next_audit_due = trail.next_audit_due
    model.updated_at = now

    await db.flush()

    return AuditResponse(
        audit_id=trail.audit_id,
        model_id=trail.model_id,
        overall_verdict=trail.overall_verdict,
        sutras_compliance=trail.sutras_compliance,
        explainability_score=trail.explainability_score,
        next_audit_due=trail.next_audit_due,
        created_at=trail.created_at,
    )


@router.post("/models/{model_id}/findings/{audit_id}")
async def add_audit_finding(
    model_id: uuid.UUID,
    audit_id: uuid.UUID,
    payload: AuditFindingPayload,
    db: AsyncSession = Depends(get_db),
) -> dict:
    orm = await db.get(AIAuditTrailORM, audit_id)
    if not orm or orm.model_id != model_id:
        raise HTTPException(status_code=404, detail="Audit not found")

    finding = {
        "finding_id": str(uuid.uuid4()),
        "category": payload.category,
        "severity": payload.severity,
        "description": payload.description,
        "sutra_violated": payload.sutra_violated.value if payload.sutra_violated else None,
        "remediation_required": payload.remediation_required,
        "remediation_deadline": (
            (datetime.now(timezone.utc) + timedelta(days=payload.remediation_deadline_days)).isoformat()
            if payload.remediation_deadline_days
            else None
        ),
        "remediation_status": "OPEN",
    }

    findings = list(orm.findings or [])
    findings.append(finding)
    orm.findings = findings

    criticals = [f for f in findings if f["severity"] == "critical"]
    majors    = [f for f in findings if f["severity"] == "major"]
    if criticals:
        orm.overall_verdict = "NON_COMPLIANT"
    elif majors:
        orm.overall_verdict = "CONDITIONAL"

    return {"audit_id": audit_id, "finding_id": finding["finding_id"], "verdict": orm.overall_verdict}


@router.post("/explainability/record")
async def record_explainability(payload: ExplainabilityPayload) -> dict:
    """
    Accepts per-decision SHAP/LIME explainability payloads.
    Stored in audit log (not DB) — suitable for integration with SIEM.
    """
    import structlog
    log = structlog.get_logger()
    record = ExplainabilityRecord(
        decision_ref=payload.decision_ref,
        model_id=uuid.uuid4(),  # linked by decision_ref in production
        top_features=payload.top_features,
        decision_outcome=payload.decision_outcome,
        confidence_score=payload.confidence_score,
        explanation_method=payload.explanation_method,
        human_readable_summary=payload.human_readable_summary,
        is_contestable=payload.is_contestable,
    )
    log.info(
        "explainability_recorded",
        decision_ref=record.decision_ref,
        outcome=record.decision_outcome,
        top_feature=max(record.top_features, key=record.top_features.get) if record.top_features else None,
        contestable=record.is_contestable,
    )
    return {
        "decision_ref": record.decision_ref,
        "outcome": record.decision_outcome,
        "confidence": record.confidence_score,
        "is_contestable": record.is_contestable,
        "generated_at": record.generated_at.isoformat(),
    }
