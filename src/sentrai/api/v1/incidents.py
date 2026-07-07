"""
Module D API — AI Incident Reporting & Sectoral Risk Intelligence
REC 22: /api/v1/compliance/incident/report — Annexure VI form endpoint.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from sentrai.api.middleware.dpdp_masking import mask_dict
from sentrai.domain.enums import (
    IncidentCategory,
    IncidentSeverity,
    IncidentStatus,
    RiskLevel,
)
from sentrai.domain.incident import (
    AffectedConsumerSummary,
    AIIncident,
    REPORTING_SLA_HOURS,
)
from sentrai.infrastructure.database import get_db
from sentrai.infrastructure.orm_models import AIIncidentORM

router = APIRouter(prefix="/compliance/incident", tags=["AI Incident Reporting"])


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class AffectedConsumerPayload(BaseModel):
    count: int
    demographic_segment: str | None = None
    harm_type: str
    compensation_provided: bool = False
    compensation_amount_inr: float | None = None


class IncidentReportRequest(BaseModel):
    """Annexure VI — AI Incident Reporting Form fields."""
    model_id: uuid.UUID
    model_name: str
    re_name: str                         # Regulated Entity (bank/NBFC name)
    functional_area: str
    incident_category: IncidentCategory
    severity: IncidentSeverity
    description: str = Field(..., min_length=50)
    observed_at: datetime
    detected_at: datetime
    affected_consumers: AffectedConsumerPayload | None = None
    model_risk_level: RiskLevel
    autonomous_system_involved: bool = False
    immediate_action_taken: str = Field(..., min_length=20)
    system_suspended: bool = False
    fallback_activated: bool = False
    repeat_incident: bool = False
    prior_incident_refs: list[str] = []


class IncidentStatusUpdate(BaseModel):
    status: IncidentStatus
    notes: str = ""
    regulator_notified: bool | None = None
    board_informed: bool | None = None


class IncidentResponse(BaseModel):
    incident_id: uuid.UUID
    severity: IncidentSeverity
    status: IncidentStatus
    reporting_deadline: datetime
    hours_until_deadline: float
    is_overdue: bool
    created_at: datetime

    class Config:
        from_attributes = True


class SectoralRiskSummary(BaseModel):
    total_incidents: int
    by_category: dict[str, int]
    by_severity: dict[str, int]
    overdue_count: int
    circuit_breakers_active: int
    repeat_incident_rate: float


# ── Background: escalation notification ──────────────────────────────────────

async def _notify_escalation(incident_id: uuid.UUID, severity: IncidentSeverity) -> None:
    """
    In production: publishes to Redis Streams / Kafka for downstream
    notification (regulator portal, board SIEM, etc.).
    Stub implementation logs the event.
    """
    import structlog
    log = structlog.get_logger()
    log.warning(
        "incident_escalation_required",
        incident_id=str(incident_id),
        severity=severity.value,
        action="notify_compliance_officer",
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
async def list_incidents(
    severity: IncidentSeverity | None = None,
    status_filter: IncidentStatus | None = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Lists incidents, most recent first — backs the UI incidents table."""
    q = select(AIIncidentORM).order_by(AIIncidentORM.created_at.desc()).limit(limit)
    if severity:
        q = q.where(AIIncidentORM.severity == severity.value)
    if status_filter:
        q = q.where(AIIncidentORM.status == status_filter.value)
    result = await db.execute(q)
    rows = result.scalars().all()
    now = datetime.now(timezone.utc)

    def _overdue(deadline: datetime, reported_at: datetime | None) -> bool:
        if reported_at is not None:
            return False
        d = deadline if deadline.tzinfo else deadline.replace(tzinfo=timezone.utc)
        return d < now

    return [
        {
            "incident_id": str(r.id),
            "model_id": str(r.model_id),
            "model_name": r.model_name,
            "re_name": r.re_name,
            "category": r.incident_category,
            "severity": r.severity,
            "status": r.status,
            "description": r.description,
            "reporting_deadline": r.reporting_deadline.isoformat(),
            "is_overdue": _overdue(r.reporting_deadline, r.reported_at),
            "regulator_notified": r.regulator_notified,
            "system_suspended": r.system_suspended,
            "repeat_incident": r.repeat_incident,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/report", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
async def report_incident(
    payload: IncidentReportRequest,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> IncidentResponse:
    """
    Primary endpoint for AI incident submission (Annexure VI).
    P1/P2 incidents trigger immediate background escalation.
    DPDP masking applied before audit log persistence.
    """
    incident = AIIncident.create(
        model_id=payload.model_id,
        observed_at=payload.observed_at,
        severity=payload.severity,
        model_name=payload.model_name,
        re_name=payload.re_name,
        functional_area=payload.functional_area,
        incident_category=payload.incident_category,
        description=payload.description,
        detected_at=payload.detected_at,
        affected_consumers=AffectedConsumerSummary(**payload.affected_consumers.model_dump())
        if payload.affected_consumers
        else None,
        model_risk_level=payload.model_risk_level,
        autonomous_system_involved=payload.autonomous_system_involved,
        immediate_action_taken=payload.immediate_action_taken,
        system_suspended=payload.system_suspended,
        fallback_activated=payload.fallback_activated,
        repeat_incident=payload.repeat_incident,
        prior_incident_refs=payload.prior_incident_refs,
    )

    consumers_data = None
    if incident.affected_consumers:
        consumers_data = mask_dict(
            {
                "count": incident.affected_consumers.count,
                "demographic_segment": incident.affected_consumers.demographic_segment,
                "harm_type": incident.affected_consumers.harm_type,
                "compensation_provided": incident.affected_consumers.compensation_provided,
                "compensation_amount_inr": incident.affected_consumers.compensation_amount_inr,
            }
        )

    orm = AIIncidentORM(
        id=incident.incident_id,
        model_id=incident.model_id,
        model_name=incident.model_name,
        re_name=incident.re_name,
        functional_area=incident.functional_area,
        incident_category=incident.incident_category.value,
        severity=incident.severity.value,
        status=incident.status.value,
        description=incident.description,
        observed_at=incident.observed_at,
        detected_at=incident.detected_at,
        reported_at=None,
        reporting_deadline=incident.reporting_deadline,
        affected_consumers=consumers_data,
        model_risk_level=incident.model_risk_level.value,
        autonomous_system_involved=incident.autonomous_system_involved,
        immediate_action_taken=incident.immediate_action_taken,
        system_suspended=incident.system_suspended,
        fallback_activated=incident.fallback_activated,
        repeat_incident=incident.repeat_incident,
        prior_incident_refs=incident.prior_incident_refs,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )
    db.add(orm)
    await db.flush()

    if payload.severity in (IncidentSeverity.P1_CRITICAL, IncidentSeverity.P2_HIGH):
        background.add_task(_notify_escalation, incident.incident_id, payload.severity)

    return IncidentResponse(
        incident_id=incident.incident_id,
        severity=incident.severity,
        status=incident.status,
        reporting_deadline=incident.reporting_deadline,
        hours_until_deadline=incident.hours_until_deadline,
        is_overdue=incident.is_overdue,
        created_at=incident.created_at,
    )


@router.patch("/{incident_id}/status")
async def update_incident_status(
    incident_id: uuid.UUID,
    payload: IncidentStatusUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    orm = await db.get(AIIncidentORM, incident_id)
    if not orm:
        raise HTTPException(status_code=404, detail="Incident not found")

    orm.status = payload.status.value
    orm.updated_at = datetime.now(timezone.utc)

    if payload.regulator_notified is not None:
        orm.regulator_notified = payload.regulator_notified
        if payload.regulator_notified:
            orm.reported_at = datetime.now(timezone.utc)

    if payload.board_informed is not None:
        orm.board_informed = payload.board_informed

    return {"incident_id": incident_id, "status": payload.status}


@router.get("/sectoral-risk", response_model=SectoralRiskSummary)
async def sectoral_risk_summary(db: AsyncSession = Depends(get_db)) -> SectoralRiskSummary:
    """
    Sector-wide risk intelligence dashboard (REC 22).
    Anonymised — no RE-level PII exposed in aggregate view.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(select(AIIncidentORM))
    incidents = result.scalars().all()

    by_category: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    overdue = 0
    repeats = 0

    for inc in incidents:
        by_category[inc.incident_category] = by_category.get(inc.incident_category, 0) + 1
        by_severity[inc.severity] = by_severity.get(inc.severity, 0) + 1
        deadline = inc.reporting_deadline
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        if inc.reported_at is None and deadline < now:
            overdue += 1
        if inc.repeat_incident:
            repeats += 1

    total = len(incidents)
    repeat_rate = round(repeats / total, 4) if total else 0.0

    # Circuit breakers active: P1 incidents with system NOT suspended
    circuit_breakers = sum(
        1 for i in incidents
        if i.severity == IncidentSeverity.P1_CRITICAL.value and not i.system_suspended
    )

    return SectoralRiskSummary(
        total_incidents=total,
        by_category=by_category,
        by_severity=by_severity,
        overdue_count=overdue,
        circuit_breakers_active=circuit_breakers,
        repeat_incident_rate=repeat_rate,
    )


@router.get("/{incident_id}", response_model=dict)
async def get_incident(
    incident_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict:
    orm = await db.get(AIIncidentORM, incident_id)
    if not orm:
        raise HTTPException(status_code=404, detail="Incident not found")

    now = datetime.now(timezone.utc)
    deadline = orm.reporting_deadline
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return {
        "incident_id": str(orm.id),
        "model_id": str(orm.model_id),
        "severity": orm.severity,
        "status": orm.status,
        "category": orm.incident_category,
        "reporting_deadline": orm.reporting_deadline.isoformat(),
        "is_overdue": orm.reported_at is None and deadline < now,
        "regulator_notified": orm.regulator_notified,
        "board_informed": orm.board_informed,
        "system_suspended": orm.system_suspended,
        "fallback_activated": orm.fallback_activated,
        "repeat_incident": orm.repeat_incident,
        "created_at": orm.created_at.isoformat(),
    }
