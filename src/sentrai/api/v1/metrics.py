from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sentrai.infrastructure.database import get_db
from sentrai.infrastructure.orm_models import AIModelORM, DriftReportORM
from sentrai.compliance.frameworks_validator import validate_nist_rmf, validate_eu_ai_act, validate_iso_42001
from sentrai.infrastructure.repositories.model_repository import SQLAlchemyAIModelRepository

router = APIRouter(tags=["Metrics"])

@router.get("/metrics", response_class=PlainTextResponse)
async def get_metrics(db: AsyncSession = Depends(get_db)):
    models_result = await db.execute(select(AIModelORM).where(AIModelORM.is_active == True))
    models_list = models_result.scalars().all()
    total_models = len(models_list)
    
    repo = SQLAlchemyAIModelRepository(db)
    compliant_count = 0
    total_gaps = 0
    
    for orm in models_list:
        entry = repo._orm_to_entry(orm)
        nist_report = validate_nist_rmf(entry)
        eu_report = validate_eu_ai_act(entry)
        iso_report = validate_iso_42001(entry)
        
        gaps_count = len(nist_report.blocking_gaps) + len(eu_report.blocking_gaps) + len(iso_report.blocking_gaps)
        total_gaps += gaps_count
        if gaps_count == 0:
            compliant_count += 1
            
    drift_result = await db.execute(
        select(DriftReportORM)
        .order_by(DriftReportORM.model_id, DriftReportORM.computed_at.desc())
    )
    latest_drift_statuses = {}
    for dr in drift_result.scalars().all():
        if dr.model_id not in latest_drift_statuses:
            latest_drift_statuses[dr.model_id] = dr.status
    
    drift_alerts_count = sum(1 for status in latest_drift_statuses.values() if status in ("warning", "drift"))

    lines = [
        "# HELP sentrai_models_total Total number of registered models.",
        "# TYPE sentrai_models_total gauge",
        f"sentrai_models_total {total_models}",
        "# HELP sentrai_compliant_models_total Total number of fully compliant models.",
        "# TYPE sentrai_compliant_models_total gauge",
        f"sentrai_compliant_models_total {compliant_count}",
        "# HELP sentrai_open_governance_gaps Total number of outstanding regulatory framework gaps.",
        "# TYPE sentrai_open_governance_gaps gauge",
        f"sentrai_open_governance_gaps {total_gaps}",
        "# HELP sentrai_drift_alerts_total Total number of models with warnings or active drift.",
        "# TYPE sentrai_drift_alerts_total gauge",
        f"sentrai_drift_alerts_total {drift_alerts_count}"
    ]
    return "\n".join(lines) + "\n"
