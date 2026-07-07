import uuid
from typing import Sequence
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sentrai.domain.enums import ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment
from sentrai.domain.model_inventory import AIModelEntry
from sentrai.ports.database import AIModelRepository
from sentrai.infrastructure.orm_models import AIModelORM

class SQLAlchemyAIModelRepository(AIModelRepository):
    def __init__(self, session: AsyncSession):
        self.session = session

    def _orm_to_entry(self, orm: AIModelORM) -> AIModelEntry:
        return AIModelEntry(
            model_id=orm.id,
            name=orm.name,
            model_type=ModelType(orm.model_type),
            functional_area=orm.functional_area,
            use_case_description=orm.use_case_description,
            target_customer_segments=orm.target_customer_segments,
            risk_level=RiskLevel(orm.risk_level),
            lifecycle_stage=ModelLifecycleStage(orm.lifecycle_stage),
            owner_team=orm.owner_team,
            developed_by=orm.developed_by,
            deployment_date=orm.deployment_date,
            dependencies=orm.dependencies or [],
            performance_benchmarks=orm.performance_benchmarks or [],
            sutras_alignment=[SutraAlignment(s) for s in (orm.sutras_alignment or [])],
            human_oversight_required=orm.human_oversight_required,
            autonomous_scope=orm.autonomous_scope,
            board_policy_ref=orm.board_policy_ref,
            last_red_team_date=orm.last_red_team_date,
            next_audit_due=orm.next_audit_due,
            grievance_count=orm.grievance_count,
            grievance_resolution_notes=orm.grievance_resolution_notes,
            source_ref=orm.source_ref,
            registered_at=orm.registered_at,
            updated_at=orm.updated_at,
            is_active=orm.is_active,
            project_id=orm.project_id,
        )

    async def save(self, model: AIModelEntry) -> None:
        orm = await self.session.get(AIModelORM, model.model_id)
        if orm:
            orm.project_id = model.project_id
            orm.name = model.name
            orm.model_type = model.model_type.value
            orm.functional_area = model.functional_area
            orm.use_case_description = model.use_case_description
            orm.target_customer_segments = model.target_customer_segments
            orm.risk_level = model.risk_level.value
            orm.lifecycle_stage = model.lifecycle_stage.value
            orm.owner_team = model.owner_team
            orm.developed_by = model.developed_by
            orm.deployment_date = model.deployment_date
            orm.dependencies = [d if isinstance(d, dict) else vars(d) for d in model.dependencies]
            orm.performance_benchmarks = [p if isinstance(p, dict) else vars(p) for p in model.performance_benchmarks]
            orm.sutras_alignment = [s.value for s in model.sutras_alignment]
            orm.human_oversight_required = model.human_oversight_required
            orm.autonomous_scope = model.autonomous_scope
            orm.board_policy_ref = model.board_policy_ref
            orm.last_red_team_date = model.last_red_team_date
            orm.next_audit_due = model.next_audit_due
            orm.grievance_count = model.grievance_count
            orm.grievance_resolution_notes = model.grievance_resolution_notes
            orm.source_ref = model.source_ref
            orm.is_active = model.is_active
            orm.updated_at = model.updated_at
        else:
            orm = AIModelORM(
                id=model.model_id,
                project_id=model.project_id,
                name=model.name,
                model_type=model.model_type.value,
                functional_area=model.functional_area,
                use_case_description=model.use_case_description,
                target_customer_segments=model.target_customer_segments,
                risk_level=model.risk_level.value,
                lifecycle_stage=model.lifecycle_stage.value,
                owner_team=model.owner_team,
                developed_by=model.developed_by,
                deployment_date=model.deployment_date,
                dependencies=[d if isinstance(d, dict) else vars(d) for d in model.dependencies],
                performance_benchmarks=[p if isinstance(p, dict) else vars(p) for p in model.performance_benchmarks],
                sutras_alignment=[s.value for s in model.sutras_alignment],
                human_oversight_required=model.human_oversight_required,
                autonomous_scope=model.autonomous_scope,
                board_policy_ref=model.board_policy_ref,
                last_red_team_date=model.last_red_team_date,
                next_audit_due=model.next_audit_due,
                grievance_count=model.grievance_count,
                grievance_resolution_notes=model.grievance_resolution_notes,
                source_ref=model.source_ref,
                is_active=model.is_active,
                registered_at=model.registered_at,
                updated_at=model.updated_at
            )
            self.session.add(orm)
        await self.session.flush()

    async def get_by_id(self, model_id: uuid.UUID) -> AIModelEntry | None:
        orm = await self.session.get(AIModelORM, model_id)
        if not orm:
            return None
        return self._orm_to_entry(orm)

    async def list_by_project(self, project_id: uuid.UUID) -> Sequence[AIModelEntry]:
        result = await self.session.execute(
            select(AIModelORM).where(AIModelORM.project_id == project_id, AIModelORM.is_active.is_(True))
        )
        rows = result.scalars().all()
        return [self._orm_to_entry(r) for r in rows]

    async def list_all(
        self,
        active_only: bool = True,
        risk_level: RiskLevel | None = None,
        project_id: uuid.UUID | None = None,
        tenant_id: uuid.UUID | None = None
    ) -> Sequence[AIModelEntry]:
        from sentrai.infrastructure.orm_models import ProjectORM
        q = select(AIModelORM)
        if tenant_id:
            q = q.join(ProjectORM, AIModelORM.project_id == ProjectORM.id).where(ProjectORM.tenant_id == tenant_id)
        if active_only:
            q = q.where(AIModelORM.is_active.is_(True))
        if risk_level:
            q = q.where(AIModelORM.risk_level == risk_level.value)
        if project_id:
            q = q.where(AIModelORM.project_id == project_id)
        result = await self.session.execute(q)
        rows = result.scalars().all()
        return [self._orm_to_entry(r) for r in rows]

    async def delete(self, model_id: uuid.UUID) -> None:
        orm = await self.session.get(AIModelORM, model_id)
        if orm:
            await self.session.delete(orm)
            await self.session.flush()
