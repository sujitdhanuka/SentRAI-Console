import pytest
from datetime import datetime, timezone
import uuid
from sentrai.domain.enums import ModelLifecycleStage, ModelType, RiskLevel
from sentrai.domain.model_inventory import AIModelEntry
from sentrai.compliance.frameworks_validator import validate_nist_rmf, validate_eu_ai_act

def test_nist_rmf_validation_fails_when_unassigned():
    entry = AIModelEntry.create(
        name="Test Model",
        model_type=ModelType.GENERATIVE_AI,
        functional_area="credit_underwriting",
        use_case_description="Uses LLM for credit underwriting.",
        target_customer_segments=["retail"],
        risk_level=RiskLevel.HIGH,
        lifecycle_stage=ModelLifecycleStage.DESIGN,
        owner_team="unassigned",
        developed_by="internal",
        deployment_date=None,
        dependencies=[],
        performance_benchmarks=[],
        sutras_alignment=[],
        human_oversight_required=False,
        board_policy_ref="",
        autonomous_scope=None,
        last_red_team_date=None,
        next_audit_due=None
    )
    
    report = validate_nist_rmf(entry)
    assert not report.overall_pass
    assert len(report.blocking_gaps) == 4 # Owner unassigned, missing board policy, missing red team, human oversight
    
def test_eu_ai_act_classification_high_risk():
    entry = AIModelEntry.create(
        name="Credit Model",
        model_type=ModelType.GENERATIVE_AI,
        functional_area="credit_underwriting",
        use_case_description="High-risk credit decisioning system.",
        target_customer_segments=["retail"],
        risk_level=RiskLevel.HIGH,
        lifecycle_stage=ModelLifecycleStage.DESIGN,
        owner_team="Risk Team",
        developed_by="internal",
        deployment_date=None,
        dependencies=[],
        performance_benchmarks=[],
        sutras_alignment=[],
        human_oversight_required=False,
        board_policy_ref="POLICY-1",
        source_ref="models/credit.py",
        autonomous_scope=None,
        last_red_team_date=None,
        next_audit_due=None
    )
    
    report = validate_eu_ai_act(entry)
    assert report.risk_tier == "High Risk"
    assert not report.overall_pass # Fails because human oversight is False
    assert len(report.blocking_gaps) == 1
    assert "human-in-the-loop" in report.blocking_gaps[0].lower()


def test_iso_42001_validation():
    from sentrai.compliance.frameworks_validator import validate_iso_42001
    entry = AIModelEntry.create(
        name="Credit Model",
        model_type=ModelType.GENERATIVE_AI,
        functional_area="credit_underwriting",
        use_case_description="High-risk credit decisioning system.",
        target_customer_segments=["retail"],
        risk_level=RiskLevel.HIGH,
        lifecycle_stage=ModelLifecycleStage.DESIGN,
        owner_team="Risk Team",
        developed_by="internal",
        deployment_date=None,
        dependencies=[],
        performance_benchmarks=[],
        sutras_alignment=[],
        human_oversight_required=False,
        board_policy_ref="POLICY-1",
        source_ref="models/credit.py",
        autonomous_scope=None,
        last_red_team_date=None,
        next_audit_due=None
    )
    report = validate_iso_42001(entry)
    assert report.overall_pass
    assert len(report.checks) == 3


def test_pdf_report_generation():
    from sentrai.compliance.pdf_generator import generate_compliance_pdf
    entry = AIModelEntry.create(
        name="Credit Model",
        model_type=ModelType.GENERATIVE_AI,
        functional_area="credit_underwriting",
        use_case_description="High-risk credit decisioning system.",
        target_customer_segments=["retail"],
        risk_level=RiskLevel.HIGH,
        lifecycle_stage=ModelLifecycleStage.DESIGN,
        owner_team="Risk Team",
        developed_by="internal",
        deployment_date=None,
        dependencies=[],
        performance_benchmarks=[],
        sutras_alignment=[],
        human_oversight_required=False,
        board_policy_ref="POLICY-1",
        source_ref="models/credit.py",
        autonomous_scope=None,
        last_red_team_date=None,
        next_audit_due=None
    )
    pdf_bytes = generate_compliance_pdf(entry)
    assert len(pdf_bytes) > 0
    assert pdf_bytes.startswith(b"%PDF")


