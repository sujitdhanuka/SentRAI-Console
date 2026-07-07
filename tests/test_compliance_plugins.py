"""Tests for ISO 42001 and EU AI Act compliance plugins."""
import pytest
from sentrai.compliance.frameworks.iso_42001 import ISO42001Plugin
from sentrai.compliance.frameworks.eu_ai_act import EUAIActPlugin
from sentrai.compliance.framework_registry import list_frameworks, evaluate


COMPLIANT_ASSET = {
    "model_id": "11111111-1111-1111-1111-111111111111",
    "name": "Credit Risk Scorer",
    "model_type": "MACHINE_LEARNING",
    "functional_area": "credit_underwriting",
    "use_case_description": "Evaluates credit applications for SME loans",
    "risk_level": "HIGH",
    "lifecycle_stage": "DEPLOYED",
    "owner_team": "Risk Engineering",
    "developed_by": "internal",
    "board_policy_ref": "AI-POLICY-2026-001",
    "human_oversight_required": True,
    "sutras_alignment": ["TRUST_IS_THE_FOUNDATION", "PEOPLE_FIRST"],
    "target_customer_segments": ["sme"],
}

NON_COMPLIANT_ASSET = {
    "model_id": "22222222-2222-2222-2222-222222222222",
    "name": "Unmanaged AI",
    "model_type": "GENERATIVE_AI",
    "functional_area": "general_purpose",
    "use_case_description": "",
    "risk_level": "",
    "lifecycle_stage": "DESIGN",
    "owner_team": "",
    "developed_by": "",
    "board_policy_ref": None,
    "human_oversight_required": False,
    "sutras_alignment": [],
    "target_customer_segments": [],
}


class TestISO42001Plugin:
    def test_compliant_asset_passes(self):
        plugin = ISO42001Plugin()
        report = plugin.evaluate(COMPLIANT_ASSET)
        assert report.framework_id == "ISO_42001"
        assert report.overall_pass is True
        assert report.score > 0.5

    def test_non_compliant_has_blocking_gaps(self):
        plugin = ISO42001Plugin()
        report = plugin.evaluate(NON_COMPLIANT_ASSET)
        assert report.overall_pass is False
        assert len(report.blocking_gaps) > 0

    def test_missing_owner_team_is_blocking(self):
        plugin = ISO42001Plugin()
        asset = {**COMPLIANT_ASSET, "owner_team": ""}
        report = plugin.evaluate(asset)
        blocking_ids = [r.control_id for r in report.blocking_gaps]
        assert "ISO42001-9.3" in blocking_ids


class TestEUAIActPlugin:
    def test_high_risk_classification(self):
        plugin = EUAIActPlugin()
        report = plugin.evaluate(COMPLIANT_ASSET)  # credit_underwriting → HIGH risk
        assert report.framework_id == "EU_AI_ACT"
        # Should have passed the classification check
        assert any(r.control_id == "EUAIA-Art6" for r in report.passed_controls)

    def test_missing_human_oversight_blocks_high_risk(self):
        plugin = EUAIActPlugin()
        asset = {**COMPLIANT_ASSET, "human_oversight_required": False}
        report = plugin.evaluate(asset)
        assert report.overall_pass is False
        blocking_ids = [r.control_id for r in report.blocking_gaps]
        assert "EUAIA-Art14" in blocking_ids

    def test_fully_non_compliant_asset(self):
        plugin = EUAIActPlugin()
        report = plugin.evaluate(NON_COMPLIANT_ASSET)
        # general_purpose area → EU LIMITED risk tier; Art14 is MAJOR (not BLOCKING)
        # so overall_pass may be True (no blocking) but major gaps exist
        assert len(report.major_gaps) > 0 or len(report.blocking_gaps) > 0


class TestFrameworkRegistry:
    def test_list_frameworks_has_three_entries(self):
        frameworks = list_frameworks()
        ids = [f["framework_id"] for f in frameworks]
        assert "RBI_FREE_AI" in ids
        assert "ISO_42001" in ids
        assert "EU_AI_ACT" in ids

    def test_evaluate_iso_returns_report(self):
        report = evaluate(COMPLIANT_ASSET, "ISO_42001")
        assert report.framework_id == "ISO_42001"

    def test_evaluate_eu_returns_report(self):
        report = evaluate(COMPLIANT_ASSET, "EU_AI_ACT")
        assert report.framework_id == "EU_AI_ACT"

    def test_unknown_framework_raises(self):
        with pytest.raises(ValueError, match="Unknown compliance framework"):
            evaluate(COMPLIANT_ASSET, "UNKNOWN_FRAMEWORK")
