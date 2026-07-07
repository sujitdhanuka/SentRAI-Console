import abc
import uuid
from typing import Sequence
from sentrai.domain.project import Project
from sentrai.domain.model_inventory import AIModelEntry

from sentrai.domain.enums import RiskLevel

class ProjectRepository(abc.ABC):
    @abc.abstractmethod
    async def save(self, project: Project) -> None:
        pass

    @abc.abstractmethod
    async def get_by_id(self, project_id: uuid.UUID) -> Project | None:
        pass

    @abc.abstractmethod
    async def list_all(self, tenant_id: uuid.UUID | None = None) -> Sequence[Project]:
        pass

    @abc.abstractmethod
    async def delete(self, project_id: uuid.UUID) -> None:
        pass

class AIModelRepository(abc.ABC):
    @abc.abstractmethod
    async def save(self, model: AIModelEntry) -> None:
        pass

    @abc.abstractmethod
    async def get_by_id(self, model_id: uuid.UUID) -> AIModelEntry | None:
        pass

    @abc.abstractmethod
    async def list_by_project(self, project_id: uuid.UUID) -> Sequence[AIModelEntry]:
        pass

    @abc.abstractmethod
    async def list_all(
        self,
        active_only: bool = True,
        risk_level: RiskLevel | None = None,
        project_id: uuid.UUID | None = None,
        tenant_id: uuid.UUID | None = None
    ) -> Sequence[AIModelEntry]:
        pass

    @abc.abstractmethod
    async def delete(self, model_id: uuid.UUID) -> None:
        pass
