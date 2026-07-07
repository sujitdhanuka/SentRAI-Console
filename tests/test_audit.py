"""
Tests for Module C — AI Audit Framework & Sutras Compliance (REC 24)
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from sentrai.compliance.sutras_validator import validate_sutras_compliance
from sentrai.domain.audit import generate_audit_trail_payload
from sentrai.domain.enums import AuditType, ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment
from sentrai.domain.model_inventory import AIModelEntry


def _make_entry(**overrides) -> AIModelEntry:
    defaults = dict(
        name="Test Model",
        model_type=ModelType.MACHINE_LEARNING,
        functional_area="credit_underwriting",
        use_case_description="Test",
        target_customer_segments=["retail"],
        risk_level=RiskLevel.HIGH,
        lifecycle_stage=ModelLifecycleStage.DEPLOYED,
        owner_team="Risk Team",
        developed_by="internal",
        deployment_date=None,
        dependencies=[],
        performance_benchmarks=[],
        sutras_alignment=[],
        human_oversight_required=True,
        autonomous_scope=None,
        board_policy_ref="POL-001",
        last_red_team_date=None,
        next_audit_due=None,
    )
    defaults.update(overrides)
    return AIModelEntry.create(**defaults)


class TestSutrasValidator:
    def test_missing_board_policy_fails_trust_sutra(self):
        entry = _make_entry(board_policy_ref="")
        report = validate_sutras_compliance(entry)
        trust_check = next(c for c in report.checks if c.sutra == SutraAlignment.TRUST)
        assert trust_check.passed is False
        assert report.overall_pass is False

    def test_high_risk_without_redteam_fails_safety(self):
        entry = _make_entry(risk_level=RiskLevel.HIGH, last_red_team_date=None)
        report = validate_sutras_compliance(entry)
        safety_check = next(c for c in report.checks if c.sutra == SutraAlignment.SAFETY)
        assert safety_check.passed is False

    def test_fully_compliant_model_passes(self):
        entry = _make_entry(
            board_policy_ref="POL-001",
            human_oversight_required=True,
            sutras_alignment=[SutraAlignment.FAIRNESS, SutraAlignment.EXPLAINABILITY],
            last_red_team_date=datetime.now(timezone.utc),
            owner_team="Risk Team",
        )
        report = validate_sutras_compliance(entry)
        assert report.overall_pass is True
        assert report.blocking_gaps == []

    def test_low_risk_model_explainability_not_mandatory(self):
        entry = _make_entry(
            risk_level=RiskLevel.LOW,
            functional_area="document_summarisation",
            sutras_alignment=[],
            human_oversight_required=False,
        )
        report = validate_sutras_compliance(entry)
        explainability_check = next(c for c in report.checks if c.sutra == SutraAlignment.EXPLAINABILITY)
        assert explainability_check.mandatory is False


class TestAuditTrailGeneration:
    def test_no_findings_yields_compliant_verdict(self):
        trail = generate_audit_trail_payload(
            model_id=uuid.uuid4(),
            audit_type=AuditType.INTERNAL,
            auditor_ref="Internal Risk Team",
            risk_level=RiskLevel.MEDIUM,
            audit_period_start=datetime.now(timezone.utc) - timedelta(days=180),
            audit_period_end=datetime.now(timezone.utc),
            training_data_bias_checked=True,
            data_consent_verified=True,
            fairness_metrics={"demographic_parity": 0.97},
            explainability_score=0.85,
        )
        assert trail.overall_verdict == "PENDING"  # verdict set only via add_finding

    def test_critical_finding_sets_non_compliant(self):
        from sentrai.domain.audit import AuditFinding

        trail = generate_audit_trail_payload(
            model_id=uuid.uuid4(),
            audit_type=AuditType.THIRD_PARTY,
            auditor_ref="External Auditor LLP",
            risk_level=RiskLevel.HIGH,
            audit_period_start=datetime.now(timezone.utc) - timedelta(days=180),
            audit_period_end=datetime.now(timezone.utc),
        )
        trail.add_finding(AuditFinding(
            finding_id=str(uuid.uuid4()),
            category="bias",
            severity="critical",
            description="Significant demographic disparity detected",
            sutra_violated=SutraAlignment.FAIRNESS,
            remediation_required=True,
            remediation_deadline=datetime.now(timezone.utc) + timedelta(days=30),
        ))
        assert trail.overall_verdict == "NON_COMPLIANT"


@pytest.mark.asyncio
class TestAuditAPI:
    async def test_initiate_audit_for_registered_model(
        self, client: AsyncClient, sample_model_payload: dict
    ):
        create_resp = await client.post("/api/v1/inventory/models", json=sample_model_payload)
        model_id = create_resp.json()["model_id"]

        audit_resp = await client.post(
            f"/api/v1/audit/models/{model_id}/initiate",
            json={
                "auditor_ref": "Internal Risk Team",
                "audit_type": "INTERNAL",
                "training_data_bias_checked": True,
                "data_consent_verified": True,
                "fairness_metrics_passed": True,
                "fairness_metrics": {"demographic_parity": 0.96},
                "explainability_score": 0.88,
                "trust_verified": True,
                "human_oversight_verified": True,
                "accountability_chain_documented": True,
                "explainability_verified": True,
                "bcp_verified": True,
            },
        )
        assert audit_resp.status_code == 201
        data = audit_resp.json()
        assert data["overall_verdict"] == "COMPLIANT"
        assert data["next_audit_due"] is not None

    async def test_initiate_audit_for_unknown_model_404(self, client: AsyncClient):
        resp = await client.post(
            f"/api/v1/audit/models/{uuid.uuid4()}/initiate",
            json={"auditor_ref": "X", "audit_type": "INTERNAL"},
        )
        assert resp.status_code == 404

    async def test_explainability_record_endpoint(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/audit/explainability/record",
            json={
                "decision_ref": "LOAN-APP-2026-00123",
                "top_features": {"credit_score": 0.45, "income_stability": 0.30, "existing_debt": 0.25},
                "decision_outcome": "REJECTED",
                "confidence_score": 0.91,
                "explanation_method": "SHAP",
                "human_readable_summary": "Application declined primarily due to low credit score and high existing debt.",
                "is_contestable": True,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["is_contestable"] is True
