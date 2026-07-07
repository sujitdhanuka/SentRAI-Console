from typing import Any, List
from pathlib import Path
from sentrai.discovery.agents.base_agent import BaseDiscoveryAgent

class SupervisorCoordinator:
    def __init__(self):
        self.agents: List[BaseDiscoveryAgent] = []

    def register_agent(self, agent: BaseDiscoveryAgent) -> None:
        self.agents.append(agent)

    async def coordinate_scan(self, root_path: Path) -> dict[str, Any]:
        context: dict[str, Any] = {
            "root_path": root_path,
            "file_paths": [],
            "candidates": []
        }

        # Coordinate registered agents sequentially
        for agent in self.agents:
            await agent.process(context)

        return context
