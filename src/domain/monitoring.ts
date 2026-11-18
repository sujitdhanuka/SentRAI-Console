/**
 * Module B domain — drift detection & BCP fallback (REC 16, 21).
 * Port of src/sentrai/domain/monitoring.py. The PSI and 1-D Wasserstein
 * implementations reproduce numpy.histogram and scipy.stats.wasserstein_distance.
 */
import { DriftStatus } from '../common/enums';

export const PSI_WARNING_THRESHOLD = 0.1;
export const PSI_ALERT_THRESHOLD = 0.2;

/** Number of elements in a sorted array that are <= x (searchsorted 'right'). */
function upperBound(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Population Stability Index between an expected (training) and actual (live)
 * distribution, binned over the expected range like numpy.histogram(bins=10).
 */
export function computePsi(expected: number[], actual: number[], bins = 10): number {
  const eps = 1e-8;

  let mn = Math.min(...expected);
  let mx = Math.max(...expected);
  if (mn === mx) {
    // numpy expands a zero-width range to [min-0.5, max+0.5]
    mn -= 0.5;
    mx += 0.5;
  }
  const width = (mx - mn) / bins;

  const binIndex = (x: number): number => {
    if (x < mn || x > mx) return -1;
    let idx = Math.floor((x - mn) / width);
    if (idx >= bins) idx = bins - 1; // right edge inclusive for the last bin
    if (idx < 0) idx = 0;
    return idx;
  };

  const eCounts = new Array(bins).fill(0);
  const aCounts = new Array(bins).fill(0);
  for (const x of expected) {
    const i = binIndex(x);
    if (i >= 0) eCounts[i] += 1;
  }
  for (const x of actual) {
    const i = binIndex(x);
    if (i >= 0) aCounts[i] += 1;
  }

  const eSum = eCounts.reduce((a: number, b: number) => a + b, 0);
  const aSum = aCounts.reduce((a: number, b: number) => a + b, 0);

  let psi = 0;
  for (let i = 0; i < bins; i++) {
    let ePerc = eCounts[i] / (eSum + eps);
    let aPerc = aCounts[i] / (aSum + eps);
    ePerc = Math.max(ePerc, eps);
    aPerc = Math.max(aPerc, eps);
    psi += (ePerc - aPerc) * Math.log(ePerc / aPerc);
  }
  return psi;
}

/** 1-D Wasserstein distance with uniform weights — matches scipy.stats.wasserstein_distance. */
export function wasserstein1d(u: number[], v: number[]): number {
  const uSorted = [...u].sort((a, b) => a - b);
  const vSorted = [...v].sort((a, b) => a - b);
  const all = [...u, ...v].sort((a, b) => a - b);

  let res = 0;
  for (let i = 0; i < all.length - 1; i++) {
    const x = all[i];
    const delta = all[i + 1] - all[i];
    const uCdf = upperBound(uSorted, x) / u.length;
    const vCdf = upperBound(vSorted, x) / v.length;
    res += Math.abs(uCdf - vCdf) * delta;
  }
  return res;
}

export interface DriftReport {
  modelId: string;
  computedAt: Date;
  psiScore: number;
  wassersteinDistance: number;
  accuracyDelta: number;
  status: DriftStatus;
  circuitBreakerActive: boolean;
  humanReviewTicket: string | null;
  remediationAction: string | null;
}

export function driftSummary(r: DriftReport): string {
  const cb = r.circuitBreakerActive ? 'ON' : 'OFF';
  const delta = (r.accuracyDelta >= 0 ? '+' : '') + r.accuracyDelta.toFixed(4);
  return (
    `[${r.status}] model=${r.modelId} ` +
    `PSI=${r.psiScore.toFixed(4)} W-dist=${r.wassersteinDistance.toFixed(4)} ` +
    `acc_delta=${delta} circuit_breaker=${cb}`
  );
}

function utcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
  );
}

/**
 * Evaluate drift and determine circuit-breaker state. Circuit breaker trips
 * when PSI > 0.20 OR accuracy drops > 5 percentage points.
 */
