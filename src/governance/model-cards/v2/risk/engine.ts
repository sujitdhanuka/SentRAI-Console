/**
 * Model card v2: the risk engine (spec §7). It explains, it does not decide:
 * the inherent and residual tiers are set by a person, and the engine shows
 * the score it computed from the inputs, how each input contributed, and
 * which hard rules the person's tiers break.
 *
 * Hard rules (each has a test in engine.spec.ts):
 *  1. Human oversight never sets the tier to LOW on its own.
 *  2. An empty input counts as the worst plausible value until it is assessed.
 *  3. A shared configuration that reaches every tenant cannot be LOW without a
 *     documented risk acceptance from a named risk owner.
 *  4. Every tier has a human-written rationale, and the score is explained.
 *  5. Regulatory classification is separate: the engine never reads it, and
 *     nothing derives it from the tier.
 */
import { FieldValue, isPopulated } from '../field-state';
import { Tier, tierRank } from '../config-resolver';

export const RISK_ENGINE_VERSION = '2.0.0';
export const TIERS: readonly Tier[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Score thresholds: the lowest score of each tier above LOW. Configurable per organisation (governance settings). */
export interface RiskThresholds {
  MEDIUM: number;
  HIGH: number;
  CRITICAL: number;
}
/** Defaults, to be reviewed by each organisation; the maximum score is 23. */
export const DEFAULT_THRESHOLDS: RiskThresholds = { MEDIUM: 6, HIGH: 11, CRITICAL: 16 };

/** Points per input value. The last entry of each list is the worst plausible value. */
const SCALES: Record<string, { label: string; points: Record<string, number> }> = {
  impact_severity: { label: 'Impact severity', points: { NEGLIGIBLE: 0, MINOR: 1, MODERATE: 2, MAJOR: 3, SEVERE: 4 } },
  likelihood: { label: 'Likelihood', points: { RARE: 0, UNLIKELY: 1, POSSIBLE: 2, LIKELY: 3, ALMOST_CERTAIN: 4 } },
  tenant_reach: { label: 'Tenant reach', points: { NONE: 0, ONE_TENANT: 1, SOME_TENANTS: 2, ALL_TENANTS: 3 } },
  autonomy_level: { label: 'Autonomy', points: { NONE: 0, SUGGESTS: 1, ACTS_WITH_APPROVAL: 2, ACTS_AUTONOMOUSLY: 3 } },
  data_sensitivity: { label: 'Data sensitivity', points: { LOW: 0, MEDIUM: 1, HIGH: 2 } },
  decision_impact: {
    label: 'Decision impact',
    points: { NONE: 0, INFORMATIONAL: 0, SUPPORTS_DECISIONS_ABOUT_PEOPLE: 2, MAKES_DECISIONS_ABOUT_PEOPLE: 3, SAFETY_CRITICAL: 4 },
  },
  reversibility: { label: 'Reversibility', points: { EASILY_REVERSED: 0, REVERSIBLE_WITH_EFFORT: 1, HARD_TO_REVERSE: 2, IRREVERSIBLE: 3 } },
};
const worst = (k: string) => Math.max(...Object.values(SCALES[k].points));
const worstValue = (k: string) => Object.entries(SCALES[k].points).sort((a, b) => b[1] - a[1])[0][0];
export const MAX_SCORE = Object.keys(SCALES).reduce((n, k) => n + worst(k), 0);

/** Fields the engine must never read (hard rule 5). */
export const REGULATORY_FIELDS: readonly string[] = ['eu_classification', 'eu_role', 'kr_high_impact', 'us_consequential_decision', 'jurisdictions', 'cn_filing', 'in_intermediary'];

const OVERSIGHT_WORDS = /oversight|human[- ]in[- ]the[- ]loop|human[- ]on[- ]the[- ]loop|human review|reviewed by a (person|human)|four[- ]eyes/i;

export interface Contribution {
  input: string;
  label: string;
  value: string | number | null;
  points: number;
  max_points: number;
  /** Set when the input was not assessed and counted as the worst plausible value (hard rule 2). */
  assumed_worst: boolean;
  note: string | null;
}

export interface RiskAcceptanceRef {
  /** Risk register id. */
  risk_id: string;
  accepted_by: string;
  accepted_at: string;
  expires_at: string | null;
  conditions: string | null;
  /** The acceptance is for the register's latest assessment and has not expired. */
  valid: boolean;
}

export interface RiskInput {
  recordType: string | null;
  values: Record<string, FieldValue | undefined>;
  thresholds?: RiskThresholds;
  /** The configuration resolver's inherent floor (highest tier among the models it can select, raised for blast radius). */
  configFloor?: Tier | null;
  /** A risk-register acceptance referenced by the card. */
  acceptance?: RiskAcceptanceRef | null;
  /** Controls verified effective in the card's control assessments (EFFECTIVENESS_TESTED). */
  verifiedControlIds?: string[];
  at?: Date;
}

export interface RiskFinding {
  code: string;
  /** The hard rule it enforces (1-5), or null for other checks. */
  hard_rule: number | null;
  message: string;
  blocking: boolean;
}

export interface RiskResult {
  engine_version: string;
  score: number;
  max_score: number;
  thresholds: RiskThresholds;
  contributions: Contribution[];
  /** Tier from the score alone. */
  score_tier: Tier;
  /** Floors that raise the computed tier, with reasons. */
  floors: Array<{ tier: Tier; reason: string }>;
  /** The engine's inherent tier: the score tier raised by the floors. Advice for the person setting the tier. */
  computed_inherent_tier: Tier;
  assumed_worst: string[];
  verified_controls: Array<{ control: string; oversight_only: boolean }>;
  /** The lowest residual tier the evidence allows. */
  residual_floor_tier: Tier;
  human: { inherent_tier: Tier | null; residual_tier: Tier | null; rationale_present: boolean; acceptance: RiskAcceptanceRef | null };
  findings: RiskFinding[];
  /** NOT_ASSESSED until a person sets and accepts the tiers; then ASSESSED, or BLOCKED by a hard rule. */
  status: 'NOT_ASSESSED' | 'ASSESSED' | 'BLOCKED';
}

const tierOfScore = (score: number, t: RiskThresholds): Tier => (score >= t.CRITICAL ? 'CRITICAL' : score >= t.HIGH ? 'HIGH' : score >= t.MEDIUM ? 'MEDIUM' : 'LOW');
const maxTier = (a: Tier, b: Tier): Tier => (tierRank(a) >= tierRank(b) ? a : b);
const lowerBy = (t: Tier, n: number): Tier => TIERS[Math.max(0, tierRank(t) - n)];
const val = (v: FieldValue | undefined) => (v && v.status !== 'NOT_ASSESSED' && v.status !== 'UNKNOWN' && v.status !== 'NOT_APPLICABLE' && v.value !== 'UNKNOWN' ? v.value : null);
/** A tier counts once a person set or accepted it. */
const humanTier = (v: FieldValue | undefined): Tier | null => (isPopulated(v) && TIERS.includes(v!.value) ? (v!.value as Tier) : null);

export function validateThresholds(t: RiskThresholds): string[] {
  const p: string[] = [];
  for (const k of ['MEDIUM', 'HIGH', 'CRITICAL'] as const) {
    if (!Number.isInteger(t?.[k]) || t[k] < 1 || t[k] > MAX_SCORE) p.push(`${k} must be a whole number from 1 to ${MAX_SCORE}`);
  }
  if (!p.length && !(t.MEDIUM < t.HIGH && t.HIGH < t.CRITICAL)) p.push('thresholds must increase: MEDIUM < HIGH < CRITICAL');
  return p;
}

export function assessRisk(input: RiskInput): RiskResult {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const v = input.values;
  const contributions: Contribution[] = [];
  const assumed: string[] = [];

  for (const [k, scale] of Object.entries(SCALES)) {
    let raw = val(v[k]);
    // Exposure also counts the people reached: the larger of tenant reach and users reached.
    let note: string | null = null;
    let points: number;
    if (raw === null || !(String(raw) in scale.points)) {
      assumed.push(k);
      points = worst(k);
      note = `Not assessed: counted as ${worstValue(k)} (the worst plausible value) until a person records it.`;
      raw = null;
    } else {
      points = scale.points[String(raw)];
    }
    if (k === 'tenant_reach') {
      const users = val(v.users_reached);
      const userPoints = typeof users === 'number' ? (users >= 1_000_000 ? 3 : users >= 10_000 ? 2 : users >= 100 ? 1 : 0) : 3;
      if (typeof users !== 'number') assumed.push('users_reached');
      if (userPoints > points) {
        note = [note, `Raised by users reached (${typeof users === 'number' ? users : 'not assessed, counted as the worst plausible'}).`].filter(Boolean).join(' ');
        points = userPoints;
      }
    }
    contributions.push({ input: k, label: k === 'tenant_reach' ? 'Exposure (tenants and users reached)' : scale.label, value: raw, points, max_points: worst(k), assumed_worst: raw === null, note });
  }
  const score = contributions.reduce((n, c) => n + c.points, 0);
  const scoreTier = tierOfScore(score, t);

  const floors: Array<{ tier: Tier; reason: string }> = [];
  const sev = val(v.impact_severity);
  if (sev === 'SEVERE' || sev === null) floors.push({ tier: 'HIGH', reason: sev === null ? 'Impact severity is not assessed, so it counts as SEVERE: at least HIGH.' : 'Severe impact: at least HIGH.' });
  else if (sev === 'MAJOR') floors.push({ tier: 'MEDIUM', reason: 'Major impact: at least MEDIUM.' });
  const reach = val(v.tenant_reach);
  const sharedConfig = reach === 'ALL_TENANTS' || (input.recordType === 'MODEL_CONFIGURATION' && reach === null);
  if (sharedConfig) {
    floors.push({ tier: 'MEDIUM', reason: reach === null ? 'A configuration with no recorded tenant reach counts as reaching every tenant: at least MEDIUM.' : 'It reaches every tenant: at least MEDIUM.' });
  }
  if (input.configFloor) floors.push({ tier: input.configFloor, reason: `It can select a model assessed ${input.configFloor} (raised for blast radius where it reaches every tenant).` });
  const computed = floors.reduce((x, f) => maxTier(x, f.tier), scoreTier);

  // Verified effective controls: from the existing-controls table and from control assessments.
  const rows: any[] = Array.isArray(val(v.existing_controls)) ? val(v.existing_controls) : [];
  const verified = [
    ...rows.filter((r) => r?.implemented === true && r?.effectiveness_verified === true).map((r) => ({ control: String(r.control ?? ''), oversight_only: OVERSIGHT_WORDS.test(String(r.control ?? '')) })),
    ...(input.verifiedControlIds ?? []).map((id) => ({ control: id, oversight_only: /HUMAN_AI_CONFIGURATION|ART-14|HUMAN_INVOLVEMENT/.test(id) })),
  ];
  const nonOversight = verified.filter((c) => !c.oversight_only).length;
  const inherent = humanTier(v.inherent_risk_tier);
  const residual = humanTier(v.residual_risk_tier);
  // Each verified control may justify one tier lower, at most two; oversight alone never reaches LOW.
  let residualFloor: Tier = lowerBy(inherent ?? computed, Math.min(2, verified.length));
  if (!nonOversight && residualFloor === 'LOW' && tierRank(inherent ?? computed) > 0) residualFloor = 'MEDIUM';

  const rationale = v.risk_rationale;
  const rationalePresent = isPopulated(rationale) && rationale!.provenance !== 'AI_SUGGESTED' && rationale!.provenance !== 'CODE_SCAN'
    && typeof rationale!.value === 'string' && rationale!.value.trim().length >= 20;
  const acc = input.acceptance ?? null;
  const findings: RiskFinding[] = [];
  const f = (code: string, hard_rule: number | null, message: string, blocking = true) => findings.push({ code, hard_rule, message, blocking });

  if (!inherent) f('INHERENT_TIER_NOT_SET', null, 'A person must set (or accept) the inherent risk tier.');
  if (!residual) f('RESIDUAL_TIER_NOT_SET', null, 'A person must set (or accept) the residual risk tier.');
  if (assumed.length) f('INPUTS_ASSUMED_WORST', 2, `Counted as the worst plausible value until assessed: ${[...new Set(assumed)].join(', ')}.`, false);

  // Rule 1: oversight alone never makes it LOW.
  const rationaleText = typeof rationale?.value === 'string' ? rationale.value : '';
  if (inherent === 'LOW' && tierRank(computed) > 0 && OVERSIGHT_WORDS.test(rationaleText)) {
    f('OVERSIGHT_ALONE_LOW', 1, `The inherent tier is LOW but the inputs give ${computed}, and the rationale relies on human oversight. Oversight is a control: it can lower residual risk once verified, never the inherent tier on its own.`);
  }
  if (residual === 'LOW' && inherent && inherent !== 'LOW' && !nonOversight) {
    f('OVERSIGHT_ALONE_LOW', 1, 'The residual tier is LOW, but the only verified controls (if any) are human oversight. Oversight alone never makes a record LOW.');
  }
  // Residual below inherent needs a verified effective control.
  if (inherent && residual && tierRank(residual) < tierRank(inherent)) {
    if (!verified.length) f('RESIDUAL_WITHOUT_VERIFIED_CONTROL', null, 'Residual risk is lower than inherent risk, but no implemented control has verified effectiveness.');
    else if (tierRank(residual) < tierRank(residualFloor)) f('RESIDUAL_BELOW_EVIDENCE', null, `The verified controls support a residual tier of ${residualFloor} at the lowest.`);
  }
  if (inherent && residual && tierRank(residual) > tierRank(inherent)) f('RESIDUAL_ABOVE_INHERENT', null, 'Residual risk cannot be higher than inherent risk; raise the inherent tier.');

  // Rule 3: a shared configuration reaching every tenant is not LOW without an acceptance.
  if (sharedConfig && (inherent === 'LOW' || residual === 'LOW')) {
    if (!acc) f('SHARED_CONFIG_LOW_WITHOUT_ACCEPTANCE', 3, 'It affects every tenant, so it cannot be LOW without a documented risk acceptance from a named risk owner.');
    else if (!acc.valid) f('SHARED_CONFIG_LOW_WITHOUT_ACCEPTANCE', 3, 'The referenced risk acceptance has expired or is for an older assessment.');
  }
  // The configuration floor (spec §4).
  if (input.configFloor && inherent && tierRank(inherent) < tierRank(input.configFloor)) {
    f('BELOW_CONFIGURATION_FLOOR', null, `A configuration's inherent risk is at least that of the riskiest model it can select (${input.configFloor}).`);
  }
  // Rule 4: a human-written rationale.
  if ((inherent || residual) && !rationalePresent) f('RATIONALE_REQUIRED', 4, 'Every tier needs a rationale written or accepted by a person (an AI draft does not count).');
  // Advice, not a block: a person may set a tier below the engine's, with the rationale explaining why.
  if (inherent && tierRank(inherent) < tierRank(computed) && !findings.some((x) => x.code === 'OVERSIGHT_ALONE_LOW')) {
    f('INHERENT_BELOW_ENGINE', null, `The inherent tier (${inherent}) is below the engine's ${computed}; the rationale must say why.`, false);
  }

  const blocked = findings.some((x) => x.blocking && !['INHERENT_TIER_NOT_SET', 'RESIDUAL_TIER_NOT_SET'].includes(x.code));
  return {
    engine_version: RISK_ENGINE_VERSION,
    score,
    max_score: MAX_SCORE,
    thresholds: t,
    contributions,
    score_tier: scoreTier,
    floors,
    computed_inherent_tier: computed,
    assumed_worst: [...new Set(assumed)],
    verified_controls: verified,
    residual_floor_tier: residualFloor,
    human: { inherent_tier: inherent, residual_tier: residual, rationale_present: rationalePresent, acceptance: acc },
    findings,
    status: !inherent || !residual ? 'NOT_ASSESSED' : blocked ? 'BLOCKED' : 'ASSESSED',
  };
}
