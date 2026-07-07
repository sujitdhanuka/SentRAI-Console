"""
Framework plugin registry — central registry for all installed compliance frameworks.
Adding a new framework requires only creating a plugin class and registering it here.
The core engine never changes.
"""
from __future__ import annotations

from sentrai.compliance.frameworks.base_plugin import FrameworkComplianceReport
from sentrai.compliance.frameworks.iso_42001 import ISO42001Plugin
from sentrai.compliance.frameworks.eu_ai_act import EUAIActPlugin

# Lazy-import RBI plugin from existing sutras_validator to preserve backward compat
from sentrai.compliance.frameworks.rbi_free_ai import RBIFreeAIPlugin

_REGISTRY: dict[str, object] = {
    "RBI_FREE_AI": RBIFreeAIPlugin(),
    "ISO_42001": ISO42001Plugin(),
    "EU_AI_ACT": EUAIActPlugin(),
}


def list_frameworks() -> list[dict]:
    """Return metadata for all registered frameworks."""
    return [
        {
            "framework_id": p.framework_id,
            "framework_name": p.framework_name,
            "framework_version": p.framework_version,
        }
        for p in _REGISTRY.values()
    ]


def evaluate(asset: dict, framework_id: str) -> FrameworkComplianceReport:
    """Evaluate an asset against the specified framework plugin."""
    plugin = _REGISTRY.get(framework_id.upper())
    if not plugin:
        raise ValueError(f"Unknown compliance framework: '{framework_id}'. Available: {list(_REGISTRY.keys())}")
    return plugin.evaluate(asset)


def evaluate_all(asset: dict) -> list[FrameworkComplianceReport]:
    """Evaluate an asset against all installed frameworks."""
    return [plugin.evaluate(asset) for plugin in _REGISTRY.values()]


def register(framework_id: str, plugin: object) -> None:
    """Register a third-party compliance plugin at runtime."""
    _REGISTRY[framework_id.upper()] = plugin