export function evaluateDrift(
  modelId: string,
  trainingScores: number[],
  liveScores: number[],
  baselineAccuracy: number,
  currentAccuracy: number,
  /** Organisation's PSI alert threshold from governance settings (E1.2); the platform default otherwise. */
  psiAlertThreshold: number = PSI_ALERT_THRESHOLD,
): DriftReport {
  const psi = computePsi(trainingScores, liveScores);
  const wDist = wasserstein1d(trainingScores, liveScores);
  const accDelta = currentAccuracy - baselineAccuracy;

  const circuitBreaker = psi > psiAlertThreshold || accDelta < -0.05;

  let status: DriftStatus;
  if (circuitBreaker) status = DriftStatus.CIRCUIT_BREAKER_TRIPPED;
  else if (psi > PSI_WARNING_THRESHOLD || accDelta < -0.02) status = DriftStatus.WARNING;
  else status = DriftStatus.NOMINAL;

  const now = new Date();
  let humanTicket: string | null = null;
  let remediation: string | null = null;
  if (circuitBreaker) {
    humanTicket = `REVIEW-${modelId}-${utcStamp(now)}`;
    remediation =
      'Model outputs suspended for HIGH/MEDIUM-risk decisions. ' +
      'Fallback to rule-based engine engaged. ' +
      'Human-in-the-loop review mandatory before reinstatement.';
  }

  return {
    modelId,
    computedAt: now,
    psiScore: psi,
    wassersteinDistance: wDist,
    accuracyDelta: accDelta,
    status,
    circuitBreakerActive: circuitBreaker,
    humanReviewTicket: humanTicket,
    remediationAction: remediation,
  };
}

/** Tracks whether a model is operating normally or in BCP fallback mode (REC 21). */
export interface BCPFallbackState {
  modelId: string;
  fallbackActive: boolean;
  fallbackReason: string;
  fallbackActivatedAt: Date | null;
  rulesEngineRef: string | null;
  drillLastConducted: Date | null;
  humanSamplePct: number;
}

export function newBcpState(modelId: string): BCPFallbackState {
  return {
    modelId,
    fallbackActive: false,
    fallbackReason: '',
    fallbackActivatedAt: null,
    rulesEngineRef: null,
    drillLastConducted: null,
    humanSamplePct: 0.01,
  };
}

export function activateBcp(state: BCPFallbackState, reason: string, rulesEngineRef: string | null = null): void {
  state.fallbackActive = true;
  state.fallbackReason = reason;
  state.fallbackActivatedAt = new Date();
  state.rulesEngineRef = rulesEngineRef;
}

export function deactivateBcp(state: BCPFallbackState): void {
  state.fallbackActive = false;
  state.fallbackReason = '';
  state.fallbackActivatedAt = null;
}

/* ------------------------- BCP drill recency (E0.4) ------------------------ */

/** Default days between BCP drills for HIGH-risk models (RBI Rec 21); override with BCP_DRILL_INTERVAL_DAYS. */
export const DEFAULT_BCP_DRILL_INTERVAL_DAYS = 365;
/** Default days before a drill falls due that the reminder job fires; override with BCP_DRILL_REMINDER_DAYS. */
export const DEFAULT_BCP_DRILL_REMINDER_DAYS = 30;

function positiveInt(v: string | undefined, fallback: number): number {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function bcpDrillIntervalDays(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env.BCP_DRILL_INTERVAL_DAYS, DEFAULT_BCP_DRILL_INTERVAL_DAYS);
}

export function bcpDrillReminderDays(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env.BCP_DRILL_REMINDER_DAYS, DEFAULT_BCP_DRILL_REMINDER_DAYS);
}

export type DrillStatus = 'NONE' | 'CURRENT' | 'DUE_SOON' | 'OVERDUE';

/** Where a model's last drill stands against the interval. */
export function bcpDrillStatus(
  last: Date | null | undefined,
  now: Date = new Date(),
  intervalDays = bcpDrillIntervalDays(),
  reminderDays = bcpDrillReminderDays(),
): { status: DrillStatus; ageDays: number | null; dueAt: Date | null } {
  if (!last) return { status: 'NONE', ageDays: null, dueAt: null };
  const ageDays = Math.floor((now.getTime() - last.getTime()) / 86_400_000);
  const dueAt = new Date(last.getTime() + intervalDays * 86_400_000);
  if (ageDays > intervalDays) return { status: 'OVERDUE', ageDays, dueAt };
  if (ageDays >= intervalDays - reminderDays) return { status: 'DUE_SOON', ageDays, dueAt };
  return { status: 'CURRENT', ageDays, dueAt };
}
