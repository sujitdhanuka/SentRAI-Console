import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from sentrai.infrastructure.database import Base, get_db
from sentrai.main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture(scope="function")
async def db_session():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession):
    async def override_db():
        yield db_session

    from sentrai.api.middleware.auth import get_current_user
    from sentrai.domain.user import User, Role
    import uuid

    mock_tenant_id = uuid.uuid4()
    
    async def override_get_current_user():
        return User(
            user_id="test@example.com",
            email="test@example.com",
            full_name="Test User",
            role=Role.ADMIN,
            tenant_id=mock_tenant_id,
        )

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def sample_model_payload() -> dict:
    return {
        "name": "Credit Risk Scorer v2",
        "model_type": "MACHINE_LEARNING",
        "functional_area": "credit_underwriting",
        "use_case_description": "Predicts probability of default for retail loan applicants using bureau and transactional data.",
        "target_customer_segments": ["retail_borrowers", "sme"],
        "owner_team": "Credit AI Team",
        "developed_by": "internal",
        "human_oversight_required": True,
        "board_policy_ref": "AI-POLICY-2025-CREDIT-001",
        "sutras_alignment": [
            "FAIRNESS_AND_EQUITY",
            "UNDERSTANDABLE_BY_DESIGN",
            "ACCOUNTABILITY",
        ],
    }


@pytest.fixture
def sample_incident_payload(sample_model_payload: dict) -> dict:
    return {
        "model_id": str(uuid.uuid4()),
        "model_name": "Credit Risk Scorer v2",
        "re_name": "Example Scheduled Commercial Bank",
        "functional_area": "credit_underwriting",
        "incident_category": "BIAS_DISCRIMINATION",
        "severity": "P2_HIGH",
        "description": (
            "Model exhibited statistically significant denial rate disparity "
            "for applicants from rural districts compared to urban counterparts "
            "with equivalent credit profiles. PSI shift detected in bureau score distribution."
        ),
        "observed_at": "2026-06-20T10:00:00Z",
        "detected_at": "2026-06-20T14:00:00Z",
        "model_risk_level": "HIGH",
        "autonomous_system_involved": False,
        "immediate_action_taken": (
            "Model output quarantined for rural district segment. "
            "All pending decisions routed to human underwriters. "
            "Root cause analysis initiated."
        ),
        "system_suspended": True,
        "fallback_activated": True,
        "affected_consumers": {
            "count": 1240,
            "demographic_segment": "rural_loan_applicants",
            "harm_type": "credit_denial_bias",
            "compensation_provided": False,
        },
    }
