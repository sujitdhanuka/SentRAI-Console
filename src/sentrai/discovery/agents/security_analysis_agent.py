from typing import Any
from pathlib import Path
from sentrai.discovery.agents.base_agent import BaseDiscoveryAgent
from sentrai.discovery.codebase_scanner import _scan_prompts_and_security

class SecurityAnalysisAgent(BaseDiscoveryAgent):
    @property
    def name(self) -> str:
        return "Security Analysis Agent"

    async def process(self, context: dict[str, Any]) -> None:
        for candidate in context.get("candidates", []):
            file_path = Path(context["root_path"]) / candidate.file_path
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue

            prompts_found, secrets_found = _scan_prompts_and_security(content)
            # Enforce dynamic mapping
            candidate.prompts.extend(prompts_found)
            candidate.secrets.extend(secrets_found)
