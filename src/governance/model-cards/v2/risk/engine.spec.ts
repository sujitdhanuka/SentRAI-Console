import { fieldDef } from '../catalogue';
import { emptyField, enterValue, FieldValue } from '../field-state';
import { GOLDEN_V1_RATIONALE, goldenV1Context } from '../migration/golden-fixture';
import { planV1Migration } from '../migration/v1-mapper';
import { assessRisk, DEFAULT_THRESHOLDS, MAX_SCORE, REGULATORY_FIELDS, RiskInput, validateThresholds } from './engine';

const at = new Date('2026-11-20T10:00:00Z');
const person = 'risk.owner@example.test';
const put = (id: string, value: any): FieldValue => enterValue(emptyField(id), fieldDef(id)!, value, person, at);
const card = (v: Record<string, any>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, put(k, x)]));
const codes = (r: ReturnType<typeof assessRisk>) => r.findings.map((f) => f.code);

/** A low-risk internal tool, every input assessed. */
const LOW_INPUTS = {
  impact_severity: 'MINOR', likelihood: 'UNLIKELY', tenant_reach: 'ONE_TENANT', users_reached: 20, autonomy_level: 'SUGGESTS',
  data_sensitivity: 'LOW', decision_impact: 'INFORMATIONAL', reversibility: 'EASILY_REVERSED',
};
const RATIONALE = 'Internal drafting aid for one team; outputs are suggestions that are easy to discard.';

