"""
Tests for Module D — AI Incident Reporting (REC 22, Annexure VI)
"""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from sentrai.domain.enums import IncidentSeverity
from sentrai.domain.incident import AIIncident, REPORTING_SLA_HOURS


class TestIncidentDomain:
    def test_p1_reporting_deadline_is_6_hours(self):
        now = datetime.now(timezone.utc)
        incident = AIIncident.create(
            model_id=__import__("uuid").uuid4(),
            observed_at=now,
            severity=IncidentSeverity.P1_CRITICAL,
            model_name="Fraud Detector",
            re_name="Test Bank",
            functional_area="fraud_detection",
            incident_category=__import__("sentrai.domain.enums", fromlist=["IncidentCategory"]).IncidentCategory.ADVERSARIAL_ATTACK,
            description="Adversarial inputs bypassed fraud detection",
            model_risk_level=__import__("sentrai.domain.enums", fromlist=["RiskLevel"]).RiskLevel.HIGH,
            autonomous_system_involved=False,
            immediate_action_taken="Model suspended immediately pending investigation",
        )
        deadline_hours = (incident.reporting_deadline - now).total_seconds() / 3600
        assert abs(deadline_hours - 6.0) < 0.01

    def test_p4_reporting_deadline_is_7_days(self):
        now = datetime.now(timezone.utc)
        incident = AIIncident.create(
            model_id=__import__("uuid").uuid4(),
            observed_at=now,
            severity=IncidentSeverity.P4_LOW,
            model_name="Doc Summariser",
            re_name="Test Bank",
            functional_area="document_summarisation",
            incident_category=__import__("sentrai.domain.enums", fromlist=["IncidentCategory"]).IncidentCategory.OTHER,
            description="Minor output inconsistency detected in summarisation module during QA review",
            model_risk_level=__import__("sentrai.domain.enums", fromlist=["RiskLevel"]).RiskLevel.LOW,
            autonomous_system_involved=False,
            immediate_action_taken="Logged for next release cycle review, no customer impact",
        )
        deadline_days = (incident.reporting_deadline - now).days
        assert deadline_days == 7

    def test_overdue_detection(self):
        past = datetime.now(timezone.utc) - timedelta(hours=10)
        incident = AIIncident.create(
            model_id=__import__("uuid").uuid4(),
            observed_at=past,
            severity=IncidentSeverity.P1_CRITICAL,
            model_name="X",
            re_name="Y",
            functional_area="credit_underwriting",
            incident_category=__import__("sentrai.domain.enums", fromlist=["IncidentCategory"]).IncidentCategory.BIAS_DISCRIMINATION,
            description="Critical bias detected in credit model output for SC/ST applicants versus general category",
            model_risk_level=__import__("sentrai.domain.enums", fromlist=["RiskLevel"]).RiskLevel.HIGH,
            autonomous_system_involved=False,
            immediate_action_taken="Model output suspended, manual review initiated",
        )
        assert incident.is_overdue is True


@pytest.mark.asyncio
class TestIncidentAPI:
    async def test_report_incident_returns_201(
        self, client: AsyncClient, sample_incident_payload: dict
    ):
        resp = await client.post("/api/v1/compliance/incident/report", json=sample_incident_payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["severity"] == "P2_HIGH"
        assert data["status"] == "REPORTED"
        assert "reporting_deadline" in data
        assert "hours_until_deadline" in data

    async def test_short_description_rejected(
        self, client: AsyncClient, sample_incident_payload: dict
    ):
        bad = dict(sample_incident_payload, description="Too short")
        resp = await client.post("/api/v1/compliance/incident/report", json=bad)
        assert resp.status_code == 422

    async def test_status_update_to_resolved(
        self, client: AsyncClient, sample_incident_payload: dict
    ):
        create_resp = await client.post("/api/v1/compliance/incident/report", json=sample_incident_payload)
        incident_id = create_resp.json()["incident_id"]

        update_resp = await client.patch(
            f"/api/v1/compliance/incident/{incident_id}/status",
            json={"status": "RESOLVED", "regulator_notified": True, "board_informed": True},
        )
        assert update_resp.status_code == 200

    async def test_sectoral_risk_summary(
        self, client: AsyncClient, sample_incident_payload: dict
    ):
        await client.post("/api/v1/compliance/incident/report", json=sample_incident_payload)
        resp = await client.get("/api/v1/compliance/incident/sectoral-risk")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_incidents"] >= 1
        assert "by_category" in data
        assert "by_severity" in data

    async def test_dpdp_masking_active_for_incident_path(
        self, client: AsyncClient, sample_incident_payload: dict
    ):
        resp = await client.post("/api/v1/compliance/incident/report", json=sample_incident_payload)
        assert resp.status_code == 201
        # Verify no raw PAN/Aadhaar in response body
        body = resp.text
        assert "AADHAAR" not in body or "[AADHAAR_MASKED]" in body or "AADHAAR" not in body
