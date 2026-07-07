"""
JWT Authentication middleware and dependency.
Provides get_current_user() FastAPI dependency for all protected endpoints.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from sentrai.domain.user import Role, User

SECRET_KEY = os.environ.get("SENTRAI_JWT_SECRET", "CHANGE_ME_IN_PRODUCTION_secret_key_32chars")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8   # 8 hours
REFRESH_TOKEN_EXPIRE_DAYS = 30

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token", auto_error=False)


def create_access_token(subject: str, role: str, tenant_id: str | None = None, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {
        "sub": subject,
        "role": role,
        "tenant_id": tenant_id,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": subject, "exp": expire, "type": "refresh"}, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(token: Annotated[str | None, Depends(oauth2_scheme)]) -> User | None:
    """
    FastAPI dependency — returns the authenticated User, or None if no token provided.
    Endpoints that require auth should use get_required_user instead.
    """
    if not token:
        return None
    payload = decode_token(token)
    import uuid
    tenant_id_str = payload.get("tenant_id")
    
    return User(
        user_id=payload.get("sub"), # Usually an email here
        email=payload.get("sub"),
        full_name=payload.get("name", ""),
        role=Role(payload.get("role", Role.VIEWER)),
        tenant_id=uuid.UUID(tenant_id_str) if tenant_id_str else None,
    )


async def get_required_user(current_user: Annotated[User | None, Depends(get_current_user)]) -> User:
    """Dependency that enforces authentication (403 if no valid token)."""
    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user


def require_role(*roles: Role):
    """Returns a FastAPI dependency that enforces one of the given roles."""
    async def _checker(current_user: User = Depends(get_required_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role}' is not permitted. Required: {[r.value for r in roles]}",
            )
        return current_user
    return _checker
