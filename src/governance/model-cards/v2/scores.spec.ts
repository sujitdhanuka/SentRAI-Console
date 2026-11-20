import { fieldDef } from './catalogue';
import { evaluateApplicability } from './applicability/engine';
import { factsFrom } from './applicability/facts';
import { changeControl, controlViews } from './controls';
import { emptyField, enterValue, FieldValue, markNotApplicable, markUnknown } from './field-state';
import { finalisationGate } from './finalisation';
import { assessRisk } from './risk/engine';
import { frameworkApplicability, SEED_FRAMEWORKS } from './registry/registry';
import { controlScore, documentationScore, evidenceScore, freshnessDays, regulatoryScore } from './scores';

const at = new Date('2026-11-20T10:00:00Z');
const me = 'a@x.test';
const put = (id: string, value: any, who = me): FieldValue => enterValue(emptyField(id), fieldDef(id)!, value, who, at);

describe('documentation score', () => {
  it('counts mandatory and triggered conditional fields, accepted by a person; recommended separately', () => {
    const values: Record<string, FieldValue> = { purpose: put('purpose', 'Drafts replies for the support team.'), record_type: put('record_type', 'AI_SYSTEM') };
    const app = evaluateApplicability('AI_SYSTEM', factsFrom(values));
    const s = documentationScore(app.fields, values);
    const required = app.fields.filter((f) => f.applicable && f.effective === 'MANDATORY').length;
    expect(s.denominator).toBe(required);
    expect(s.numerator).toBe(2);
    expect(s.percent).toBe(Math.round((2 / required) * 100));
    expect((s.detail.missing as string[])).not.toContain('purpose');
    expect(s.detail.recommended).toMatchObject({ denominator: app.fields.filter((f) => f.applicable && f.effective === 'RECOMMENDED').length });
    // A rule firing adds its conditional fields to the denominator.
    const gen = { ...values, model_category: put('model_category', 'LLM') };
    expect(documentationScore(evaluateApplicability('AI_SYSTEM', factsFrom(gen)).fields, gen).denominator).toBeGreaterThan(s.denominator);
  });

  it('does not count UNKNOWN, unaccepted values or unjustified N/A, and counts a justified N/A', () => {
    const unknown = { purpose: markUnknown(emptyField('purpose'), me, at) };
    const app = evaluateApplicability('AI_SYSTEM', {});
    expect(documentationScore(app.fields, unknown).numerator).toBe(0);
    const imported: FieldValue = { ...emptyField('purpose'), value: 'x', status: 'POPULATED', provenance: 'IMPORTED_V1', accepted_by: null };
    expect(documentationScore(app.fields, { purpose: imported }).numerator).toBe(0);
    const na = { purpose: markNotApplicable(emptyField('purpose'), me, 'Retired before use; no purpose to describe.', at) };
    expect(documentationScore(app.fields, na).numerator).toBe(1);
  });
});

describe('evidence score and freshness', () => {
  const app = evaluateApplicability('AI_SYSTEM', {});
  const evField = app.fields.find((f) => f.applicable && f.effective !== 'NOT_REQUIRED' && fieldDef(f.field_id)!.evidence_required.required)!;
  const type = fieldDef(evField.field_id)!.evidence_required.type!;
  const withEvidence = (addedAt: string, status: FieldValue['status']): FieldValue => ({
    ...emptyField(evField.field_id), value: 'x', status, provenance: 'HUMAN_ENTERED', entered_by: me, accepted_by: me,
    evidence_refs: [{ ref: 'doc://1', type, added_by: me, added_at: addedAt }],
  });

  it('counts evidence that is attached, current and verified, and lists the rest', () => {
    const windows = { DEFAULT: 365 };
    expect(evidenceScore(app.fields, {}, windows, at).detail.missing).toContain(evField.field_id);
    const stale = evidenceScore(app.fields, { [evField.field_id]: withEvidence('2025-01-01T00:00:00Z', 'VERIFIED') }, windows, at);
    expect(stale.detail.expired).toContain(evField.field_id);
    const unverified = evidenceScore(app.fields, { [evField.field_id]: withEvidence('2026-11-01T00:00:00Z', 'EVIDENCE_PENDING') }, windows, at);
    expect(unverified.detail.unverified).toContain(evField.field_id);
    const ok = evidenceScore(app.fields, { [evField.field_id]: withEvidence('2026-11-01T00:00:00Z', 'VERIFIED') }, windows, at);
    expect(ok.numerator).toBe(1);
    // A shorter window for this type makes the same item stale.
    expect(evidenceScore(app.fields, { [evField.field_id]: withEvidence('2026-11-01T00:00:00Z', 'VERIFIED') }, { DEFAULT: 365, [type.toUpperCase()]: 7 }, at).detail.expired)
      .toContain(evField.field_id);
  });

  it('looks freshness windows up by type, case-insensitively, falling back to DEFAULT', () => {
    expect(freshnessDays('test_report', { DEFAULT: 365, TEST_REPORT: 180 })).toBe(180);
    expect(freshnessDays('other', { DEFAULT: 200 })).toBe(200);
  });
});

