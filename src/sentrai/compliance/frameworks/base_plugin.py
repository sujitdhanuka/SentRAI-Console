"""
Base protocol for compliance framework plugins.
Every governance framework (RBI FREE-AI, ISO 42001, EU AI Act, etc.)
must implement this interface. Adding a new framework requires ZERO
changes to the core compliance engine.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol, runtime_checkable


class ControlSeverity(str, Enum):
    BLOCKING = "BLOCKING"    # Must pass before deployment
    MAJOR = "MAJOR"          # Significant compliance gap
    MINOR = "MINOR"          # Advisory / best-practice


@dataclass
class ControlResult:
    control_id: str
    control_name: str
    passed: bool
    severity: ControlSeverity
    message: str
    evidence_required: list[str] = field(default_factory=list)
    remediation: str = ""


@dataclass
class FrameworkComplianceReport:
    framework_id: str
    framework_name: str
    framework_version: str
    asset_id: str
    overall_pass: bool
    score: float                          # 0.0 – 1.0
    blocking_gaps: list[ControlResult] = field(default_factory=list)
    major_gaps: list[ControlResult] = field(default_factory=list)
    minor_gaps: list[ControlResult] = field(default_factory=list)
    passed_controls: list[ControlResult] = field(default_factory=list)

    @property
    def total_controls(self) -> int:
        return len(self.blocking_gaps) + len(self.major_gaps) + len(self.minor_gaps) + len(self.passed_controls)

    def summary(self) -> dict:
        return {
            "framework_id": self.framework_id,
            "framework_name": self.framework_name,
            "overall_pass": self.overall_pass,
            "score": round(self.score, 3),
            "blocking_gaps": len(self.blocking_gaps),
            "major_gaps": len(self.major_gaps),
            "minor_gaps": len(self.minor_gaps),
            "passed_controls": len(self.passed_controls),
            "total_controls": self.total_controls,
        }


@runtime_checkable
class ComplianceFrameworkPlugin(Protocol):
    """
    Plugin protocol — every compliance framework must satisfy this interface.
    """
    framework_id: str       # e.g. "RBI_FREE_AI"
    framework_name: str     # e.g. "RBI FREE-AI Framework"
    framework_version: str  # e.g. "2025"

    def evaluate(self, asset: dict) -> FrameworkComplianceReport:
        """
        Evaluate a model asset dict against this framework's controls.
        asset dict must contain at minimum: model_id, name, risk_level,
        board_policy_ref, lifecycle_stage, sutras_alignment.
        """
        ...
