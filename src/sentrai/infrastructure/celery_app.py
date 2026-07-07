from celery import Celery
from sentrai.config import settings

celery_app = Celery(
    "sentrai",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "sentrai.infrastructure.tasks.drift_monitor",
        "sentrai.infrastructure.tasks.incident_escalation",
        "sentrai.infrastructure.tasks.discovery"
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "drift-monitor-high-risk": {
            "task": "sentrai.infrastructure.tasks.drift_monitor.monitor_high_risk_models",
            "schedule": 3600.0,  # every hour
        },
        "incident-deadline-check": {
            "task": "sentrai.infrastructure.tasks.incident_escalation.check_overdue_incidents",
            "schedule": 900.0,   # every 15 minutes
        },
        "inventory-staleness-check": {
            "task": "sentrai.infrastructure.tasks.drift_monitor.check_inventory_staleness",
            "schedule": 86400.0, # daily
        },
        "periodic-project-codebase-scans": {
            "task": "sentrai.infrastructure.tasks.discovery.run_periodic_scans",
            "schedule": 86400.0, # daily
        },
    },
)