describe('risk engine', () => {
  it('explains the score input by input and gives LOW for low inputs', () => {
    const r = assessRisk({ recordType: 'AI_SYSTEM', values: card({ ...LOW_INPUTS, inherent_risk_tier: 'LOW', residual_risk_tier: 'LOW', risk_rationale: RATIONALE }) });
    expect(r.contributions.map((c) => c.input).sort()).toEqual(
      ['autonomy_level', 'data_sensitivity', 'decision_impact', 'impact_severity', 'likelihood', 'reversibility', 'tenant_reach'],
    );
    expect(r.score).toBe(r.contributions.reduce((n, c) => n + c.points, 0));
    expect(r.max_score).toBe(MAX_SCORE);
    expect(r.computed_inherent_tier).toBe('LOW');
    expect(r.assumed_worst).toEqual([]);
    expect(r.status).toBe('ASSESSED');
    expect(r.findings.filter((f) => f.blocking)).toEqual([]);
  });

  it('uses configurable thresholds and checks them', () => {
    const values = card(LOW_INPUTS);
    expect(assessRisk({ recordType: 'AI_SYSTEM', values, thresholds: { MEDIUM: 3, HIGH: 10, CRITICAL: 15 } }).score_tier).toBe('MEDIUM');
    expect(validateThresholds(DEFAULT_THRESHOLDS)).toEqual([]);
    expect(validateThresholds({ MEDIUM: 8, HIGH: 5, CRITICAL: 30 }).join(' ')).toMatch(/CRITICAL must be a whole number|increase/);
  });

  it('hard rule 1: human oversight never sets the tier to LOW on its own', () => {
    const risky = { ...LOW_INPUTS, impact_severity: 'MAJOR', likelihood: 'POSSIBLE', decision_impact: 'SUPPORTS_DECISIONS_ABOUT_PEOPLE' };
    // Inherent LOW justified by oversight.
    const a = assessRisk({ recordType: 'AI_SYSTEM', values: card({ ...risky, inherent_risk_tier: 'LOW', residual_risk_tier: 'LOW', risk_rationale: 'Low because a human-in-the-loop reviews every output before use.' }) });
    expect(a.computed_inherent_tier).not.toBe('LOW');
    expect(a.findings.find((f) => f.code === 'OVERSIGHT_ALONE_LOW')).toMatchObject({ hard_rule: 1, blocking: true });
    expect(a.status).toBe('BLOCKED');
    // Residual LOW where the only verified control is oversight.
    const b = assessRisk({
      recordType: 'AI_SYSTEM',
      values: card({
        ...risky, inherent_risk_tier: 'MEDIUM', residual_risk_tier: 'LOW', risk_rationale: RATIONALE,
        existing_controls: [{ control: 'Human review of every output', implemented: true, effectiveness_verified: true }],
      }),
    });
    expect(codes(b)).toContain('OVERSIGHT_ALONE_LOW');
    expect(b.residual_floor_tier).toBe('MEDIUM');
    // Oversight is not an input to the score: with and without it the engine gives the same tier.
    const withOversight = assessRisk({ recordType: 'AI_SYSTEM', values: card({ ...risky, oversight_model: 'HUMAN_IN_THE_LOOP' }) });
    const without = assessRisk({ recordType: 'AI_SYSTEM', values: card(risky) });
    expect(withOversight.score).toBe(without.score);
    expect(withOversight.computed_inherent_tier).toBe(without.computed_inherent_tier);
  });

  it('hard rule 2: an empty input never lowers risk; it counts as the worst plausible value', () => {
    const { autonomy_level: _drop, ...noAutonomy } = LOW_INPUTS;
    const empty = assessRisk({ recordType: 'AI_SYSTEM', values: card(noAutonomy) });
    const full = assessRisk({ recordType: 'AI_SYSTEM', values: card({ ...LOW_INPUTS, autonomy_level: 'ACTS_AUTONOMOUSLY' }) });
    expect(empty.score).toBe(full.score);
    expect(empty.contributions.find((c) => c.input === 'autonomy_level')).toMatchObject({ assumed_worst: true, points: 3, value: null });
    expect(empty.assumed_worst).toContain('autonomy_level');
    // UNKNOWN is treated the same as empty.
    const unknown = assessRisk({ recordType: 'AI_SYSTEM', values: { ...card(noAutonomy), autonomy_level: { ...emptyField('autonomy_level'), value: 'UNKNOWN', status: 'UNKNOWN' } } });
    expect(unknown.score).toBe(full.score);
    // Nothing recorded: the worst plausible on every input, and at least HIGH (severity unknown).
    const none = assessRisk({ recordType: 'AI_SYSTEM', values: {} });
    expect(none.score).toBe(MAX_SCORE);
    expect(none.computed_inherent_tier).toBe('CRITICAL');
    expect(none.findings.find((f) => f.code === 'INPUTS_ASSUMED_WORST')).toMatchObject({ hard_rule: 2, blocking: false });
  });

  it('hard rule 3: a shared configuration reaching every tenant is not LOW without a valid named acceptance', () => {
    const base: RiskInput = {
      recordType: 'MODEL_CONFIGURATION',
      values: card({ ...LOW_INPUTS, tenant_reach: 'ALL_TENANTS', users_reached: 20, inherent_risk_tier: 'LOW', residual_risk_tier: 'LOW', risk_rationale: RATIONALE }),
    };
    const r = assessRisk(base);
    expect(r.floors.map((f) => f.reason).join(' ')).toMatch(/every tenant/);
    expect(r.computed_inherent_tier).toBe('MEDIUM');
    expect(r.findings.find((f) => f.code === 'SHARED_CONFIG_LOW_WITHOUT_ACCEPTANCE')).toMatchObject({ hard_rule: 3, blocking: true });
    const acceptance = { risk_id: 'risk-1', accepted_by: 'ciso@example.test', accepted_at: at.toISOString(), expires_at: '2027-06-01T00:00:00.000Z', conditions: 'Review on every default change', valid: true };
    expect(codes(assessRisk({ ...base, acceptance }))).not.toContain('SHARED_CONFIG_LOW_WITHOUT_ACCEPTANCE');
    expect(codes(assessRisk({ ...base, acceptance: { ...acceptance, valid: false } }))).toContain('SHARED_CONFIG_LOW_WITHOUT_ACCEPTANCE');
    // A configuration with no recorded reach counts as reaching every tenant.
    const { tenant_reach: _t, ...noReach } = LOW_INPUTS;
    expect(codes(assessRisk({ recordType: 'MODEL_CONFIGURATION', values: card({ ...noReach, inherent_risk_tier: 'LOW', residual_risk_tier: 'LOW', risk_rationale: RATIONALE }) })))
      .toContain('SHARED_CONFIG_LOW_WITHOUT_ACCEPTANCE');
  });

  it('hard rule 4: every tier needs a rationale a person wrote, and the score is explained', () => {
    const noRationale = assessRisk({ recordType: 'AI_SYSTEM', values: card({ ...LOW_INPUTS, inherent_risk_tier: 'LOW', residual_risk_tier: 'LOW' }) });
    expect(noRationale.findings.find((f) => f.code === 'RATIONALE_REQUIRED')).toMatchObject({ hard_rule: 4, blocking: true });
    // An AI suggestion waiting for acceptance does not count.
    const suggested: FieldValue = { ...emptyField('risk_rationale'), value: RATIONALE, status: 'POPULATED', provenance: 'AI_SUGGESTED', accepted_by: null };
    const ai = assessRisk({ recordType: 'AI_SYSTEM', values: { ...card({ ...LOW_INPUTS, inherent_risk_tier: 'LOW', residual_risk_tier: 'LOW' }), risk_rationale: suggested } });
    expect(codes(ai)).toContain('RATIONALE_REQUIRED');
    expect(noRationale.contributions.every((c) => typeof c.points === 'number' && c.label)).toBe(true);
  });

  it('hard rule 5: regulatory classification is never an input, and the tier never sets it', () => {
    const base = card(LOW_INPUTS);
    const regulated = { ...base, ...card({ eu_classification: 'HIGH_RISK_ANNEX_III', kr_high_impact: 'YES', jurisdictions: ['EU', 'KR'] }) };
    const a = assessRisk({ recordType: 'AI_SYSTEM', values: base });
    const b = assessRisk({ recordType: 'AI_SYSTEM', values: regulated });
    expect(b.score).toBe(a.score);
    expect(b.computed_inherent_tier).toBe(a.computed_inherent_tier);
    expect(b.contributions.map((c) => c.input).filter((i) => REGULATORY_FIELDS.includes(i))).toEqual([]);
    expect(JSON.stringify(b)).not.toMatch(/eu_classification|HIGH_RISK_ANNEX/);
  });

  it('lets residual fall below inherent only with a verified effective control', () => {
    const v = { ...LOW_INPUTS, impact_severity: 'MAJOR', likelihood: 'LIKELY', inherent_risk_tier: 'MEDIUM', residual_risk_tier: 'LOW', risk_rationale: RATIONALE };
    expect(codes(assessRisk({ recordType: 'AI_SYSTEM', values: card(v) }))).toContain('RESIDUAL_WITHOUT_VERIFIED_CONTROL');
    const notVerified = card({ ...v, existing_controls: [{ control: 'Output filter', implemented: true, effectiveness_verified: false }] });
    expect(codes(assessRisk({ recordType: 'AI_SYSTEM', values: notVerified }))).toContain('RESIDUAL_WITHOUT_VERIFIED_CONTROL');
    const verified = card({ ...v, existing_controls: [{ control: 'Output filter', implemented: true, effectiveness_verified: true }] });
    const r = assessRisk({ recordType: 'AI_SYSTEM', values: verified });
    expect(codes(r)).not.toContain('RESIDUAL_WITHOUT_VERIFIED_CONTROL');
    expect(r.residual_floor_tier).toBe('LOW');
    expect(codes(assessRisk({ recordType: 'AI_SYSTEM', values: card({ ...v, residual_risk_tier: 'HIGH' }) }))).toContain('RESIDUAL_ABOVE_INHERENT');
  });

  it('holds a configuration at least at the tier of the riskiest model it can select', () => {
    const r = assessRisk({ recordType: 'MODEL_CONFIGURATION', configFloor: 'HIGH', values: card({ ...LOW_INPUTS, inherent_risk_tier: 'MEDIUM', residual_risk_tier: 'MEDIUM', risk_rationale: RATIONALE }) });
    expect(r.computed_inherent_tier).toBe('HIGH');
    expect(codes(r)).toContain('BELOW_CONFIGURATION_FLOOR');
  });
});

