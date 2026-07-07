"""
Module D — AI Incident Entity
REC 22: Annexure VI incident reporting form + sectoral risk intelligence.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sentrai.domain.enums import (
    IncidentCategory,
    IncidentSeverity,
    IncidentStatus,
    RiskLevel,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Severity → reporting SLA in hours (per SentrAI Rec 22)
REPORTING_SLA_HOURS: dict[IncidentSeverity, int] = {
    IncidentSeverity.P1_CRITICAL: 6,
    IncidentSeverity.P2_HIGH: 24,
    IncidentSeverity.P3_MEDIUM: 72,
    IncidentSeverity.P4_LOW: 168,  # 7 days
}


@dataclass
class AffectedConsumerSummary:
    """DPDP-compliant summary — no PII stored in incident record."""
    count: int
    demographic_segment: str | None     # e.g. "rural borrowers" — no individual IDs
    harm_type: str                      # "credit_denial", "biased_pricing", etc.
    compensation_provided: bool = False
    compensation_amount_inr: float | None = None


@dataclass
class RootCauseAnalysis:
    rca_completed: bool = False
    root_cause: str = ""
    contributing_factors: list[str] = field(default_factory=list)
    corrective_actions: list[str] = field(default_factory=list)
    preventive_measures: list[str] = field(default_factory=list)
    rca_completed_at: datetime | None = None


@dataclass
class AIIncident:
    """
    Canonical domain entity for Annexure VI AI Incident Report.
    Fields map 1:1 to the RBI SentrAI Indicative Incident Reporting Form.
    """

    incident_id: uuid.UUID
    model_id: uuid.UUID
    model_name: str
    re_name: str                      # Regulated Entity name
    functional_area: str
    incident_category: IncidentCategory
    severity: IncidentSeverity
    status: IncidentStatus
    description: str
    observed_at: datetime             # when the AI failure was first observed
    detected_at: datetime             # when RE detected it
    reported_at: datetime | None      # when reported to regulator
    reporting_deadline: datetime      # computed from severity SLA
    model_risk_level: RiskLevel
    autonomous_system_involved: bool
    immediate_action_taken: str
    affected_consumers: AffectedConsumerSummary | None = None
    system_suspended: bool = False
    fallback_activated: bool = False
    rca: RootCauseAnalysis = field(default_factory=RootCauseAnalysis)
    repeat_incident: bool = False
    prior_incident_refs: list[str] = field(default_factory=list)
    regulator_notified: bool = False
    board_informed: bool = False
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)

    @classmethod
    def create(
        cls,
        model_id: uuid.UUID,
        observed_at: datetime,
        severity: IncidentSeverity,
        **kwargs: Any,
    ) -> "AIIncident":
        from datetime import timedelta

        sla_hours = REPORTING_SLA_HOURS[severity]
        deadline = observed_at + timedelta(hours=sla_hours)

        return cls(
            incident_id=uuid.uuid4(),
            model_id=model_id,
            severity=severity,
            status=IncidentStatus.REPORTED,
            observed_at=observed_at,
            detected_at=kwargs.pop("detected_at", _now()),
            reported_at=None,
            reporting_deadline=deadline,
            created_at=_now(),
            updated_at=_now(),
            **kwargs,
        )

    @property
    def is_overdue(self) -> bool:
        if self.reported_at is not None:
            return False
        return _now() > self.reporting_deadline

    @property
    def hours_until_deadline(self) -> float:
        delta = self.reporting_deadline - _now()
        return delta.total_seconds() / 3600
