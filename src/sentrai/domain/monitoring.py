"""
Module B — Automated Performance Monitoring & Drift Detection
REC 16: Detect model drift/degradation; REC 21: BCP fallback mechanisms.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID

import numpy as np
from scipy.stats import wasserstein_distance

from sentrai.domain.enums import DriftStatus


PSI_WARNING_THRESHOLD = 0.10     # moderate shift — RBI-aligned warning band
PSI_ALERT_THRESHOLD   = 0.20     # significant shift — circuit breaker territory


def _now() -> datetime:
    return datetime.now(timezone.utc)


def compute_psi(expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
    """
    Population Stability Index between training (expected) and live (actual).
    PSI < 0.10: no significant change
    PSI 0.10–0.20: moderate shift (warning)
    PSI > 0.20: major shift (alert / retrain)
    """
    eps = 1e-8
    expected_perc, bin_edges = np.histogram(expected, bins=bins)
    actual_perc, _ = np.histogram(actual, bins=bin_edges)

    expected_perc = expected_perc / (expected_perc.sum() + eps)
    actual_perc   = actual_perc   / (actual_perc.sum()   + eps)

    # Replace zeros to avoid log(0)
    expected_perc = np.clip(expected_perc, eps, None)
    actual_perc   = np.clip(actual_perc,   eps, None)

    psi = np.sum((expected_perc - actual_perc) * np.log(expected_perc / actual_perc))
    return float(psi)


def compute_wasserstein(expected: np.ndarray, actual: np.ndarray) -> float:
    return float(wasserstein_distance(expected, actual))


@dataclass
class DriftReport:
    model_id: UUID
    computed_at: datetime
    psi_score: float
    wasserstein_distance: float
    accuracy_delta: float        # current_accuracy - baseline_accuracy
    status: DriftStatus
    circuit_breaker_active: bool
    human_review_ticket: str | None  # ticket ID if escalated
    remediation_action: str | None

    @property
    def summary(self) -> str:
        return (
            f"[{self.status.value}] model={self.model_id} "
            f"PSI={self.psi_score:.4f} W-dist={self.wasserstein_distance:.4f} "
            f"acc_delta={self.accuracy_delta:+.4f} "
            f"circuit_breaker={'ON' if self.circuit_breaker_active else 'OFF'}"
        )


def evaluate_drift(
    model_id: UUID,
    training_scores: np.ndarray,
    live_scores: np.ndarray,
    baseline_accuracy: float,
    current_accuracy: float,
) -> DriftReport:
    """
    Evaluate drift and determine circuit-breaker state.
    Circuit breaker trips when PSI > 0.20 OR accuracy drops > 5 percentage points.
    Human-in-the-loop escalation triggers when circuit breaker is active.
    """
    psi = compute_psi(training_scores, live_scores)
    w_dist = compute_wasserstein(training_scores, live_scores)
    acc_delta = current_accuracy - baseline_accuracy

    circuit_breaker = psi > PSI_ALERT_THRESHOLD or acc_delta < -0.05

    if circuit_breaker:
        status = DriftStatus.CIRCUIT_BREAKER_TRIPPED
    elif psi > PSI_WARNING_THRESHOLD or acc_delta < -0.02:
        status = DriftStatus.WARNING
    else:
        status = DriftStatus.NOMINAL

    human_ticket: str | None = None
    remediation: str | None = None

    if circuit_breaker:
        human_ticket = f"REVIEW-{model_id}-{_now().strftime('%Y%m%d%H%M')}"
        remediation = (
            "Model outputs suspended for HIGH/MEDIUM-risk decisions. "
            "Fallback to rule-based engine engaged. "
            "Human-in-the-loop review mandatory before reinstatement."
        )

    return DriftReport(
        model_id=model_id,
        computed_at=_now(),
        psi_score=psi,
        wasserstein_distance=w_dist,
        accuracy_delta=acc_delta,
        status=status,
        circuit_breaker_active=circuit_breaker,
        human_review_ticket=human_ticket,
        remediation_action=remediation,
    )


@dataclass
class BCPFallbackState:
    """Tracks whether a model is operating normally or in BCP fallback mode (REC 21)."""
    model_id: UUID
    fallback_active: bool = False
    fallback_reason: str = ""
    fallback_activated_at: datetime | None = None
    rules_engine_ref: str | None = None    # ID of backup rules engine
    drill_last_conducted: datetime | None = None
    human_sample_pct: float = 0.01         # 1% of decisions reviewed by humans

    def activate(self, reason: str, rules_engine_ref: str | None = None) -> None:
        self.fallback_active = True
        self.fallback_reason = reason
        self.fallback_activated_at = _now()
        self.rules_engine_ref = rules_engine_ref

    def deactivate(self) -> None:
        self.fallback_active = False
        self.fallback_reason = ""
        self.fallback_activated_at = None