describe('golden fixture (e): the v1 LOW tier', () => {
  const plan = planV1Migration(goldenV1Context(), at);
  const values = Object.fromEntries(plan.fields.map((f) => [f.field_id, f]));

  it('is not an assessed tier after migration, and the engine puts the record above LOW', () => {
    const r = assessRisk({ recordType: 'MODEL_CONFIGURATION', values });
    expect(r.human.inherent_tier).toBeNull();
    expect(r.status).toBe('NOT_ASSESSED');
    expect(codes(r)).toContain('INHERENT_TIER_NOT_SET');
    expect(r.computed_inherent_tier).not.toBe('LOW');
    expect(r.assumed_worst).toEqual(expect.arrayContaining(['autonomy_level', 'tenant_reach']));
  });

  it('is blocked if a person re-enters LOW with the v1 reasoning', () => {
    const relisted = { ...values, ...card({ inherent_risk_tier: 'LOW', residual_risk_tier: 'LOW', risk_rationale: GOLDEN_V1_RATIONALE.split('\n\n')[1] }) };
    const r = assessRisk({ recordType: 'MODEL_CONFIGURATION', values: relisted });
    expect(r.status).toBe('BLOCKED');
    expect(codes(r)).toEqual(expect.arrayContaining(['OVERSIGHT_ALONE_LOW', 'SHARED_CONFIG_LOW_WITHOUT_ACCEPTANCE']));
  });
});
