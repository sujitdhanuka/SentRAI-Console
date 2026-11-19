/**
 * Strictest-wins parameter resolver (design §2.2). When two active packs set
 * the same parameter SentRAI applies the strictest value and records which
 * pack set it, so an auditor can see why:
 *   interval / deadline  → shortest wins            (rule 'min')
 *   threshold            → most conservative wins   (rule 'min' or 'max' per parameter)
 *   evidence / rights    → union of all             (rule 'union')
 *   required sign-offs   → true wins                (rule 'any')
 */
import { LEGACY_RED_TEAM_INTERVAL_DAYS, RED_TEAM_INTERVAL_DAYS } from '../../domain/model-inventory';
import { DEFAULT_BCP_DRILL_INTERVAL_DAYS, DEFAULT_BCP_DRILL_REMINDER_DAYS } from '../../domain/monitoring';
import { ParameterRule, ParameterSource, ParameterSpec, ResolvedParameters } from './pack.types';

export const PARAMETER_SPECS: ParameterSpec[] = [
  { name: 'redTeamIntervalDays.HIGH', rule: 'min', unit: 'days', description: 'Maximum days between red-team exercises for HIGH and CRITICAL systems' },
  { name: 'redTeamIntervalDays.MEDIUM', rule: 'min', unit: 'days', description: 'Maximum days between red-team exercises for MEDIUM systems' },
  { name: 'redTeamIntervalDays.LOW', rule: 'min', unit: 'days', description: 'Maximum days between red-team exercises for LOW systems' },
  { name: 'legacyRedTeamIntervalDays', rule: 'min', unit: 'days', description: 'Single red-team interval used while per-tier intervals are switched off' },
  { name: 'driftRecencyDays', rule: 'min', unit: 'days', description: 'Maximum age of the latest drift evaluation' },
  { name: 'bcpDrillIntervalDays', rule: 'min', unit: 'days', description: 'Maximum days between BCP drills for HIGH and CRITICAL systems' },
  { name: 'bcpDrillReminderDays', rule: 'max', unit: 'days', description: 'Days before a drill falls due that reminders start' },
  { name: 'incidentReportHours', rule: 'min', unit: 'hours', description: 'Deadline to report a serious AI incident to the regulator' },
  { name: 'psiAlertThreshold', rule: 'min', description: 'Population stability index that raises a drift alert' },
  { name: 'fairnessRatioMin', rule: 'max', description: 'Minimum disparate-impact ratio before a fairness finding' },
  { name: 'auditIntervalDays.HIGH', rule: 'min', unit: 'days', description: 'Maximum days between audits for HIGH and CRITICAL systems' },
  { name: 'thirdPartyAuditRequired.HIGH', rule: 'any', description: 'HIGH and CRITICAL systems need an independent third-party audit' },
  { name: 'euHighRiskDomains', rule: 'union', description: 'Functional areas treated as EU AI Act high-risk' },
  { name: 'requiredEvidence', rule: 'union', description: 'Evidence types every in-scope model must carry' },
  // Phase 2
  { name: 'decisionRecordRetentionMonths', rule: 'max', unit: 'months', description: 'Months to keep adverse-action notices and decision appeal records (Reg B 25, Colorado 36)' },
  { name: 'appealResponseDays', rule: 'min', unit: 'days', description: 'Days to decide an appeal, reconsideration or data-correction request' },
  { name: 'dtaRegisterShareMonths', rule: 'min', unit: 'months', description: 'Maximum months between sharing the AI use case register with the DTA' },
  { name: 'highRiskReviewMonths', rule: 'min', unit: 'months', description: 'Maximum months between reviews of a high-risk use case' },
  { name: 'validationValidityMonths', rule: 'min', unit: 'months', description: 'Months a model validation stays current before revalidation' },
  { name: 'frameworkReviewMonths', rule: 'min', unit: 'months', description: 'Maximum months between reviews of the AI governance framework and policy' },
  { name: 'redTeamPreDeployRequired.HIGH', rule: 'any', description: 'HIGH and CRITICAL systems need a red-team exercise before they go live' },
  // E5.1 EU AI Act
  { name: 'logRetentionMonths', rule: 'max', unit: 'months', description: 'Minimum months to keep automatically generated logs (EU AI Act Art. 19, 26(6))' },
  { name: 'technicalDocRetentionYears', rule: 'max', unit: 'years', description: 'Years to keep technical documentation and the declaration after placing on the market (EU AI Act Art. 18)' },
];

/** Phase 2 fallbacks used where no enabled pack or setting states a value (kept out of PLATFORM_DEFAULTS so existing parameter views do not change). */
export const PHASE2_FALLBACKS = {
  decisionRecordRetentionMonths: 25,
  appealResponseDays: 30,
  dtaRegisterShareMonths: 6,
  highRiskReviewMonths: 12,
  validationValidityMonths: 12,
  frameworkReviewMonths: 24,
} as const;

/** A Phase 2 parameter from resolved values, or its fallback. */
export function phase2Param(values: Record<string, any> | undefined, name: keyof typeof PHASE2_FALLBACKS): number {
  const v = Number(values?.[name]);
  return Number.isFinite(v) && v > 0 ? v : PHASE2_FALLBACKS[name];
}

const SPEC_BY_NAME = new Map(PARAMETER_SPECS.map((s) => [s.name, s]));

