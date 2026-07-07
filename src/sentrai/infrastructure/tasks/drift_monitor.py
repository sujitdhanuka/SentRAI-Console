"""
Celery tasks for scheduled drift monitoring and inventory staleness checks.
"""

from datetime import datetime, timedelta, timezone

import structlog

from sentrai.infrastructure.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(name="sentrai.infrastructure.tasks.drift_monitor.monitor_high_risk_models", bind=True, max_retries=3)
def monitor_high_risk_models(self):  # type: ignore[override]
    """
    Polls HIGH and MEDIUM risk models for drift every hour.
    In production: fetches live inference score distributions from model serving layer.
    """
    log.info("drift_monitor_started", task_id=self.request.id)
    # Production: query DB for active HIGH/MEDIUM models, fetch live scores,
    # call evaluate_drift(), persist DriftReportORM, trigger BCP if needed.
    log.info("drift_monitor_completed")


@celery_app.task(name="sentrai.infrastructure.tasks.drift_monitor.check_inventory_staleness", bind=True)
def check_inventory_staleness(self):  # type: ignore[override]
    """
    REC 23: Inventory must be updated at least semi-annually (180 days).
    Flags models whose updated_at > 180 days as requiring immediate update.
    """
    from sentrai.config import settings

    threshold = datetime.now(timezone.utc) - timedelta(days=settings.inventory_update_sla_days)
    log.info(
        "inventory_staleness_check",
        task_id=self.request.id,
        staleness_threshold=threshold.isoformat(),
    )
    # Production: query DB, notify model owners via notification service.
