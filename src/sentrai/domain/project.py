"""
Project — a tracked application/codebase. Scopes discovery scans and the
model inventory so multiple applications don't get mixed into one flat pool.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Project:
    project_id: uuid.UUID
    name: str
    description: str
    root_directory: str
    last_scanned_at: datetime | None = None
    tenant_id: uuid.UUID | None = None
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)

    @classmethod
    def create(cls, name: str, root_directory: str, description: str = "") -> "Project":
        now = _now()
        return cls(
            project_id=uuid.uuid4(),
            name=name,
            description=description,
            root_directory=root_directory,
            last_scanned_at=None,
            tenant_id=None,
            created_at=now,
            updated_at=now,
        )
