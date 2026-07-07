"""
Tests for Module B — Drift Detection & BCP (REC 16, 21)
"""

import numpy as np
import pytest

from sentrai.domain.enums import DriftStatus
from sentrai.domain.monitoring import (
    BCPFallbackState,
    compute_psi,
    compute_wasserstein,
    evaluate_drift,
)


class TestDriftMetrics:
    def test_identical_distributions_psi_near_zero(self):
        rng = np.random.default_rng(42)
        scores = rng.uniform(0, 1, 500)
        psi = compute_psi(scores, scores)
        assert psi < 0.01

    def test_shifted_distribution_triggers_alert(self):
        rng = np.random.default_rng(42)
        training = rng.normal(0.5, 0.1, 1000)
        # Severe shift — mean moved from 0.5 to 0.8
        live = rng.normal(0.8, 0.15, 1000)
        psi = compute_psi(training, live)
        assert psi > 0.20   # should exceed alert threshold

    def test_wasserstein_zero_for_identical(self):
        rng = np.random.default_rng(42)
        scores = rng.uniform(0, 1, 200)
        w = compute_wasserstein(scores, scores)
        assert w < 1e-10


class TestEvaluateDrift:
    def _make_entry_id(self):
        import uuid
        return uuid.uuid4()

    def test_nominal_returns_nominal_status(self):
        rng = np.random.default_rng(1)
        training = rng.normal(0.5, 0.1, 1000)
        live = rng.normal(0.51, 0.1, 1000)      # tiny shift
        report = evaluate_drift(
            model_id=self._make_entry_id(),
            training_scores=training,
            live_scores=live,
            baseline_accuracy=0.92,
            current_accuracy=0.921,
        )
        assert report.status == DriftStatus.NOMINAL
        assert report.circuit_breaker_active is False

    def test_accuracy_drop_trips_circuit_breaker(self):
        rng = np.random.default_rng(2)
        training = rng.normal(0.5, 0.1, 1000)
        live = rng.normal(0.5, 0.1, 1000)
        report = evaluate_drift(
            model_id=self._make_entry_id(),
            training_scores=training,
            live_scores=live,
            baseline_accuracy=0.90,
            current_accuracy=0.82,    # -8pp drop → circuit breaker
        )
        assert report.circuit_breaker_active is True
        assert report.status == DriftStatus.CIRCUIT_BREAKER_TRIPPED
        assert report.human_review_ticket is not None
        assert report.remediation_action is not None


class TestBCPFallback:
    def test_activate_and_deactivate(self):
        import uuid
        mid = uuid.uuid4()
        state = BCPFallbackState(model_id=mid)
        assert state.fallback_active is False

        state.activate("PSI exceeded alert threshold", rules_engine_ref="RULES_v1")
        assert state.fallback_active is True
        assert state.rules_engine_ref == "RULES_v1"
        assert state.fallback_activated_at is not None

        state.deactivate()
        assert state.fallback_active is False
        assert state.fallback_reason == ""
