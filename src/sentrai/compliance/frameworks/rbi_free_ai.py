"""
RBI FREE-AI compliance plugin — wraps the existing sutras_validator logic
under the standard ComplianceFrameworkPlugin interface.
"""
from __future__ import annotations

from sentrai.compliance.frameworks.base_plugin import (
    ControlResult,
    ControlSeverity,
    FrameworkComplianceReport,
)
from sentrai.compliance.sutras_validator import validate_sutras_compliance
from sentrai.domain.model_inventory import AIModelEntry


class RBIFreeAIPlugin:
    framework_id = "RBI_FREE_AI"
    framework_name = "RBI FREE-AI Framework (2025)"
    framework_version = "2025"

    def evaluate(self, asset: dict) -> FrameworkComplianceReport:
        """
        Delegate to the existing sutras_validator and translate its output
        into the standard FrameworkComplianceReport format.
        """
        # Build a lightweight AIModelEntry-like dict for the existing validator
        try:
            from sentrai.api.v1.inventory import _orm_to_entry  # noqa — reuse existing logic
        except ImportError:
            _orm_to_entry = None

        # If asset is already a proper AIModelEntry pass directly; otherwise coerce
        if isinstance(asset, AIModelEntry):
            report = validate_sutras_compliance(asset)
        else:
            # Build a minimal entry for validation
            from sentrai.domain.model_inventory import AIModelEntry as Entry
            try:
                entry = Entry(
                    model_id=asset.get("model_id"),
                    name=asset.get("name", ""),
                    model_type=asset.get("model_type", "MACHINE_LEARNING"),
                    functional_area=asset.get("functional_area", ""),
                    use_case_description=asset.get("use_case_description", ""),
                    target_customer_segments=asset.get("target_customer_segments", []),
                    risk_level=asset.get("risk_level", "MEDIUM"),
                    lifecycle_stage=asset.get("lifecycle_stage", "DESIGN"),
                    owner_team=asset.get("owner_team", ""),
                    developed_by=asset.get("developed_by", ""),
                    board_policy_ref=asset.get("board_policy_ref"),
                    human_oversight_required=asset.get("human_oversight_required", False),
                    sutras_alignment=asset.get("sutras_alignment", []),
                    is_active=True,
                )
                report = validate_sutras_compliance(entry)
            except Exception:
                # Fallback: return a placeholder with no controls
                return FrameworkComplianceReport(
                    framework_id=self.framework_id,
                    framework_name=self.framework_name,
                    framework_version=self.framework_version,
                    asset_id=str(asset.get("model_id", "")),
                    overall_pass=False,
                    score=0.0,
                    blocking_gaps=[ControlResult(
                        control_id="RBI-ERR",
                        control_name="Evaluation Error",
                        passed=False,
                        severity=ControlSeverity.BLOCKING,
                        message="Could not evaluate — ensure all required fields are provided",
                    )],
                )

        blocking = [
            ControlResult(control_id=f"RBI-{i}", control_name=g, passed=False,
                         severity=ControlSeverity.BLOCKING, message=g)
            for i, g in enumerate(report.blocking_gaps)
        ]
        passed_controls = [
            ControlResult(control_id=f"RBI-PASS-{i}", control_name=s, passed=True,
                         severity=ControlSeverity.MINOR, message=f"Sutra satisfied: {s}")
            for i, s in enumerate(getattr(report, "sutras_alignment", []))
        ]

        score = (len(passed_controls)) / max(len(blocking) + len(passed_controls), 1)

        return FrameworkComplianceReport(
            framework_id=self.framework_id,
            framework_name=self.framework_name,
            framework_version=self.framework_version,
            asset_id=str(asset.get("model_id", "")),
            overall_pass=report.overall_pass,
            score=score,
            blocking_gaps=blocking,
            passed_controls=passed_controls,
        )
