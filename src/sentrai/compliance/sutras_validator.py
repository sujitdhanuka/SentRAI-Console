"""
7 Sutras compliance validator — validates any AI model entry against
all 7 SentrAI foundational principles before deployment approval.
Returns a structured compliance report usable in product approval (REC 17).
"""

from dataclasses import dataclass, field
from typing import Any

from sentrai.domain.enums import RiskLevel, SutraAlignment
from sentrai.domain.model_inventory import AIModelEntry


@dataclass
class SutraCheck:
    sutra: SutraAlignment
    passed: bool
    evidence: str
    gap: str = ""
    mandatory: bool = True


@dataclass
class SutrasComplianceReport:
    model_id: Any
    model_name: str
    checks: list[SutraCheck] = field(default_factory=list)

    @property
    def overall_pass(self) -> bool:
        mandatory_failed = [c for c in self.checks if c.mandatory and not c.passed]
        return len(mandatory_failed) == 0

    @property
    def blocking_gaps(self) -> list[str]:
        return [c.gap for c in self.checks if c.mandatory and not c.passed and c.gap]

    def as_dict(self) -> dict:
        return {
            "model_id": str(self.model_id),
            "model_name": self.model_name,
            "overall_pass": self.overall_pass,
            "blocking_gaps": self.blocking_gaps,
            "checks": [
                {
                    "sutra": c.sutra.value,
                    "passed": c.passed,
                    "evidence": c.evidence,
                    "gap": c.gap,
                    "mandatory": c.mandatory,
                }
                for c in self.checks
            ],
        }


def validate_sutras_compliance(entry: AIModelEntry) -> SutrasComplianceReport:
    """
    Validates an AIModelEntry against all 7 Sutras.
    Used at product-approval gate (REC 17) and periodic re-validation.
    """
    report = SutrasComplianceReport(model_id=entry.model_id, model_name=entry.name)

    # Sutra 1: Trust is the Foundation
    trust_ok = entry.board_policy_ref != ""
    report.checks.append(SutraCheck(
        sutra=SutraAlignment.TRUST,
        passed=trust_ok,
        evidence=f"Board policy ref: {entry.board_policy_ref}" if trust_ok else "",
        gap="No board-approved AI policy reference. REC 14 mandates a board-approved AI policy." if not trust_ok else "",
    ))

    # Sutra 2: People First — human oversight for MEDIUM/HIGH risk
    people_ok = (
        entry.human_oversight_required
        or entry.risk_level == RiskLevel.LOW
    )
    report.checks.append(SutraCheck(
        sutra=SutraAlignment.PEOPLE_FIRST,
        passed=people_ok,
        evidence="Human oversight configured" if people_ok else "",
        gap="MEDIUM/HIGH risk model without human oversight. REC 16 requires human-in-the-loop." if not people_ok else "",
    ))

    # Sutra 3: Innovation over Restraint — check autonomous scope is defined if used
    innovation_ok = (
        entry.autonomous_scope is not None
        if entry.human_oversight_required is False
        else True
    )
    report.checks.append(SutraCheck(
        sutra=SutraAlignment.INNOVATION,
        passed=innovation_ok,
        evidence="Autonomous scope defined" if innovation_ok else "",
        gap="Autonomous model without defined scope boundary. REC 16 requires clear autonomous action limits." if not innovation_ok else "",
        mandatory=True,
    ))

    # Sutra 4: Fairness and Equity — sutras alignment declared
    fairness_ok = SutraAlignment.FAIRNESS in entry.sutras_alignment
    report.checks.append(SutraCheck(
        sutra=SutraAlignment.FAIRNESS,
        passed=fairness_ok,
        evidence="Fairness sutra declared in model registration" if fairness_ok else "",
        gap="Fairness & Equity sutra not declared. Bias testing must be documented." if not fairness_ok else "",
        mandatory=entry.risk_level in (RiskLevel.MEDIUM, RiskLevel.HIGH),
    ))

    # Sutra 5: Accountability — owner team documented
    accountability_ok = entry.owner_team != "" and "unassigned" not in entry.owner_team.lower()
    report.checks.append(SutraCheck(
        sutra=SutraAlignment.ACCOUNTABILITY,
        passed=accountability_ok,
        evidence=f"Owner team: {entry.owner_team}" if accountability_ok else "",
        gap="No accountability chain (owner team) defined." if not accountability_ok else "",
    ))

    # Sutra 6: Understandable by Design — explainability required for MEDIUM/HIGH
    explainability_ok = (
        SutraAlignment.EXPLAINABILITY in entry.sutras_alignment
        or entry.risk_level == RiskLevel.LOW
    )
    report.checks.append(SutraCheck(
        sutra=SutraAlignment.EXPLAINABILITY,
        passed=explainability_ok,
        evidence="Explainability declared" if explainability_ok else "",
        gap="No explainability mechanism declared for MEDIUM/HIGH risk model. REC 24 audit will fail." if not explainability_ok else "",
        mandatory=entry.risk_level in (RiskLevel.MEDIUM, RiskLevel.HIGH),
    ))

    # Sutra 7: Safety, Resilience, Sustainability — red-team for HIGH
    safety_ok = (
        entry.last_red_team_date is not None
        if entry.risk_level == RiskLevel.HIGH
        else True
    )
    report.checks.append(SutraCheck(
        sutra=SutraAlignment.SAFETY,
        passed=safety_ok,
        evidence=f"Last red-team: {entry.last_red_team_date}" if safety_ok else "",
        gap="HIGH risk model with no red-team exercise on record. REC 20 mandates semi-annual red-teaming." if not safety_ok else "",
    ))

    return report
