from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from sentrai.api.middleware.dpdp_masking import DPDPMaskingMiddleware
from sentrai.api.v1 import audit, discovery, incidents, inventory, monitoring, projects, metrics, auth, users, organizations
from sentrai.config import settings
from sentrai.infrastructure.database import Base, engine, AsyncSessionLocal
import uuid
import bcrypt
from datetime import datetime, timezone
from sqlalchemy import select
import sentrai.infrastructure.orm_models  # noqa: F401 — ensures all ORM tables are registered

WEB_DIR = Path(__file__).parent / "web"
templates = Jinja2Templates(directory=str(WEB_DIR / "templates"))

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Database schema is now managed by Alembic migrations.
    # To create or update the schema, run: `alembic upgrade head`

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(sentrai.infrastructure.orm_models.UserORM).where(
                sentrai.infrastructure.orm_models.UserORM.email == "admin@sentrai.local"
            )
        )
        if not result.scalar_one_or_none():
            now = datetime.now(timezone.utc)
            hashed_pw = bcrypt.hashpw("admin123".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            admin_user = sentrai.infrastructure.orm_models.UserORM(
                id=uuid.uuid4(),
                email="admin@sentrai.local",
                full_name="Default Admin",
                hashed_password=hashed_pw,
                role="ADMIN",
                tenant_id=None,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            session.add(admin_user)
            await session.commit()
            
    yield


app = FastAPI(
    title="SentRAI - Console",
    lifespan=lifespan,
    description=(
        "RBI SentrAI Framework Compliance Backend.\n\n"
        "Implements Recommendations 16, 21–26: AI Inventory Ledger, "
        "Drift Monitoring, Audit Framework, and Incident Reporting."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(DPDPMaskingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-internal-dashboard.example.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"
app.include_router(inventory.router, prefix=API_PREFIX)
app.include_router(incidents.router, prefix=API_PREFIX)
app.include_router(monitoring.router, prefix=API_PREFIX)
app.include_router(audit.router, prefix=API_PREFIX)
app.include_router(discovery.router, prefix=API_PREFIX)
app.include_router(projects.router, prefix=API_PREFIX)
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(users.router, prefix=API_PREFIX)
app.include_router(organizations.router, prefix=API_PREFIX)
app.include_router(metrics.router)

app.mount("/static", StaticFiles(directory=str(WEB_DIR / "static")), name="static")
app.mount("/images", StaticFiles(directory=str(Path(__file__).parents[2] / "docs" / "images")), name="images")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def dashboard(request: Request) -> HTMLResponse:
    """Serves the compliance console UI — a single-page dashboard with no build step."""
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/v1/docs")
async def get_docs() -> dict:
    """Serves the HELP.md content as JSON."""
    docs_path = Path(__file__).parents[2] / "docs" / "HELP.md"
    try:
        with open(docs_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        return {"error": f"Failed to read HELP.md: {str(e)}", "content": ""}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.app_name}


@app.get("/api/v1/sutras")
async def list_sutras() -> dict:
    return {
        "framework": "SentrAI",
        "issued_by": "Reserve Bank of India",
        "date": "August 2025",
        "sutras": [
            {"id": 1, "name": "Trust is the Foundation", "principle": "Trust is non-negotiable and should remain uncompromised"},
            {"id": 2, "name": "People First", "principle": "AI should augment human decision-making but defer to human judgment"},
            {"id": 3, "name": "Innovation over Restraint", "principle": "Foster responsible innovation with purpose"},
            {"id": 4, "name": "Fairness and Equity", "principle": "AI outcomes should be fair and non-discriminatory"},
            {"id": 5, "name": "Accountability", "principle": "Accountability rests with the entities deploying AI"},
            {"id": 6, "name": "Understandable by Design", "principle": "Ensure explainability for trust"},
            {"id": 7, "name": "Safety, Resilience, and Sustainability", "principle": "AI systems should be secure, resilient and energy efficient"},
        ],
        "pillars": ["Infrastructure", "Policy", "Capacity", "Governance", "Protection", "Assurance"],
        "total_recommendations": 26,
    }
