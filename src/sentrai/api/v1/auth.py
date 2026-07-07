"""
Auth API — token issuance, refresh, and current user info.
POST /api/v1/auth/token  — username/password → JWT
POST /api/v1/auth/refresh — refresh token → new access token
GET  /api/v1/auth/me      — current user info
POST /api/v1/auth/register — create a new user (admin only in production)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
import bcrypt
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sentrai.api.middleware.auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_required_user,
)
from sentrai.domain.user import Role, User
from sentrai.infrastructure.database import get_db
from sentrai.infrastructure.orm_models import UserORM

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str


class RefreshRequest(BaseModel):
    refresh_token: str


class RegisterRequest(BaseModel):
    email: str
    full_name: str
    password: str
    role: str = "VIEWER"


class UserResponse(BaseModel):
    user_id: str
    email: str
    full_name: str
    role: str
    tenant_id: str | None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


async def _get_user_by_email(db: AsyncSession, email: str) -> UserORM | None:
    result = await db.execute(select(UserORM).where(UserORM.email == email))
    return result.scalar_one_or_none()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/token", response_model=TokenResponse)
async def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    user_orm = await _get_user_by_email(db, form_data.username)
    if not user_orm or not _verify_password(form_data.password, user_orm.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user_orm.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    tenant_id = str(user_orm.tenant_id) if user_orm.tenant_id else None
    access = create_access_token(str(user_orm.email), user_orm.role, tenant_id)
    refresh = create_refresh_token(str(user_orm.email))
    return TokenResponse(access_token=access, refresh_token=refresh, role=user_orm.role)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    claims = decode_token(payload.refresh_token)
    if claims.get("type") != "refresh":
        raise HTTPException(status_code=400, detail="Not a refresh token")

    email = claims.get("sub")
    user_orm = await _get_user_by_email(db, email)
    if not user_orm or not user_orm.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    tenant_id = str(user_orm.tenant_id) if user_orm.tenant_id else None
    access = create_access_token(email, user_orm.role, tenant_id)
    new_refresh = create_refresh_token(email)
    return TokenResponse(access_token=access, refresh_token=new_refresh, role=user_orm.role)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_required_user)) -> UserResponse:
    return UserResponse(
        user_id=str(current_user.user_id),
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role.value,
        tenant_id=str(current_user.tenant_id) if current_user.tenant_id else None,
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register_user(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> UserResponse:
    """
    Create a new user. In production this should be admin-only.
    For now it is open to allow initial setup.
    """
    existing = await _get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(status_code=409, detail=f"User '{payload.email}' already exists")

    now = datetime.now(timezone.utc)
    user_orm = UserORM(
        id=uuid.uuid4(),
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=_hash_password(payload.password),
        role=payload.role,
        tenant_id=None,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    
    db.add(user_orm)
    await db.commit()

    return UserResponse(
        user_id=str(user_orm.id),
        email=user_orm.email,
        full_name=user_orm.full_name,
        role=user_orm.role,
        tenant_id=None,
    )
