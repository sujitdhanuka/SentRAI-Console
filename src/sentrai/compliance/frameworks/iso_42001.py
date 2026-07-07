"""
ISO 42001 — AI Management System compliance plugin.
Covers the key clauses required to demonstrate an effective AI Management System.
"""
from __future__ import annotations

from sentrai.compliance.frameworks.base_plugin import (
    ComplianceFrameworkPlugin,
    ControlResult,
    ControlSeverity,
    FrameworkComplianceReport,
)


class ISO42001Plugin:
    framework_id = "ISO_42001"
    framework_name = "ISO/IEC 42001:2023 — AI Management System"
    framework_version = "2023"

    def evaluate(self, asset: dict) -> FrameworkComplianceReport:
        results: list[ControlResult] = []

        def chk(ctrl_id: str, name: str, passed: bool, severity: ControlSeverity, msg: str, remediation: str = "") -> None:
            results.append(ControlResult(
                control_id=ctrl_id, control_name=name, passed=passed,
                severity=severity, message=msg, remediation=remediation
            ))

        # 6.1 – Actions to address risks
        chk("ISO42001-6.1", "Risk identification", bool(asset.get("risk_level")),
            ControlSeverity.BLOCKING,
            "Risk level assigned" if asset.get("risk_level") else "No risk level assigned",
            "Set risk_level to LOW, MEDIUM, HIGH, or CRITICAL")

        # 6.2 – AI objectives
        chk("ISO42001-6.2", "AI objectives documented", bool(asset.get("use_case_description")),
            ControlSeverity.MAJOR,
            "Use case documented" if asset.get("use_case_description") else "No use case description",
            "Add a use_case_description explaining the model's purpose and scope")

        # 8.4 – AI risk assessment
        chk("ISO42001-8.4", "Risk assessment performed",
            bool(asset.get("board_policy_ref")),
            ControlSeverity.BLOCKING,
            "Board policy reference present" if asset.get("board_policy_ref") else "No board policy reference",
            "Link model to an approved board AI policy document")

        # 8.6 – Transparency
        chk("ISO42001-8.6", "Transparency information", bool(asset.get("use_case_description")),
            ControlSeverity.MAJOR,
            "Use case description provides transparency" if asset.get("use_case_description") else "Transparency not documented",
            "Document model decisions and limitations clearly")

        # 9.1 – Monitoring and measurement
        lifecycle = asset.get("lifecycle_stage", "")
        in_monitoring = lifecycle in ("DEPLOYED", "MONITORING")
        chk("ISO42001-9.1", "Monitoring in place",
            in_monitoring or lifecycle in ("DESIGN", "DEVELOPMENT", "VALIDATION"),
            ControlSeverity.MAJOR,
            f"Lifecycle stage: {lifecycle}",
            "Deployed models must have drift monitoring enabled")

        # 9.3 – Management review
        chk("ISO42001-9.3", "Owner team assigned", bool(asset.get("owner_team")),
            ControlSeverity.BLOCKING,
            f"Owner team: {asset.get('owner_team', 'MISSING')}",
            "Assign an owner_team responsible for this model")

        # 10.1 – Continual improvement
        human_oversight = asset.get("human_oversight_required", False)
        chk("ISO42001-10.1", "Human oversight declared",
            human_oversight,
            ControlSeverity.MINOR,
            "Human oversight declared" if human_oversight else "No human oversight flag set",
            "Set human_oversight_required=True or document autonomous scope")

        blocking = [r for r in results if not r.passed and r.severity == ControlSeverity.BLOCKING]
        major = [r for r in results if not r.passed and r.severity == ControlSeverity.MAJOR]
        minor = [r for r in results if not r.passed and r.severity == ControlSeverity.MINOR]
        passed = [r for r in results if r.passed]

        score = len(passed) / len(results) if results else 0.0

        return FrameworkComplianceReport(
            framework_id=self.framework_id,
            framework_name=self.framework_name,
            framework_version=self.framework_version,
            asset_id=str(asset.get("model_id", "")),
            overall_pass=len(blocking) == 0,
            score=score,
            blocking_gaps=blocking,
            major_gaps=major,
            minor_gaps=minor,
            passed_controls=passed,
        )
