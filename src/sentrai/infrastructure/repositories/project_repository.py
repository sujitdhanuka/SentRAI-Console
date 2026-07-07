import uuid
from typing import Sequence
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sentrai.domain.project import Project
from sentrai.ports.database import ProjectRepository
from sentrai.infrastructure.orm_models import ProjectORM

class SQLAlchemyProjectRepository(ProjectRepository):
    def __init__(self, session: AsyncSession):
        self.session = session

    async def save(self, project: Project) -> None:
        # Check if it exists
        orm = await self.session.get(ProjectORM, project.project_id)
        if orm:
            orm.name = project.name
            orm.description = project.description
            orm.root_directory = project.root_directory
            orm.last_scanned_at = project.last_scanned_at
            orm.tenant_id = project.tenant_id
            orm.updated_at = project.updated_at
        else:
            orm = ProjectORM(
                id=project.project_id,
                name=project.name,
                description=project.description,
                root_directory=project.root_directory,
                last_scanned_at=project.last_scanned_at,
                tenant_id=project.tenant_id,
                created_at=project.created_at,
                updated_at=project.updated_at
            )
            self.session.add(orm)
        await self.session.flush()

    async def get_by_id(self, project_id: uuid.UUID) -> Project | None:
        orm = await self.session.get(ProjectORM, project_id)
        if not orm:
            return None
        return Project(
            project_id=orm.id,
            name=orm.name,
            root_directory=orm.root_directory,
            description=orm.description,
            last_scanned_at=orm.last_scanned_at,
            tenant_id=orm.tenant_id,
            created_at=orm.created_at,
            updated_at=orm.updated_at
        )

    async def list_all(self, tenant_id: uuid.UUID | None = None) -> Sequence[Project]:
        q = select(ProjectORM).order_by(ProjectORM.created_at.desc())
        if tenant_id:
            q = q.where(ProjectORM.tenant_id == tenant_id)
        result = await self.session.execute(q)
        rows = result.scalars().all()
        return [
            Project(
                project_id=r.id,
                name=r.name,
                root_directory=r.root_directory,
                description=r.description,
                last_scanned_at=r.last_scanned_at,
                tenant_id=r.tenant_id,
                created_at=r.created_at,
                updated_at=r.updated_at
            ) for r in rows
        ]

    async def delete(self, project_id: uuid.UUID) -> None:
        orm = await self.session.get(ProjectORM, project_id)
        if orm:
            await self.session.delete(orm)
            await self.session.flush()
