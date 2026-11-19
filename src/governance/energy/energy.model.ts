/**
 * Energy and emissions (E3.5, RBI Sutra 7, NIST MEASURE 2.12, ISO A.5.5):
 * GPU power samples integrated to kWh (trapezoid rule), nvidia-smi CSV
 * parsing, and CO2e from a configurable grid factor.
 */

/** Default grid emission factors, kg CO2e per kWh, by primary jurisdiction (approximate national averages; set your own in settings). */
export const DEFAULT_GRID_FACTORS: Record<string, number> = { IN: 0.71, AU: 0.68, US: 0.37, EU: 0.25, INTL: 0.48 };

export interface PowerSample {
  at: Date;
  powerW: number;
}

export const MAX_SAMPLES = 20_000;
/** Samples further apart than this are a gap in measurement, not a period at the average power. */
export const DEFAULT_MAX_GAP_S = 300;

export function parseSamples(v: unknown): PowerSample[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > MAX_SAMPLES) throw new Error(`samples must be a list of 2 to ${MAX_SAMPLES} { at, power_w }`);
  const out = v.map((s: any, i) => {
    const at = new Date(s?.at);
    const p = Number(s?.power_w);
    if (Number.isNaN(at.getTime())) throw new Error(`samples[${i}].at must be a date`);
    if (s?.power_w === null || s?.power_w === '' || !Number.isFinite(p) || p < 0 || p > 1_000_000) throw new Error(`samples[${i}].power_w must be 0 to 1,000,000 watts`);
    return { at, powerW: p };
  });
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * nvidia-smi CSV, as logged with
 *   nvidia-smi --query-gpu=timestamp,index,power.draw --format=csv -l 5
 * Readings of every GPU at the same timestamp are summed.
 */
export function parseNvidiaSmiCsv(csv: string): PowerSample[] {
  if (typeof csv !== 'string' || csv.length > 5_000_000) throw new Error('csv must be nvidia-smi output (at most 5 MB)');
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines[0]?.toLowerCase() ?? '';
  const hasHeader = header.includes('timestamp');
  const cols = hasHeader ? header.split(',').map((c) => c.trim()) : ['timestamp', 'index', 'power.draw'];
  const ti = cols.findIndex((c) => c.startsWith('timestamp'));
  const pi = cols.findIndex((c) => c.startsWith('power.draw'));
  if (ti < 0 || pi < 0) throw new Error('csv needs timestamp and power.draw columns');
  const byTime = new Map<number, number>();
  for (const l of lines.slice(hasHeader ? 1 : 0)) {
    const parts = l.split(',').map((x) => x.trim());
    const at = new Date(parts[ti]?.replace(/\//g, '-'));
    const p = parseFloat(parts[pi]);
    if (Number.isNaN(at.getTime()) || !Number.isFinite(p)) continue;
    byTime.set(at.getTime(), (byTime.get(at.getTime()) ?? 0) + p);
  }
  const out = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, p]) => ({ at: new Date(t), powerW: p }));
  if (out.length < 2) throw new Error('csv needs at least two timestamped power readings');
  if (out.length > MAX_SAMPLES) throw new Error(`at most ${MAX_SAMPLES} timestamps per upload`);
  return out;
}

/** kWh over the samples; gaps longer than maxGapS are not integrated. */
export function integrateKwh(samples: PowerSample[], maxGapS = DEFAULT_MAX_GAP_S): { kwh: number; coveredSeconds: number; gaps: number } {
  let wattSeconds = 0;
  let covered = 0;
  let gaps = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].at.getTime() - samples[i - 1].at.getTime()) / 1000;
    if (dt <= 0) continue;
    if (dt > maxGapS) {
      gaps += 1;
      continue;
    }
    wattSeconds += ((samples[i].powerW + samples[i - 1].powerW) / 2) * dt;
    covered += dt;
  }
  return { kwh: wattSeconds / 3_600_000, coveredSeconds: covered, gaps };
}

export function co2eKg(kwh: number, gridFactor: number): number {
  return kwh * gridFactor;
}

export const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;
