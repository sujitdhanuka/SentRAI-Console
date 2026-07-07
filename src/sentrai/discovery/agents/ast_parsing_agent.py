from typing import Any
from pathlib import Path
from sentrai.discovery.agents.base_agent import BaseDiscoveryAgent
from sentrai.discovery.codebase_scanner import _ast_scan_python, _ast_scan_js_ts

class ASTParsingAgent(BaseDiscoveryAgent):
    @property
    def name(self) -> str:
        return "AST Parsing Agent"

    async def process(self, context: dict[str, Any]) -> None:
        # This agent processes candidates to enrich them with AST insights
        for candidate in context.get("candidates", []):
            file_path = Path(context["root_path"]) / candidate.file_path
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue

            detected_libs = set()
            ast_gaps = []
            
            if file_path.suffix == ".py":
                detected_libs, ast_gaps = _ast_scan_python(content)
            elif file_path.suffix in (".js", ".jsx", ".ts", ".tsx"):
                detected_libs, ast_gaps = _ast_scan_js_ts(content)

            # Enrich candidate gaps with AST findings
            candidate.gaps.extend(ast_gaps)
