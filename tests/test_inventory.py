"""
Tests for Module A — AI Model Inventory & Risk Triage (REC 23, 16)
"""

import pytest
from httpx import AsyncClient

from sentrai.domain.enums import ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment
from sentrai.domain.model_inventory import AIModelEntry, triage_ai_model


class TestRiskTriage:
    def test_credit_underwriting_triaged_high(self):
        entry = AIModelEntry.create(
            name="Credit Scorer",
            model_type=ModelType.MACHINE_LEARNING,
            functional_area="credit_underwriting",
            use_case_description="Default prediction",
            target_customer_segments=["retail"],
            risk_level=RiskLevel.LOW,
            lifecycle_stage=ModelLifecycleStage.DEPLOYED,
            owner_team="Risk",
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
        assert triage_ai_model(entry) == RiskLevel.HIGH

    def test_doc_summarisation_triaged_low(self):
        entry = AIModelEntry.create(
            name="Doc Summariser",
            model_type=ModelType.NLP,
            functional_area="document_summarisation",
            use_case_description="Internal tool",
            target_customer_segments=[],
            risk_level=RiskLevel.LOW,
            lifecycle_stage=ModelLifecycleStage.DEPLOYED,
            owner_team="Ops",
            developed_by="internal",
            deployment_date=None,
            dependencies=[],
            performance_benchmarks=[],
            sutras_alignment=[],
            human_oversight_required=False,
            autonomous_scope=None,
            board_policy_ref="POL-001",
            last_red_team_date=None,
            next_audit_due=None,
        )
        assert triage_ai_model(entry) == RiskLevel.LOW

    def test_genai_autonomous_without_oversight_escalates_to_high(self):
        entry = AIModelEntry.create(
            name="GenAI Chatbot",
            model_type=ModelType.GENERATIVE_AI,
            functional_area="customer_chatbot",
            use_case_description="Customer support",
            target_customer_segments=["retail"],
            risk_level=RiskLevel.MEDIUM,
            lifecycle_stage=ModelLifecycleStage.DEPLOYED,
            owner_team="Digital",
            developed_by="vendor-x",
            deployment_date=None,
            dependencies=[],
            performance_benchmarks=[],
            sutras_alignment=[],
            human_oversight_required=False,    # no oversight + GenAI → HIGH
            autonomous_scope="FAQ responses",
            board_policy_ref="POL-002",
            last_red_team_date=None,
            next_audit_due=None,
        )
        assert triage_ai_model(entry) == RiskLevel.HIGH


@pytest.mark.asyncio
class TestInventoryAPI:
    async def test_register_model_returns_201(self, client: AsyncClient, sample_model_payload: dict):
        resp = await client.post("/api/v1/inventory/models", json=sample_model_payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Credit Risk Scorer v2"
        assert data["triaged_risk_level"] == "HIGH"   # credit_underwriting → HIGH
        assert data["human_oversight_required"] is True

    async def test_list_models_filters_by_risk(self, client: AsyncClient, sample_model_payload: dict):
        await client.post("/api/v1/inventory/models", json=sample_model_payload)
        resp = await client.get("/api/v1/inventory/models", params={"risk_level": "HIGH"})
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    async def test_register_duplicate_model_returns_409(self, client: AsyncClient, sample_model_payload: dict):
        resp1 = await client.post("/api/v1/inventory/models", json=sample_model_payload)
        assert resp1.status_code == 201
        resp2 = await client.post("/api/v1/inventory/models", json=sample_model_payload)
        assert resp2.status_code == 409
        assert "already exists in this project" in resp2.json()["detail"]

    async def test_lifecycle_update_creates_ledger_event(self, client: AsyncClient, sample_model_payload: dict):
        create_resp = await client.post("/api/v1/inventory/models", json=sample_model_payload)
        model_id = create_resp.json()["model_id"]

        await client.patch(
            f"/api/v1/inventory/models/{model_id}/lifecycle",
            json={"stage": "VALIDATION", "actor": "risk_team", "notes": "Validation in progress"},
        )

        ledger_resp = await client.get(f"/api/v1/inventory/models/{model_id}/ledger")
        assert ledger_resp.status_code == 200
        events = ledger_resp.json()
        event_types = [e["event_type"] for e in events]
        assert "MODEL_REGISTERED" in event_types
        assert "LIFECYCLE_UPDATED" in event_types

    async def test_grievance_recording(self, client: AsyncClient, sample_model_payload: dict):
        create_resp = await client.post("/api/v1/inventory/models", json=sample_model_payload)
        model_id = create_resp.json()["model_id"]

        resp = await client.patch(
            f"/api/v1/inventory/models/{model_id}/grievances",
            json={"count_delta": 3, "resolution_notes": "Bias complaints from rural applicants resolved"},
        )
        assert resp.status_code == 200
        assert resp.json()["grievance_count"] == 3


@pytest.mark.asyncio
class TestGovernanceAndCompliance:
    async def _register_discovered_style_model(self, client: AsyncClient) -> str:
        """Mirrors what /discovery/import creates: placeholder owner, blank policy ref."""
        resp = await client.post("/api/v1/inventory/models", json={
            "name": "Discovered Swarm Agent",
            "model_type": "HYBRID",
            "functional_area": "autonomous_agent_orchestration",
            "use_case_description": "Auto-discovered via static codebase scan.",
            "owner_team": "UNASSIGNED — pending review",
            "developed_by": "internal",
            "board_policy_ref": "",
            "human_oversight_required": True,
            "source_ref": "src/agents/swarm.ts",
        })
        return resp.json()["model_id"]

    async def test_freshly_imported_model_fails_compliance(self, client: AsyncClient):
        model_id = await self._register_discovered_style_model(client)
        resp = await client.get(f"/api/v1/inventory/models/{model_id}/compliance-check")
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall_pass"] is False
        assert len(data["blocking_gaps"]) > 0

    async def test_closing_gaps_via_governance_update_passes_compliance(self, client: AsyncClient):
        model_id = await self._register_discovered_style_model(client)

        resp = await client.patch(f"/api/v1/inventory/models/{model_id}/governance", json={
            "owner_team": "Platform Risk Team",
            "board_policy_ref": "AI-POLICY-2026-014",
            "human_oversight_required": True,
            "sutras_alignment": ["FAIRNESS_AND_EQUITY", "UNDERSTANDABLE_BY_DESIGN"],
            "actor": "compliance_officer",
        })
        assert resp.status_code == 200
        body = resp.json()
        assert "owner_team" in body["fields_changed"]
        assert "board_policy_ref" in body["fields_changed"]
        assert body["compliance"]["overall_pass"] is True

        check_resp = await client.get(f"/api/v1/inventory/models/{model_id}/compliance-check")
        assert check_resp.json()["overall_pass"] is True

    async def test_governance_update_logs_ledger_event(self, client: AsyncClient):
        model_id = await self._register_discovered_style_model(client)
        await client.patch(f"/api/v1/inventory/models/{model_id}/governance", json={
            "owner_team": "Platform Risk Team",
            "actor": "compliance_officer",
        })
        ledger_resp = await client.get(f"/api/v1/inventory/models/{model_id}/ledger")
        event_types = [e["event_type"] for e in ledger_resp.json()]
        assert "GOVERNANCE_UPDATED" in event_types

    async def test_governance_update_unknown_model_404(self, client: AsyncClient):
        import uuid
        resp = await client.patch(
            f"/api/v1/inventory/models/{uuid.uuid4()}/governance",
            json={"owner_team": "X"},
        )
        assert resp.status_code == 404

    async def test_list_models_includes_compliance_summary(self, client: AsyncClient, sample_model_payload: dict):
        await client.post("/api/v1/inventory/models", json=sample_model_payload)
        resp = await client.get("/api/v1/inventory/models")
        assert resp.status_code == 200
        for m in resp.json():
            assert "compliance_pass" in m
            assert "open_gap_count" in m


@pytest.mark.asyncio
class TestModelRemoval:
    async def test_soft_delete_hides_from_default_list(self, client: AsyncClient, sample_model_payload: dict):
        create_resp = await client.post("/api/v1/inventory/models", json=sample_model_payload)
        model_id = create_resp.json()["model_id"]

        del_resp = await client.delete(f"/api/v1/inventory/models/{model_id}")
        assert del_resp.status_code == 204

        list_resp = await client.get("/api/v1/inventory/models")
        assert all(m["model_id"] != model_id for m in list_resp.json())

    async def test_soft_delete_logs_ledger_event(self, client: AsyncClient, sample_model_payload: dict):
        create_resp = await client.post("/api/v1/inventory/models", json=sample_model_payload)
        model_id = create_resp.json()["model_id"]

        await client.delete(f"/api/v1/inventory/models/{model_id}")

        ledger_resp = await client.get(f"/api/v1/inventory/models/{model_id}/ledger")
        event_types = [e["event_type"] for e in ledger_resp.json()]
        assert "MODEL_DEACTIVATED" in event_types

    async def test_permanent_delete_removes_row_and_ledger(self, client: AsyncClient, sample_model_payload: dict):
        create_resp = await client.post("/api/v1/inventory/models", json=sample_model_payload)
        model_id = create_resp.json()["model_id"]

        del_resp = await client.delete(f"/api/v1/inventory/models/{model_id}", params={"permanent": "true"})
        assert del_resp.status_code == 204

        ledger_resp = await client.get(f"/api/v1/inventory/models/{model_id}/ledger")
        assert ledger_resp.json() == []

    async def test_delete_unknown_model_404(self, client: AsyncClient):
        import uuid
        resp = await client.delete(f"/api/v1/inventory/models/{uuid.uuid4()}")
        assert resp.status_code == 404