describe('control and regulatory scores', () => {
  const facts = { jurisdictions: ['EU'], eu_role: ['AI_SYSTEM_PROVIDER'], eu_classification: 'HIGH_RISK_ANNEX_III', model_category: 'LLM' };
  const fws = frameworkApplicability(SEED_FRAMEWORKS, { recordType: 'AI_SYSTEM', facts, adopted: new Set(['nist-ai-rmf-1.0']), at });
  const views = (assessments: any[] = []) => fws.map((fw) => ({ fw, controls: controlViews(fw, assessments, new Set()) }));

  it('counts only effectiveness-tested controls, and lists open remediation', () => {
    const gap = changeControl(null, { framework_id: 'nist-ai-rmf-1.0', framework_revision: 1, control_id: 'MAP-1' }, { status: 'GAP_IDENTIFIED', justification: 'Context is not documented.' }, me, at);
    const s = controlScore(views([gap]));
    expect(s.numerator).toBe(0);
    expect(s.denominator).toBeGreaterThan(0);
    expect(s.detail.open_remediation).toContain('nist-ai-rmf-1.0:MAP-1');
  });

  it('shows obligations not yet in force without counting them as gaps', () => {
    const s = regulatoryScore(views(), { jurisdictions: put('jurisdictions', ['EU']) });
    const nyif = (s.detail.not_yet_in_force as any[]).map((x) => x.ref);
    expect(nyif).toContain('eu-ai-act-2024:ART-9');
    expect(s.detail.gaps_outstanding).toEqual([]);
    // Denominator: jurisdictions + legal review + in-force obligations only.
    expect(s.denominator).toBe(2 + (s.detail.obligations_in_force as number));
    expect(s.numerator).toBe(1);
  });
});

describe('finalisation gate', () => {
  it('blocks on missing mandatory fields, unjustified N/A, consistency and risk, and never on recommended fields', () => {
    const app = evaluateApplicability('AI_SYSTEM', {});
    const badNa: FieldValue = { ...emptyField('purpose'), status: 'NOT_APPLICABLE', na_justification: null, na_decided_by: null };
    const g = finalisationGate({
      fields: app.fields, values: { purpose: badNa },
      consistency: [{ code: 'STATE_NOT_DEPLOYED_ACTIVE', fields: [], message: 'Not deployed but ACTIVE.' }],
      risk: assessRisk({ recordType: 'AI_SYSTEM', values: {} }), owner: null,
    });
    const codes = g.blockers.map((b) => b.code);
    expect(g.can_finalise).toBe(false);
    expect(codes).toEqual(expect.arrayContaining(['MANDATORY_MISSING', 'UNJUSTIFIED_NOT_APPLICABLE', 'STATE_NOT_DEPLOYED_ACTIVE', 'RISK_NOT_ASSESSED', 'OWNER_MISSING']));
    expect(g.warnings.some((w) => w.code === 'RECOMMENDED_MISSING')).toBe(true);
    expect(g.blockers.some((b) => b.code === 'RECOMMENDED_MISSING')).toBe(false);
  });

  it('names an unaccepted AI suggestion in a mandatory field, and a conditional field required by a rule', () => {
    const suggested: FieldValue = { ...emptyField('purpose'), suggestion: { value: 'x', provenance: 'AI_SUGGESTED', source_ref: null, removed: [], speculative: [], created_at: at.toISOString() } as any };
    const values = { purpose: suggested, model_category: put('model_category', 'LLM') };
    const app = evaluateApplicability('AI_SYSTEM', factsFrom(values));
    const g = finalisationGate({ fields: app.fields, values, consistency: [], risk: assessRisk({ recordType: 'AI_SYSTEM', values }), owner: { ok: true } });
    expect(g.blockers.find((b) => b.field_id === 'purpose')?.code).toBe('UNACCEPTED_SUGGESTION');
    const conditional = g.blockers.find((b) => b.field_id === 'system_prompt');
    expect(conditional?.message).toMatch(/R_GENERATIVE fired/);
  });
});
