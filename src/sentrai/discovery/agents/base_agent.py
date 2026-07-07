import abc
from typing import Any

class BaseDiscoveryAgent(abc.ABC):
    @property
    @abc.abstractmethod
    def name(self) -> str:
        pass

    @abc.abstractmethod
    async def process(self, context: dict[str, Any]) -> None:
        """
        Executes agent logic on the shared context.
        Shared context keys:
          - "root_path": Path
          - "file_paths": list of Path objects
          - "candidates": list of DiscoveredModelCandidate objects
        """
        pass
