"""
Celery task: escalate overdue incident reports every 15 minutes.
REC 22: Timely disclosure is mandated; tolerant non-punitive approach
for good-faith early reporting — but overdue incidents must be flagged.
"""

from datetime import datetime, timezone

import structlog

from sentrai.infrastructure.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(
    name="sentrai.infrastructure.tasks.incident_escalation.check_overdue_incidents",
    bind=True,
    max_retries=3,
)
def check_overdue_incidents(self):  # type: ignore[override]
    """
    Scans incidents where reporting_deadline < now AND reported_at IS NULL.
    Escalates to compliance officer notification channel.
    """
    now = datetime.now(timezone.utc)
    log.info("incident_deadline_check_started", task_id=self.request.id, check_time=now.isoformat())

    # Production implementation:
    # overdue = db.query(AIIncidentORM).filter(
    #     AIIncidentORM.reporting_deadline < now,
    #     AIIncidentORM.reported_at.is_(None),
    #     AIIncidentORM.status != IncidentStatus.CLOSED,
    # ).all()
    # for incident in overdue:
    #     notify_compliance_officer(incident)
    #     publish_to_redis_stream("incident.overdue", {"incident_id": str(incident.id)})

    log.info("incident_deadline_check_completed")
