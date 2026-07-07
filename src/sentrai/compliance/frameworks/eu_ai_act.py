"""
EU AI Act compliance plugin.
Implements risk classification (Art 6), risk management (Art 9),
transparency (Art 13), human oversight (Art 14), and logging (Art 12).
"""
from __future__ import annotations

from sentrai.compliance.frameworks.base_plugin import (
    ControlResult,
    ControlSeverity,
    FrameworkComplianceReport,
)


# EU AI Act risk tiers
_EU_HIGH_RISK_AREAS = {
    "credit_scoring", "credit_underwriting", "loan_decisioning",
    "fraud_detection", "kyc", "identity_verification",
    "employment", "recruitment", "benefits_assessment",
    "biometric", "law_enforcement", "border_control",
    "administration_of_justice",
}


class EUAIActPlugin:
    framework_id = "EU_AI_ACT"
    framework_name = "EU Artificial Intelligence Act (2024/1689)"
    framework_version = "2024"

    def _classify_eu_risk(self, asset: dict) -> str:
        """Map model to EU AI Act risk tier."""
        functional_area = (asset.get("functional_area") or "").lower().replace(" ", "_")
        if any(kw in functional_area for kw in _EU_HIGH_RISK_AREAS):
            return "HIGH"
        risk_level = asset.get("risk_level", "LOW")
        if risk_level in ("CRITICAL", "HIGH"):
            return "HIGH"
        return "LIMITED"

    def evaluate(self, asset: dict) -> FrameworkComplianceReport:
        results: list[ControlResult] = []
        eu_tier = self._classify_eu_risk(asset)

        def chk(ctrl_id: str, name: str, passed: bool, severity: ControlSeverity, msg: str, remediation: str = "") -> None:
            results.append(ControlResult(
                control_id=ctrl_id, control_name=name, passed=passed,
                severity=severity, message=msg, remediation=remediation
            ))

        # Art 6 — Risk classification
        chk("EUAIA-Art6", "EU AI Act risk tier classification",
            True,   # Informational — always passes, surfaces the tier
            ControlSeverity.MINOR,
            f"Classified as {eu_tier} risk under EU AI Act",
            "")

        # Art 9 — Risk management system (HIGH risk only)
        if eu_tier == "HIGH":
            chk("EUAIA-Art9", "Risk management system (High Risk)",
                bool(asset.get("board_policy_ref")),
                ControlSeverity.BLOCKING,
                "Board policy reference present" if asset.get("board_policy_ref") else "HIGH risk model requires documented risk management",
                "Document risk management system and link via board_policy_ref")

            chk("EUAIA-Art10", "Training data governance (High Risk)",
                bool(asset.get("owner_team")),
                ControlSeverity.MAJOR,
                "Owner team assigned — data governance accountability exists" if asset.get("owner_team") else "No owner team — data governance not accountable",
                "Assign an owner team with data governance responsibility")

        # Art 12 — Logging
        lifecycle = asset.get("lifecycle_stage", "")
        chk("EUAIA-Art12", "Logging and audit trail",
            lifecycle in ("DEPLOYED", "MONITORING", "DECOMMISSIONED"),
            ControlSeverity.MAJOR if eu_tier == "HIGH" else ControlSeverity.MINOR,
            f"Model is in '{lifecycle}' stage — logging expected for deployed models",
            "Ensure deployment includes structured logging of inference events")

        # Art 13 — Transparency
        chk("EUAIA-Art13", "Transparency and user information",
            bool(asset.get("use_case_description")),
            ControlSeverity.MAJOR if eu_tier == "HIGH" else ControlSeverity.MINOR,
            "Use case documented" if asset.get("use_case_description") else "No use case description — users cannot understand AI system",
            "Add a use_case_description that explains model behaviour and limitations")

        # Art 14 — Human oversight
        chk("EUAIA-Art14", "Human oversight measures",
            bool(asset.get("human_oversight_required")),
            ControlSeverity.BLOCKING if eu_tier == "HIGH" else ControlSeverity.MAJOR,
            "Human oversight flag set" if asset.get("human_oversight_required") else "No human oversight declared",
            "Set human_oversight_required=True and document override procedures")

        # Art 17 — Quality management (HIGH risk only)
        if eu_tier == "HIGH":
            chk("EUAIA-Art17", "Quality management system",
                bool(asset.get("board_policy_ref")) and bool(asset.get("owner_team")),
                ControlSeverity.MAJOR,
                "Quality management indicators present" if asset.get("board_policy_ref") else "Quality management system not documented",
                "Establish quality management procedures and document them")

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
