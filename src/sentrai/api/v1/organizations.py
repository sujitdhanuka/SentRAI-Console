import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sentrai.api.middleware.auth import require_role
from sentrai.domain.user import Role, User
from sentrai.infrastructure.database import get_db
from sentrai.infrastructure.orm_models import OrganizationORM

router = APIRouter(prefix="/organizations", tags=["Organizations"])

class CreateOrganizationRequest(BaseModel):
    name: str
    description: str = ""

class OrganizationResponse(BaseModel):
    organization_id: str
    name: str
    description: str
    created_at: datetime

@router.get("/", response_model=list[OrganizationResponse])
async def list_organizations(
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_role(Role.ADMIN))
):
    if admin_user.tenant_id is not None:
        raise HTTPException(status_code=403, detail="Only Global Admins can view organizations")
        
    result = await db.execute(select(OrganizationORM).order_by(OrganizationORM.created_at.desc()))
    orgs = result.scalars().all()
    return [
        OrganizationResponse(
            organization_id=str(o.id),
            name=o.name,
            description=o.description,
            created_at=o.created_at
        ) for o in orgs
    ]

@router.post("/", response_model=OrganizationResponse)
async def create_organization(
    payload: CreateOrganizationRequest,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_role(Role.ADMIN))
):
    if admin_user.tenant_id is not None:
        raise HTTPException(status_code=403, detail="Only Global Admins can create organizations")
        
    result = await db.execute(select(OrganizationORM).where(OrganizationORM.name == payload.name))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Organization already exists")
    
    now = datetime.now(timezone.utc)
    new_org = OrganizationORM(
        id=uuid.uuid4(),
        name=payload.name,
        description=payload.description,
        created_at=now,
        updated_at=now,
    )
    db.add(new_org)
    await db.commit()
    return OrganizationResponse(
        organization_id=str(new_org.id),
        name=new_org.name,
        description=new_org.description,
        created_at=new_org.created_at
    )
