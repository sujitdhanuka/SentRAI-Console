"""
Projects API — create and track multiple applications/codebases.
Each project owns its own scan history and scoped model inventory.
"""

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from sentrai.compliance.sutras_validator import validate_sutras_compliance
from sentrai.api.middleware.auth import get_required_user
from sentrai.domain.project import Project
from sentrai.domain.user import Role, User
from sentrai.infrastructure.database import get_db
from sentrai.infrastructure.orm_models import AIModelORM, ProjectORM, OrganizationORM
from sentrai.infrastructure.repositories.project_repository import SQLAlchemyProjectRepository

router = APIRouter(prefix="/projects", tags=["Projects"])


class ProjectCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    root_directory: str


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    root_directory: str | None = None


class ProjectResponse(BaseModel):
    project_id: uuid.UUID
    name: str
    description: str
    root_directory: str
    last_scanned_at: datetime | None
    created_at: datetime
    model_count: int = 0
    compliant_count: int = 0
    open_gap_count: int = 0
    tenant_name: str | None = None


def _validate_directory(path_str: str) -> None:
    p = Path(path_str).expanduser()
    if not p.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory the service can see: {p}")


async def _to_response(orm: ProjectORM, db: AsyncSession) -> ProjectResponse:
    q = select(AIModelORM).where(AIModelORM.project_id == orm.id, AIModelORM.is_active.is_(True))
    result = await db.execute(q)
    models = result.scalars().all()

    from sentrai.api.v1.inventory import _orm_to_entry  # local import avoids circular import at module load

    compliant = 0
    open_gaps = 0
    for m in models:
        report = validate_sutras_compliance(_orm_to_entry(m))
        if report.overall_pass:
            compliant += 1
        else:
            open_gaps += len(report.blocking_gaps)

    tenant_name = None
    if orm.tenant_id:
        org_res = await db.execute(select(OrganizationORM).where(OrganizationORM.id == orm.tenant_id))
        org = org_res.scalar_one_or_none()
        if org:
            tenant_name = org.name

    return ProjectResponse(
        project_id=orm.id,
        name=orm.name,
        description=orm.description,
        root_directory=orm.root_directory,
        last_scanned_at=orm.last_scanned_at,
        created_at=orm.created_at,
        model_count=len(models),
        compliant_count=compliant,
        open_gap_count=open_gaps,
        tenant_name=tenant_name,
    )


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_required_user),
) -> ProjectResponse:
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Global Admins cannot create projects. Must be a tenant user.")
    _validate_directory(payload.root_directory)

    existing = await db.execute(select(ProjectORM).where(ProjectORM.name == payload.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"A project named '{payload.name}' already exists")

    project = Project.create(
        name=payload.name,
        root_directory=str(Path(payload.root_directory).expanduser().resolve()),
        description=payload.description,
    )
    project.tenant_id = current_user.tenant_id
    repo = SQLAlchemyProjectRepository(db)
    await repo.save(project)
    
    # Reload model representation to serialize correctly
    orm = await db.get(ProjectORM, project.project_id)
    return await _to_response(orm, db)


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_required_user),
) -> list[ProjectResponse]:
    repo = SQLAlchemyProjectRepository(db)
    projects = await repo.list_all(tenant_id=current_user.tenant_id)
    
    responses = []
    for p in projects:
        orm_res = await db.execute(select(ProjectORM).where(ProjectORM.id == p.project_id))
        orm = orm_res.scalar_one_or_none()
        if orm:
            responses.append(await _to_response(orm, db))
    return responses


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> ProjectResponse:
    repo = SQLAlchemyProjectRepository(db)
    project = await repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    orm = await db.get(ProjectORM, project.project_id)
    return await _to_response(orm, db)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_required_user),
) -> ProjectResponse:
    repo = SQLAlchemyProjectRepository(db)
    project = await repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if current_user.tenant_id is not None and project.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Cannot modify a project outside your organization")

    if payload.name is not None:
        project.name = payload.name
    if payload.description is not None:
        project.description = payload.description
    if payload.root_directory is not None:
        _validate_directory(payload.root_directory)
        project.root_directory = str(Path(payload.root_directory).expanduser().resolve())
    project.updated_at = datetime.now(timezone.utc)
    
    await repo.save(project)
    orm = await db.get(ProjectORM, project.project_id)
    return await _to_response(orm, db)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID,
    cascade: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_required_user),
) -> None:
    repo = SQLAlchemyProjectRepository(db)
    project = await repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if current_user.tenant_id is not None and project.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Cannot delete a project outside your organization")

    count_q = await db.execute(
        select(func.count()).select_from(AIModelORM).where(AIModelORM.project_id == project_id)
    )
    model_count = count_q.scalar_one()
    if model_count > 0:
        if not cascade:
            raise HTTPException(
                status_code=409,
                detail="Cannot delete a project with tracked models. Deactivate or reassign its models first.",
            )
        else:
            await db.execute(
                delete(AIModelORM).where(AIModelORM.project_id == project_id)
            )

    await repo.delete(project_id)
