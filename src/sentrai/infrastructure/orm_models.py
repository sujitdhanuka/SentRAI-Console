"""
SQLAlchemy ORM models — append-only ledger pattern for inventory (REC 23).
Incident and audit tables are write-once, update-never for immutability.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from sentrai.domain.enums import (
    AuditType,
    DriftStatus,
    IncidentCategory,
    IncidentSeverity,
    IncidentStatus,
    ModelLifecycleStage,
    ModelType,
    RiskLevel,
)
from sentrai.infrastructure.database import Base


class OrganizationORM(Base):
    """
    A tenant organization. Used to partition projects, models, and users.
    """
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    users: Mapped[list["UserORM"]] = relationship(back_populates="organization")
    projects: Mapped[list["ProjectORM"]] = relationship(back_populates="organization")


class ProjectORM(Base):
    """
    A tracked application/codebase. Each project owns its own scan history
    and model inventory — discovery and tracking are scoped per project so
    multiple applications' AI systems don't get mixed into one flat pool.
    """
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    root_directory: Mapped[str] = mapped_column(String(1000), nullable=False)
    last_scanned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)

    models: Mapped[list["AIModelORM"]] = relationship(back_populates="project")
    organization: Mapped["OrganizationORM | None"] = relationship(back_populates="projects")


class AIModelORM(Base):
    __tablename__ = "ai_models"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_type: Mapped[str] = mapped_column(SAEnum(ModelType), nullable=False)
    functional_area: Mapped[str] = mapped_column(String(255), nullable=False)
    use_case_description: Mapped[str] = mapped_column(Text, nullable=False)
    target_customer_segments: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    risk_level: Mapped[str] = mapped_column(SAEnum(RiskLevel), nullable=False)
    lifecycle_stage: Mapped[str] = mapped_column(SAEnum(ModelLifecycleStage), nullable=False)
    owner_team: Mapped[str] = mapped_column(String(255), nullable=False)
    developed_by: Mapped[str] = mapped_column(String(255), nullable=False)
    deployment_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dependencies: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    performance_benchmarks: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    sutras_alignment: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    human_oversight_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    autonomous_scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    board_policy_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    last_red_team_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_audit_due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    grievance_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    grievance_resolution_notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source_ref: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    ledger_events: Mapped[list["ModelLedgerEventORM"]] = relationship(back_populates="model")
    incidents: Mapped[list["AIIncidentORM"]] = relationship(back_populates="model")
    drift_reports: Mapped[list["DriftReportORM"]] = relationship(back_populates="model")
    project: Mapped["ProjectORM | None"] = relationship(back_populates="models")
    prompts: Mapped[list["PromptORM"]] = relationship(back_populates="model", cascade="all, delete-orphan")


class PromptORM(Base):
    __tablename__ = "prompts"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("ai_models.id"), nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_type: Mapped[str] = mapped_column(String(50), nullable=False)
    injection_risk: Mapped[str] = mapped_column(String(50), nullable=False, default="LOW")
    pii_detected: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    model: Mapped["AIModelORM"] = relationship(back_populates="prompts")


class ModelLedgerEventORM(Base):
    """Immutable append-only ledger of all state changes (REC 23)."""
    __tablename__ = "model_ledger_events"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("ai_models.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    event_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    actor: Mapped[str] = mapped_column(String(255), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    model: Mapped["AIModelORM"] = relationship(back_populates="ledger_events")


class AIIncidentORM(Base):
    __tablename__ = "ai_incidents"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("ai_models.id"), nullable=False)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    re_name: Mapped[str] = mapped_column(String(255), nullable=False)
    functional_area: Mapped[str] = mapped_column(String(255), nullable=False)
    incident_category: Mapped[str] = mapped_column(SAEnum(IncidentCategory), nullable=False)
    severity: Mapped[str] = mapped_column(SAEnum(IncidentSeverity), nullable=False)
    status: Mapped[str] = mapped_column(SAEnum(IncidentStatus), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reporting_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    affected_consumers: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    model_risk_level: Mapped[str] = mapped_column(SAEnum(RiskLevel), nullable=False)
    autonomous_system_involved: Mapped[bool] = mapped_column(Boolean, nullable=False)
    immediate_action_taken: Mapped[str] = mapped_column(Text, nullable=False)
    system_suspended: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fallback_activated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rca: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    repeat_incident: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    prior_incident_refs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    regulator_notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    board_informed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    model: Mapped["AIModelORM"] = relationship(back_populates="incidents")


class DriftReportORM(Base):
    __tablename__ = "drift_reports"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("ai_models.id"), nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    psi_score: Mapped[float] = mapped_column(Float, nullable=False)
    wasserstein_distance: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy_delta: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(SAEnum(DriftStatus), nullable=False)
    circuit_breaker_active: Mapped[bool] = mapped_column(Boolean, nullable=False)
    human_review_ticket: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remediation_action: Mapped[str | None] = mapped_column(Text, nullable=True)

    model: Mapped["AIModelORM"] = relationship(back_populates="drift_reports")


class AIAuditTrailORM(Base):
    __tablename__ = "ai_audit_trails"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("ai_models.id"), nullable=False)
    audit_type: Mapped[str] = mapped_column(SAEnum(AuditType), nullable=False)
    auditor_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    risk_level: Mapped[str] = mapped_column(SAEnum(RiskLevel), nullable=False)
    audit_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    audit_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    input_data_audit: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    model_algo_audit: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    output_behaviour_audit: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    fairness_metrics: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    explainability_score: Mapped[float] = mapped_column(Float, nullable=False)
    sutras_compliance: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    findings: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    overall_verdict: Mapped[str] = mapped_column(String(50), nullable=False, default="PENDING")
    next_audit_due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class UserORM(Base):
    """Platform user with RBAC role."""
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="VIEWER")
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    
    organization: Mapped["OrganizationORM | None"] = relationship(back_populates="users")

