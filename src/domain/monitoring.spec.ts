import { computePsi, evaluateDrift, wasserstein1d } from './monitoring';
import { DriftStatus } from '../common/enums';

// Reference values computed from numpy.histogram + scipy-equivalent 1-D EMD.
const TRAINING = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.15, 0.25, 0.35, 0.45, 0.55];
const LIVE = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 0.55, 0.65, 0.75, 0.85, 0.95];

describe('drift math parity with numpy/scipy', () => {
  it('PSI is ~0 for identical distributions', () => {
    expect(computePsi(TRAINING, TRAINING)).toBeCloseTo(0.0, 6);
  });

  it('PSI matches numpy for a shifted distribution', () => {
    expect(computePsi(TRAINING, LIVE)).toBeCloseTo(9.234431, 4);
  });

  it('1-D Wasserstein matches scipy for a shifted distribution', () => {
    expect(wasserstein1d(TRAINING, LIVE)).toBeCloseTo(0.4, 6);
  });

  it('1-D Wasserstein matches scipy for a unit shift', () => {
    expect(wasserstein1d([0, 1, 2], [1, 2, 3])).toBeCloseTo(1.0, 10);
  });

  it('evaluateDrift reports NOMINAL for a stable model', () => {
    const r = evaluateDrift('m1', TRAINING, TRAINING, 0.9, 0.9);
    expect(r.status).toBe(DriftStatus.NOMINAL);
    expect(r.circuitBreakerActive).toBe(false);
    expect(r.humanReviewTicket).toBeNull();
  });

  it('evaluateDrift trips the circuit breaker on major drift', () => {
    const r = evaluateDrift('m1', TRAINING, LIVE, 0.9, 0.9);
    expect(r.status).toBe(DriftStatus.CIRCUIT_BREAKER_TRIPPED);
    expect(r.circuitBreakerActive).toBe(true);
    expect(r.humanReviewTicket).toMatch(/^REVIEW-m1-\d{12}$/);
  });

  it('evaluateDrift trips on an accuracy drop even with no distribution drift', () => {
    const r = evaluateDrift('m1', TRAINING, TRAINING, 0.9, 0.8);
    expect(r.circuitBreakerActive).toBe(true);
    expect(r.accuracyDelta).toBeCloseTo(-0.1, 10);
  });
});
