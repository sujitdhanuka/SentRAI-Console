import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_docs_endpoint(client: AsyncClient):
    resp = await client.get("/api/v1/docs")
    assert resp.status_code == 200
    data = resp.json()
    assert "content" in data
    assert "SentrAI" in data["content"]
    assert "error" not in data or data["error"] is None


@pytest.mark.asyncio
async def test_get_docs_image(client: AsyncClient):
    resp = await client.get("/images/pillar-roadmap.png")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
