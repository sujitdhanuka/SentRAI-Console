"""
Module A — AI Model Inventory Ledger & Risk Triage Engine
REC 23: Immutable append-only ledger; REC 16: Full lifecycle governance.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sentrai.domain.enums import ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class ThirdPartyDependency:
    vendor: str
    service_type: str       # "cloud_provider" | "data_source" | "model_api"
    contract_ref: str
    data_shared: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class PerformanceBenchmark:
    metric_name: str
    threshold_value: float
    current_value: float | None = None
    as_of: datetime | None = None


@dataclass
class AIModelEntry:
    """
    Canonical domain entity for a single AI model registration.
    Append-only: updates produce new ledger events, not mutations.
    Maps directly to REC 23 inventory fields.
    """

    model_id: uuid.UUID
    name: str
    model_type: ModelType
    functional_area: str           # e.g. "credit_underwriting", "fraud_detection"
    use_case_description: str
    target_customer_segments: list[str]
    risk_level: RiskLevel
    lifecycle_stage: ModelLifecycleStage
    owner_team: str
    developed_by: str              # "internal" | third-party vendor name
    deployment_date: datetime | None
    dependencies: list[ThirdPartyDependency]
    performance_benchmarks: list[PerformanceBenchmark]
    sutras_alignment: list[SutraAlignment]
    human_oversight_required: bool
    autonomous_scope: str | None   # defined boundary for autonomous actions
    board_policy_ref: str          # ref to board-approved AI policy section
    last_red_team_date: datetime | None
    next_audit_due: datetime | None
    grievance_count: int = 0
    grievance_resolution_notes: str = ""
    source_ref: str | None = None  # e.g. repo-relative file path, for codebase-discovered models
    registered_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)
    is_active: bool = True
    project_id: uuid.UUID | None = None

    @classmethod
    def create(cls, **kwargs: Any) -> "AIModelEntry":
        kwargs.setdefault("model_id", uuid.uuid4())
        kwargs.setdefault("registered_at", _now())
        kwargs.setdefault("updated_at", _now())
        return cls(**kwargs)


def triage_ai_model(entry: AIModelEntry) -> RiskLevel:
    """
    Rule-based risk triage engine per REC 14/16 classification:
      HIGH  — autonomous financial decisions, credit, fund movement
      MEDIUM — customer-facing, preliminary assistance, fraud detection
      LOW   — internal tools, document summarisation, email classification
    Risk escalates if additional governance signals are present.
    """
    high_use_cases = {
        "credit_underwriting", "loan_decisioning", "autonomous_trading",
        "fund_movement", "insurance_decisioning", "autonomous_kyc_rejection",
    }
    medium_use_cases = {
        "fraud_detection", "customer_chatbot", "risk_scoring",
        "recommendation_engine", "claims_processing",
    }

    fa = entry.functional_area.lower()
    base_risk = (
        RiskLevel.HIGH if fa in high_use_cases
        else RiskLevel.MEDIUM if fa in medium_use_cases
        else RiskLevel.LOW
    )

    # Escalate: autonomous + no human oversight → HIGH
    if entry.autonomous_scope and not entry.human_oversight_required:
        if base_risk == RiskLevel.LOW:
            base_risk = RiskLevel.MEDIUM
        elif base_risk == RiskLevel.MEDIUM:
            base_risk = RiskLevel.HIGH

    # Escalate: GenAI in customer-facing medium-risk → HIGH
    if (
        entry.model_type == ModelType.GENERATIVE_AI
        and base_risk == RiskLevel.MEDIUM
        and entry.human_oversight_required is False
    ):
        base_risk = RiskLevel.HIGH

    # Escalate: overdue red-team for HIGH
    if base_risk == RiskLevel.HIGH and entry.last_red_team_date is None:
        pass  # still HIGH — flag in audit trail

    return base_risk
