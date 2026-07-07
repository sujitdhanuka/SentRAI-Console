"""
Tests for multi-project tracking: each project owns its own scan history
and scoped model inventory.
"""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
def project_payload(tmp_path) -> dict:
    (tmp_path / "src").mkdir()
    return {
        "name": "Dhancept Terminal",
        "description": "AI trading research platform",
        "root_directory": str(tmp_path),
    }


@pytest.mark.asyncio
class TestProjectCRUD:
    async def test_create_project(self, client: AsyncClient, project_payload: dict):
        resp = await client.post("/api/v1/projects", json=project_payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Dhancept Terminal"
        assert data["model_count"] == 0
        assert data["last_scanned_at"] is None

    async def test_create_project_bad_directory_400(self, client: AsyncClient):
        resp = await client.post("/api/v1/projects", json={
            "name": "Ghost Project",
            "root_directory": "/totally/not/a/real/path",
        })
        assert resp.status_code == 400

    async def test_duplicate_name_conflict(self, client: AsyncClient, project_payload: dict):
        await client.post("/api/v1/projects", json=project_payload)
        resp = await client.post("/api/v1/projects", json=project_payload)
        assert resp.status_code == 409

    async def test_list_projects(self, client: AsyncClient, project_payload: dict):
        await client.post("/api/v1/projects", json=project_payload)
        resp = await client.get("/api/v1/projects")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_get_project(self, client: AsyncClient, project_payload: dict):
        create_resp = await client.post("/api/v1/projects", json=project_payload)
        project_id = create_resp.json()["project_id"]
        resp = await client.get(f"/api/v1/projects/{project_id}")
        assert resp.status_code == 200
        assert resp.json()["project_id"] == project_id

    async def test_get_unknown_project_404(self, client: AsyncClient):
        resp = await client.get(f"/api/v1/projects/{uuid.uuid4()}")
        assert resp.status_code == 404

    async def test_update_project_name(self, client: AsyncClient, project_payload: dict):
        create_resp = await client.post("/api/v1/projects", json=project_payload)
        project_id = create_resp.json()["project_id"]
        resp = await client.patch(f"/api/v1/projects/{project_id}", json={"name": "Renamed Project"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed Project"

    async def test_delete_empty_project(self, client: AsyncClient, project_payload: dict):
        create_resp = await client.post("/api/v1/projects", json=project_payload)
        project_id = create_resp.json()["project_id"]
        resp = await client.delete(f"/api/v1/projects/{project_id}")
        assert resp.status_code == 204

        get_resp = await client.get(f"/api/v1/projects/{project_id}")
        assert get_resp.status_code == 404

    async def test_delete_project_with_models_blocked(
        self, client: AsyncClient, project_payload: dict, sample_model_payload: dict
    ):
        create_resp = await client.post("/api/v1/projects", json=project_payload)
        project_id = create_resp.json()["project_id"]

        model_payload = dict(sample_model_payload, project_id=project_id)
        await client.post("/api/v1/inventory/models", json=model_payload)

        resp = await client.delete(f"/api/v1/projects/{project_id}")
        assert resp.status_code == 409


@pytest.mark.asyncio
class TestProjectScopedInventory:
    async def test_model_tagged_with_project_on_register(
        self, client: AsyncClient, project_payload: dict, sample_model_payload: dict
    ):
        create_resp = await client.post("/api/v1/projects", json=project_payload)
        project_id = create_resp.json()["project_id"]

        model_payload = dict(sample_model_payload, project_id=project_id)
        register_resp = await client.post("/api/v1/inventory/models", json=model_payload)
        assert register_resp.json()["project_id"] == project_id

    async def test_list_models_filters_by_project(
        self, client: AsyncClient, project_payload: dict, sample_model_payload: dict, tmp_path
    ):
        proj_a = (await client.post("/api/v1/projects", json=project_payload)).json()

        (tmp_path / "other").mkdir()
        proj_b_payload = {"name": "Other App", "root_directory": str(tmp_path / "other")}
        proj_b = (await client.post("/api/v1/projects", json=proj_b_payload)).json()

        await client.post("/api/v1/inventory/models", json=dict(sample_model_payload, project_id=proj_a["project_id"]))
        await client.post("/api/v1/inventory/models", json=dict(
            sample_model_payload, name="Other Model", project_id=proj_b["project_id"]
        ))

        resp_a = await client.get("/api/v1/inventory/models", params={"project_id": proj_a["project_id"]})
        assert len(resp_a.json()) == 1
        assert resp_a.json()[0]["project_id"] == proj_a["project_id"]

        resp_b = await client.get("/api/v1/inventory/models", params={"project_id": proj_b["project_id"]})
        assert len(resp_b.json()) == 1
        assert resp_b.json()[0]["name"] == "Other Model"

    async def test_project_summary_reflects_compliance(
        self, client: AsyncClient, project_payload: dict, sample_model_payload: dict
    ):
        proj = (await client.post("/api/v1/projects", json=project_payload)).json()
        register_resp = await client.post(
            "/api/v1/inventory/models",
            json=dict(sample_model_payload, project_id=proj["project_id"], owner_team="", board_policy_ref=""),
        )
        model_id = register_resp.json()["model_id"]

        summary = (await client.get(f"/api/v1/projects/{proj['project_id']}")).json()
        assert summary["model_count"] == 1
        assert summary["compliant_count"] == 0
        assert summary["open_gap_count"] > 0

        await client.patch(f"/api/v1/inventory/models/{model_id}/governance", json={
            "owner_team": "Team X",
            "board_policy_ref": "POL-1",
            "human_oversight_required": True,
            "sutras_alignment": ["FAIRNESS_AND_EQUITY", "UNDERSTANDABLE_BY_DESIGN"],
            "last_red_team_date": "2026-06-01T00:00:00Z",
        })

        summary2 = (await client.get(f"/api/v1/projects/{proj['project_id']}")).json()
        assert summary2["compliant_count"] == 1
        assert summary2["open_gap_count"] == 0


@pytest.mark.asyncio
class TestProjectScopedDiscovery:
    async def test_scan_using_project_id(self, client: AsyncClient, project_payload: dict, tmp_path):
        (tmp_path / "src" / "agent.ts").write_text(
            'import { openai } from "openai";\n'
            'export async function run() { return openai.chat.completions.create({model:"gpt-4"}); }\n'
        )
        proj = (await client.post("/api/v1/projects", json=project_payload)).json()

        resp = await client.post("/api/v1/discovery/scan", json={"project_id": proj["project_id"]})
        assert resp.status_code == 200
        assert resp.json()["files_flagged"] >= 1

        updated = (await client.get(f"/api/v1/projects/{proj['project_id']}")).json()
        assert updated["last_scanned_at"] is not None

    async def test_scan_without_directory_or_project_400(self, client: AsyncClient):
        resp = await client.post("/api/v1/discovery/scan", json={})
        assert resp.status_code == 422  # pydantic validation error

    async def test_import_tags_models_with_project(self, client: AsyncClient, project_payload: dict, tmp_path):
        (tmp_path / "src" / "agent.ts").write_text(
            'import { openai } from "openai";\n'
            'export async function run() { return openai.chat.completions.create({model:"gpt-4"}); }\n'
        )
        proj = (await client.post("/api/v1/projects", json=project_payload)).json()

        scan_resp = await client.post("/api/v1/discovery/scan", json={"project_id": proj["project_id"]})
        file_paths = [c["file_path"] for c in scan_resp.json()["candidates"]]

        import_resp = await client.post("/api/v1/discovery/import", json={
            "project_id": proj["project_id"],
            "file_paths": file_paths,
        })
        assert import_resp.status_code == 200

        models_resp = await client.get("/api/v1/inventory/models", params={"project_id": proj["project_id"]})
        assert len(models_resp.json()) == len(file_paths)
