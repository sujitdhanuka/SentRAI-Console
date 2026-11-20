import { fieldDef } from '../catalogue';
import { acceptImported, FieldStateError, isPopulated } from '../field-state';
import { GOLDEN_V1_PURPOSE, goldenV1Context } from './golden-fixture';
import { planV1Migration } from './v1-mapper';

const at = new Date('2026-11-20T10:00:00Z');
const plan = planV1Migration(goldenV1Context(), at);
const field = (id: string) => plan.fields.find((f) => f.field_id === id);

describe('golden fixture: the v1 "Global Ai Model Settings" card after migration (Slice 1 items)', () => {
  it('(a) is classified MODEL_CONFIGURATION, not GENERATIVE_AI, as an unaccepted code-scan value', () => {
    expect(plan.record_type.value).toBe('MODEL_CONFIGURATION');
    expect(field('record_type')).toMatchObject({ value: 'MODEL_CONFIGURATION', provenance: 'CODE_SCAN', accepted_by: null });
    expect(isPopulated(field('record_type'))).toBe(false);
    expect(field('model_category')!.value).toBe('NOT_A_MODEL');
    expect(plan.record_type.reasons.join(' ')).toContain('GENERATIVE_AI');
  });

  it('(b) flags the DESIGN / not deployed / ACTIVE contradiction', () => {
    expect(plan.consistency.map((c) => c.code)).toEqual(['STATE_NOT_DEPLOYED_ACTIVE', 'STATE_COMPONENT_UNRELEASED_ACTIVE']);
    expect(field('component_lifecycle')!.value).toBe('PLANNED');
    expect(field('deployment_status')!.value).toBe('NOT_DEPLOYED');
    expect(field('operational_status')!.value).toBe('ACTIVE');
  });

  it('(c) marks purpose and risk rationale IMPORTED_V1 and not accepted; the purpose suggestion is cleaned', () => {
    expect(field('purpose')).toMatchObject({ provenance: 'IMPORTED_V1', accepted_by: null, value: GOLDEN_V1_PURPOSE });
    expect(field('risk_rationale')).toMatchObject({ provenance: 'IMPORTED_V1', accepted_by: null });
    const s = field('purpose')!.suggestion!;
    expect(s.provenance).toBe('AI_SUGGESTED');
    expect(s.value).not.toMatch(/Here is|code excerpt|likely/);
    expect(s.removed.length).toBe(3);
    // An AI-drafted v1 risk rationale cannot simply be accepted: a person writes it.
    let code: string | null = null;
    try {
      acceptImported(field('risk_rationale')!, fieldDef('risk_rationale')!, 'reviewer@example.test', at);
    } catch (e) {
      code = (e as FieldStateError).code;
    }
    expect(code).toBe('HUMAN_ONLY');
  });

  it('(d) shows personal data as UNKNOWN', () => {
    expect(field('personal_data')).toMatchObject({ value: 'UNKNOWN', status: 'UNKNOWN' });
  });

  it('(e, part) keeps the LOW tier only as an imported value flagged REQUIRES_REASSESSMENT', () => {
    expect(plan.risk).toMatchObject({ imported_tier: 'LOW', status: 'REQUIRES_REASSESSMENT' });
    expect(plan.risk.reasons.join(' ')).toMatch(/every tenant/);
    expect(plan.risk.reasons.join(' ')).toMatch(/empty input never lowers risk/);
    expect(field('inherent_risk_tier')).toMatchObject({ value: 'LOW', provenance: 'IMPORTED_V1', accepted_by: null });
  });

  it('(f, part) resets the v1 "ISO 42001: compliant" verdict to NOT_ASSESSED, keeping the old verdict', () => {
    expect(plan.verdicts_reset).toContainEqual({ framework: 'ISO/IEC 42001', v1_verdict: 'compliant', v2_status: 'NOT_ASSESSED' });
    expect(plan.verdicts_reset.every((v) => v.v2_status === 'NOT_ASSESSED')).toBe(true);
  });

  it('(g) rejects "Admin Dhancept" as owner when it is a service account, and accepts a named person', () => {
    expect(plan.owner).toMatchObject({ ok: false, code: 'OWNER_SERVICE_ACCOUNT', v1_owner_text: 'Admin Dhancept' });
    expect(field('accountable_owner')).toBeUndefined();
    const human = planV1Migration(goldenV1Context('HUMAN'), at);
    expect(human.owner.ok).toBe(true);
    expect(human.fields.find((f) => f.field_id === 'accountable_owner')).toMatchObject({ value: 'user-admin-dhancept', accepted_by: null });
  });

  it('does not import v1 zero counts, and says why', () => {
    expect(field('incident_count')).toBeUndefined();
    expect(field('grievance_count')).toBeUndefined();
    expect(plan.notes.join(' ')).toMatch(/none recorded/);
  });
});
