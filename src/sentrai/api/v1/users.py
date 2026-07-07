import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import bcrypt

from sentrai.api.middleware.auth import require_role
from sentrai.domain.user import Role, User
from sentrai.infrastructure.database import get_db
from sentrai.infrastructure.orm_models import UserORM, OrganizationORM


router = APIRouter(prefix="/users", tags=["Users"])


class AddUserRequest(BaseModel):
    email: str
    full_name: str
    password: str
    role: str
    organization_id: str | None = None


class ResetPasswordRequest(BaseModel):
    new_password: str


class UserResponse(BaseModel):
    user_id: str
    email: str
    full_name: str
    role: str
    is_active: bool
    organization_id: str | None = None
    organization_name: str | None = None


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


@router.get("/", response_model=list[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_role(Role.ADMIN))
):
    q = select(UserORM).order_by(UserORM.created_at.desc())
    if admin_user.tenant_id is not None:
        q = q.where(UserORM.tenant_id == admin_user.tenant_id)
        
    result = await db.execute(q)
    users = result.scalars().all()
    
    responses = []
    for u in users:
        org_name = None
        if u.tenant_id:
            org_res = await db.execute(select(OrganizationORM).where(OrganizationORM.id == u.tenant_id))
            org = org_res.scalar_one_or_none()
            if org:
                org_name = org.name
                
        responses.append(UserResponse(
            user_id=str(u.id),
            email=u.email,
            full_name=u.full_name,
            role=u.role,
            is_active=u.is_active,
            organization_id=str(u.tenant_id) if u.tenant_id else None,
            organization_name=org_name
        ))
    return responses


@router.post("/", response_model=UserResponse)
async def add_user(
    payload: AddUserRequest,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_role(Role.ADMIN))
):
    result = await db.execute(select(UserORM).where(UserORM.email == payload.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User already exists")
        
    # Org Admin must create users in their own org
    if admin_user.tenant_id is not None:
        payload.organization_id = str(admin_user.tenant_id)
    
    now = datetime.now(timezone.utc)
    new_user = UserORM(
        id=uuid.uuid4(),
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=_hash_password(payload.password),
        role=payload.role,
        tenant_id=uuid.UUID(payload.organization_id) if payload.organization_id else None,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(new_user)
    await db.commit()
    
    org_name = None
    if new_user.tenant_id:
        org_res = await db.execute(select(OrganizationORM).where(OrganizationORM.id == new_user.tenant_id))
        org = org_res.scalar_one_or_none()
        if org:
            org_name = org.name

    return UserResponse(
        user_id=str(new_user.id),
        email=new_user.email,
        full_name=new_user.full_name,
        role=new_user.role,
        is_active=new_user.is_active,
        organization_id=str(new_user.tenant_id) if new_user.tenant_id else None,
        organization_name=org_name
    )


@router.patch("/{user_id}/reset-password")
async def reset_password(
    user_id: uuid.UUID,
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_role(Role.ADMIN))
):
    result = await db.execute(select(UserORM).where(UserORM.id == user_id))
    user_to_update = result.scalar_one_or_none()
    if not user_to_update:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Org Admin can only reset users in their own org
    if admin_user.tenant_id is not None:
        if user_to_update.tenant_id != admin_user.tenant_id:
            raise HTTPException(status_code=403, detail="Cannot modify users outside your organization")

    user_to_update.hashed_password = _hash_password(payload.new_password)
    user_to_update.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "success", "message": "Password updated"}
