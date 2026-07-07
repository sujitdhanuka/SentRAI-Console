"""
Module C — AI Audit Framework & Explainability Hooks
REC 24: Risk-based audit (input data, model/algorithm, output/behaviour).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sentrai.domain.enums import AuditType, RiskLevel, SutraAlignment


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class ExplainabilityRecord:
    """
    Per-decision explainability hook (Sutra 6: Understandable by Design).
    Stores top feature importances / LIME/SHAP outputs without raw PII.
    """
    decision_ref: str
    model_id: uuid.UUID
    top_features: dict[str, float]   # feature_name → importance_score
    decision_outcome: str            # "APPROVED" | "REJECTED" | "REFERRED"
    confidence_score: float
    explanation_method: str          # "SHAP" | "LIME" | "RULE_TRACE"
    human_readable_summary: str
    is_contestable: bool = True      # customers can challenge (REC 18)
    generated_at: datetime = field(default_factory=_now)


@dataclass
class AuditFinding:
    finding_id: str
    category: str                   # "bias", "drift", "data_quality", "explainability"
    severity: str                   # "critical" | "major" | "minor" | "observation"
    description: str
    sutra_violated: SutraAlignment | None
    remediation_required: bool
    remediation_deadline: datetime | None
    remediation_status: str = "OPEN"


@dataclass
class AIAuditTrail:
    """
    Immutable audit record produced by generate_audit_trail_payload().
    Covers all three audit dimensions from REC 24.
    """
    audit_id: uuid.UUID
    model_id: uuid.UUID
    audit_type: AuditType
    auditor_ref: str                 # internal team or third-party firm name
    risk_level: RiskLevel
    audit_period_start: datetime
    audit_period_end: datetime

    # Dimension 1: Input Data Audit
    training_data_bias_checked: bool
    data_consent_verified: bool      # DPDP Act compliance
    data_sources_documented: bool
    sensitive_attributes_excluded: bool

    # Dimension 2: Model & Algorithm Audit
    model_architecture_reviewed: bool
    decision_logic_documented: bool
    adversarial_robustness_tested: bool
    performance_benchmarks_met: bool

    # Dimension 3: Output & Behaviour Audit
    fairness_metrics: dict[str, float]  # e.g. {"demographic_parity": 0.97}
    explainability_score: float         # 0-1; 1 = fully explainable
    bcp_verified: bool
    human_override_tested: bool

    sutras_compliance: dict[str, bool]  # sutra_name → compliant
    findings: list[AuditFinding] = field(default_factory=list)
    overall_verdict: str = "PENDING"    # "COMPLIANT" | "CONDITIONAL" | "NON_COMPLIANT"
    next_audit_due: datetime | None = None
    created_at: datetime = field(default_factory=_now)

    def add_finding(self, finding: AuditFinding) -> None:
        self.findings.append(finding)
        criticals = [f for f in self.findings if f.severity == "critical"]
        majors    = [f for f in self.findings if f.severity == "major"]
        if criticals:
            self.overall_verdict = "NON_COMPLIANT"
        elif majors:
            self.overall_verdict = "CONDITIONAL"
        else:
            self.overall_verdict = "COMPLIANT"


def generate_audit_trail_payload(
    model_id: uuid.UUID,
    audit_type: AuditType,
    auditor_ref: str,
    risk_level: RiskLevel,
    audit_period_start: datetime,
    audit_period_end: datetime,
    **checklist: Any,
) -> AIAuditTrail:
    """
    Factory: constructs a structured AuditTrail payload ready for persistence
    and regulatory submission. Enforces all 7 Sutras compliance checks.
    """
    sutras_compliance = {
        SutraAlignment.TRUST.value:          checklist.get("trust_verified", False),
        SutraAlignment.PEOPLE_FIRST.value:   checklist.get("human_oversight_verified", False),
        SutraAlignment.INNOVATION.value:     checklist.get("innovation_not_stifled", True),
        SutraAlignment.FAIRNESS.value:       checklist.get("fairness_metrics_passed", False),
        SutraAlignment.ACCOUNTABILITY.value: checklist.get("accountability_chain_documented", False),
        SutraAlignment.EXPLAINABILITY.value: checklist.get("explainability_verified", False),
        SutraAlignment.SAFETY.value:         checklist.get("bcp_verified", False),
    }

    return AIAuditTrail(
        audit_id=uuid.uuid4(),
        model_id=model_id,
        audit_type=audit_type,
        auditor_ref=auditor_ref,
        risk_level=risk_level,
        audit_period_start=audit_period_start,
        audit_period_end=audit_period_end,
        training_data_bias_checked=checklist.get("training_data_bias_checked", False),
        data_consent_verified=checklist.get("data_consent_verified", False),
        data_sources_documented=checklist.get("data_sources_documented", False),
        sensitive_attributes_excluded=checklist.get("sensitive_attributes_excluded", False),
        model_architecture_reviewed=checklist.get("model_architecture_reviewed", False),
        decision_logic_documented=checklist.get("decision_logic_documented", False),
        adversarial_robustness_tested=checklist.get("adversarial_robustness_tested", False),
        performance_benchmarks_met=checklist.get("performance_benchmarks_met", False),
        fairness_metrics=checklist.get("fairness_metrics", {}),
        explainability_score=checklist.get("explainability_score", 0.0),
        bcp_verified=checklist.get("bcp_verified", False),
        human_override_tested=checklist.get("human_override_tested", False),
        sutras_compliance=sutras_compliance,
    )