export function parameterSpec(name: string): ParameterSpec | undefined {
  return SPEC_BY_NAME.get(name);
}

/** Which of two values is stricter under a rule (true when `a` is at least as strict as `b`). */
export function atLeastAsStrict(rule: ParameterRule, a: any, b: any): boolean {
  switch (rule) {
    case 'min':
      return Number(a) <= Number(b);
    case 'max':
      return Number(a) >= Number(b);
    case 'any':
      return Boolean(a) || !b;
    case 'union': {
      const sa = new Set(Array.isArray(a) ? a : []);
      return (Array.isArray(b) ? b : []).every((x) => sa.has(x));
    }
  }
}

function combine(rule: ParameterRule, candidates: ParameterSource[]): { applied: any; setBy: string[] } {
  if (rule === 'union') {
    const all: any[] = [];
    const setBy: string[] = [];
    for (const c of candidates) {
      const list = Array.isArray(c.value) ? c.value : [c.value];
      let added = false;
      for (const v of list) if (!all.includes(v)) { all.push(v); added = true; }
      if (added || list.length) setBy.push(c.source);
    }
    return { applied: all, setBy };
  }
  let applied = candidates[0].value;
  for (const c of candidates.slice(1)) {
    if (rule === 'min' && Number(c.value) < Number(applied)) applied = c.value;
    if (rule === 'max' && Number(c.value) > Number(applied)) applied = c.value;
    if (rule === 'any' && Boolean(c.value)) applied = true;
  }
  if (rule === 'any') applied = Boolean(applied);
  const setBy = candidates.filter((c) => (rule === 'any' ? Boolean(c.value) === applied : Number(c.value) === Number(applied))).map((c) => c.source);
  return { applied, setBy };
}

/**
 * Resolve parameters across sources. Every source contributes; strictest wins.
 * `sources` is ordered (packs first, then settings, then environment), which
 * only matters for reporting ties.
 */
export function resolveParameters(
  sources: Array<{ source: string; version?: string; parameters: Record<string, any> }>,
  defaults: Record<string, any> = {},
): ResolvedParameters {
  const byName = new Map<string, ParameterSource[]>();
  for (const s of sources) {
    for (const [name, value] of Object.entries(s.parameters ?? {})) {
      if (value === undefined || value === null) continue;
      const list = byName.get(name) ?? [];
      list.push({ source: s.source, version: s.version, value });
      byName.set(name, list);
    }
  }
  const out: ResolvedParameters = { values: {}, sources: {} };
  for (const [name, candidates] of byName) {
    const rule = SPEC_BY_NAME.get(name)?.rule ?? 'min';
    const { applied, setBy } = combine(rule, candidates);
    out.values[name] = applied;
    out.sources[name] = { applied, setBy, candidates };
  }
  // Platform defaults apply only where no pack, setting or operator set a value.
  for (const [name, value] of Object.entries(defaults)) {
    if (name in out.values) continue;
    out.values[name] = value;
    out.sources[name] = { applied: value, setBy: ['platform-default'], candidates: [{ source: 'platform-default', value }] };
  }
  return out;
}

/**
 * Platform defaults: SentRAI's own values where no enabled pack states a
 * number (RBI Rec 20 asks for red teaming "proportionate to risk", not a
 * period). They match the Phase 0 constants so results do not move.
 */
export const PLATFORM_DEFAULTS: Record<string, any> = {
  'redTeamIntervalDays.HIGH': RED_TEAM_INTERVAL_DAYS.HIGH,
  'redTeamIntervalDays.MEDIUM': RED_TEAM_INTERVAL_DAYS.MEDIUM,
  'redTeamIntervalDays.LOW': RED_TEAM_INTERVAL_DAYS.LOW,
  legacyRedTeamIntervalDays: LEGACY_RED_TEAM_INTERVAL_DAYS,
  driftRecencyDays: 30,
  bcpDrillIntervalDays: DEFAULT_BCP_DRILL_INTERVAL_DAYS,
  bcpDrillReminderDays: DEFAULT_BCP_DRILL_REMINDER_DAYS,
  psiAlertThreshold: 0.2,
  'auditIntervalDays.HIGH': 365,
};

/**
 * Pack floors (design §4.1): the loosest value a setting may take while these
 * packs are enabled. A setting may be stricter than the floor, never looser.
 */
export function packFloors(packs: Array<{ id: string; parameters: Record<string, any> }>): Record<string, { value: any; packs: string[] }> {
  const resolved = resolveParameters(packs.map((p) => ({ source: p.id, parameters: p.parameters })));
  const floors: Record<string, { value: any; packs: string[] }> = {};
  for (const [name, r] of Object.entries(resolved.sources)) floors[name] = { value: r.applied, packs: r.setBy };
  return floors;
}

/** Operator overrides read from the environment (pre-settings behaviour). They join the strictest-wins vote. */
export function environmentParameters(env: NodeJS.ProcessEnv = process.env): Record<string, any> {
  const out: Record<string, any> = {};
  const n = (v: string | undefined) => {
    const x = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(x) && x > 0 ? x : undefined;
  };
  const drill = n(env.BCP_DRILL_INTERVAL_DAYS);
  if (drill !== undefined) out.bcpDrillIntervalDays = drill;
  const reminder = n(env.BCP_DRILL_REMINDER_DAYS);
  if (reminder !== undefined) out.bcpDrillReminderDays = reminder;
  return out;
}
