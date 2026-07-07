"""
User domain entity and Role enum.
Represents an authenticated principal inside SentRAI.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum


class Role(str, Enum):
    VIEWER = "VIEWER"
    OWNER = "OWNER"
    REVIEWER = "REVIEWER"
    APPROVER = "APPROVER"
    ADMIN = "ADMIN"
    CISO = "CISO"


class User:
    """Authenticated SentRAI user."""

    def __init__(
        self,
        user_id: uuid.UUID,
        email: str,
        full_name: str,
        role: Role,
        tenant_id: uuid.UUID | None,
        is_active: bool = True,
        created_at: datetime | None = None,
    ) -> None:
        self.user_id = user_id
        self.email = email
        self.full_name = full_name
        self.role = role
        self.tenant_id = tenant_id
        self.is_active = is_active
        self.created_at = created_at or datetime.now(timezone.utc)

    @classmethod
    def create(cls, email: str, full_name: str, role: Role = Role.VIEWER, tenant_id: uuid.UUID | None = None) -> "User":
        return cls(
            user_id=uuid.uuid4(),
            email=email,
            full_name=full_name,
            role=role,
            tenant_id=tenant_id,
        )

    def has_role(self, *roles: Role) -> bool:
        """Returns True if user has at least one of the given roles."""
        return self.role in roles

    def can_admin(self) -> bool:
        return self.role in (Role.ADMIN, Role.CISO)

    def can_approve(self) -> bool:
        return self.role in (Role.APPROVER, Role.ADMIN, Role.CISO)

    def can_write(self) -> bool:
        return self.role in (Role.OWNER, Role.REVIEWER, Role.APPROVER, Role.ADMIN, Role.CISO)
