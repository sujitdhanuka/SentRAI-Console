import pytest
from datetime import datetime, timezone
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sentrai.infrastructure.orm_models import AIModelORM

@pytest.mark.anyio
async def test_metrics_endpoint(client: AsyncClient, db_session: AsyncSession):
    # Register a dummy model
    model = AIModelORM(
        name="Test ML Model",
        model_type="MACHINE_LEARNING",
        functional_area="credit_underwriting",
        use_case_description="Dummy model description",
        target_customer_segments=["retail"],
        risk_level="HIGH",
        lifecycle_stage="DEPLOYED",
        owner_team="Risk",
        developed_by="internal",
        board_policy_ref="POL-001",
        is_active=True,
        registered_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(model)
    await db_session.commit()

    res = await client.get("/metrics")
    assert res.status_code == 200
    assert "sentrai_models_total" in res.text
    assert "sentrai_compliant_models_total" in res.text
    assert "sentrai_open_governance_gaps" in res.text
    assert "sentrai_drift_alerts_total" in res.text


@pytest.mark.anyio
async def test_gpu_status_endpoint(client):
    res = await client.get("/api/v1/monitoring/gpu/status")
    assert res.status_code == 200
    data = res.json()
    assert "gpus" in data
    assert len(data["gpus"]) > 0
    assert data["gpus"][0]["name"] == "NVIDIA H100 PCIe 80GB"


@pytest.mark.anyio
async def test_scan_infrastructure_endpoint(client):
    # Test Kubernetes scan route
    res = await client.post("/api/v1/discovery/scan-infrastructure", json={
        "provider": "kubernetes",
        "namespace": "default"
    })
    assert res.status_code == 200
    data = res.json()
    assert "deployments" in data
    assert len(data["deployments"]) > 0
    assert data["deployments"][0]["name"] == "credit-risk-predictor"

    # Test Triton scan route with mock payload
    res = await client.post("/api/v1/discovery/scan-infrastructure", json={
        "provider": "triton",
        "endpoint_url": "http://localhost:8000"
    })
    assert res.status_code == 200

