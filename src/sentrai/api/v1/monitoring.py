"""
Module B API — Drift Detection & BCP Fallback (REC 16, 21)
"""

import uuid
from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sentrai.domain.enums import DriftStatus
from sentrai.domain.monitoring import BCPFallbackState, DriftReport, evaluate_drift
from sentrai.infrastructure.database import get_db
from sentrai.infrastructure.orm_models import AIModelORM, DriftReportORM

router = APIRouter(prefix="/monitoring", tags=["Model Monitoring & Drift"])

_bcp_states: dict[uuid.UUID, BCPFallbackState] = {}  # in production: Redis-backed


class DriftEvaluationRequest(BaseModel):
    model_id: uuid.UUID
    training_scores: list[float]
    live_scores: list[float]
    baseline_accuracy: float
    current_accuracy: float


class DriftReportResponse(BaseModel):
    model_id: uuid.UUID
    computed_at: datetime
    psi_score: float
    wasserstein_distance: float
    accuracy_delta: float
    status: DriftStatus
    circuit_breaker_active: bool
    human_review_ticket: str | None
    remediation_action: str | None
    summary: str


class BCPActivateRequest(BaseModel):
    reason: str
    rules_engine_ref: str | None = None
    actor: str


@router.post("/drift/evaluate", response_model=DriftReportResponse)
async def evaluate_model_drift(
    payload: DriftEvaluationRequest,
    db: AsyncSession = Depends(get_db),
) -> DriftReportResponse:
    model = await db.get(AIModelORM, payload.model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    training = np.array(payload.training_scores, dtype=float)
    live = np.array(payload.live_scores, dtype=float)

    report: DriftReport = evaluate_drift(
        model_id=payload.model_id,
        training_scores=training,
        live_scores=live,
        baseline_accuracy=payload.baseline_accuracy,
        current_accuracy=payload.current_accuracy,
    )

    orm = DriftReportORM(
        model_id=payload.model_id,
        computed_at=report.computed_at,
        psi_score=report.psi_score,
        wasserstein_distance=report.wasserstein_distance,
        accuracy_delta=report.accuracy_delta,
        status=report.status.value,
        circuit_breaker_active=report.circuit_breaker_active,
        human_review_ticket=report.human_review_ticket,
        remediation_action=report.remediation_action,
    )
    db.add(orm)

    # Auto-activate BCP if circuit breaker trips
    if report.circuit_breaker_active:
        state = _bcp_states.setdefault(
            payload.model_id, BCPFallbackState(model_id=payload.model_id)
        )
        if not state.fallback_active:
            state.activate(
                reason=f"Circuit breaker: PSI={report.psi_score:.3f}",
                rules_engine_ref="RULES_ENGINE_v2",
            )

    await db.flush()

    return DriftReportResponse(
        model_id=report.model_id,
        computed_at=report.computed_at,
        psi_score=report.psi_score,
        wasserstein_distance=report.wasserstein_distance,
        accuracy_delta=report.accuracy_delta,
        status=report.status,
        circuit_breaker_active=report.circuit_breaker_active,
        human_review_ticket=report.human_review_ticket,
        remediation_action=report.remediation_action,
        summary=report.summary,
    )


@router.get("/drift/{model_id}/history", response_model=list[DriftReportResponse])
async def drift_history(
    model_id: uuid.UUID,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
) -> list[DriftReportResponse]:
    q = (
        select(DriftReportORM)
        .where(DriftReportORM.model_id == model_id)
        .order_by(DriftReportORM.computed_at.desc())
        .limit(limit)
    )
    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        DriftReportResponse(
            model_id=r.model_id,
            computed_at=r.computed_at,
            psi_score=r.psi_score,
            wasserstein_distance=r.wasserstein_distance,
            accuracy_delta=r.accuracy_delta,
            status=DriftStatus(r.status),
            circuit_breaker_active=r.circuit_breaker_active,
            human_review_ticket=r.human_review_ticket,
            remediation_action=r.remediation_action,
            summary=f"[{r.status}] PSI={r.psi_score:.4f}",
        )
        for r in rows
    ]


@router.post("/bcp/{model_id}/activate")
async def activate_bcp(
    model_id: uuid.UUID,
    payload: BCPActivateRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    model = await db.get(AIModelORM, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    state = _bcp_states.setdefault(model_id, BCPFallbackState(model_id=model_id))
    state.activate(reason=payload.reason, rules_engine_ref=payload.rules_engine_ref)

    return {
        "model_id": str(model_id),
        "bcp_active": True,
        "reason": payload.reason,
        "rules_engine": payload.rules_engine_ref,
        "activated_at": state.fallback_activated_at.isoformat() if state.fallback_activated_at else None,
    }


@router.post("/bcp/{model_id}/deactivate")
async def deactivate_bcp(model_id: uuid.UUID) -> dict:
    state = _bcp_states.get(model_id)
    if state:
        state.deactivate()
    return {"model_id": str(model_id), "bcp_active": False}


@router.get("/bcp/{model_id}/status")
async def bcp_status(model_id: uuid.UUID) -> dict:
    state = _bcp_states.get(model_id)
    if not state:
        return {"model_id": str(model_id), "bcp_active": False}
    return {
        "model_id": str(model_id),
        "bcp_active": state.fallback_active,
        "reason": state.fallback_reason,
        "activated_at": state.fallback_activated_at.isoformat() if state.fallback_activated_at else None,
        "rules_engine": state.rules_engine_ref,
        "human_sample_pct": state.human_sample_pct,
    }


@router.get("/gpu/status")
def get_gpu_status() -> dict:
    from sentrai.monitoring.gpu_monitor import GPUMonitorConnector
    return {"gpus": GPUMonitorConnector.get_gpu_utilization()}

