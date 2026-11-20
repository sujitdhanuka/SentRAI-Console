import { fieldDef } from '../catalogue';
import { evaluateApplicability } from '../applicability/engine';
import { factsFrom } from '../applicability/facts';
import { ControlAssessment, controlViews, registryIdForV1Label } from '../controls';
import { emptyField, enterValue, FieldValue } from '../field-state';
import { finalisationGate } from '../finalisation';
import { assessRisk } from '../risk/engine';
import { frameworkApplicability, SEED_FRAMEWORKS } from '../registry/registry';
import { goldenV1Context } from './golden-fixture';
import { planV1Migration } from './v1-mapper';

const at = new Date('2026-11-20T10:00:00Z');
const plan = planV1Migration(goldenV1Context(), at);
const values: Record<string, FieldValue> = Object.fromEntries(plan.fields.map((f) => [f.field_id, f]));
const recordType = 'MODEL_CONFIGURATION';

describe('golden fixture: the v1 "Global Ai Model Settings" card after migration (Slice 2 items)', () => {
  it('(e) shows the tier as requiring reassessment, and lets it be LOW only with a valid named risk acceptance', () => {
    const r = assessRisk({ recordType, values });
    expect(r.status).toBe('NOT_ASSESSED');
    expect(plan.risk.status).toBe('REQUIRES_REASSESSMENT');
    // A person enters LOW with their own rationale (not the v1 AI draft): blocked without an acceptance...
    const person = 'ciso@example.test';
    const put = (id: string, v: any) => enterValue(emptyField(id), fieldDef(id)!, v, person, at);
    const low = {
      ...values, tenant_reach: put('tenant_reach', 'ALL_TENANTS'), inherent_risk_tier: put('inherent_risk_tier', 'LOW'),
      residual_risk_tier: put('residual_risk_tier', 'LOW'), risk_rationale: put('risk_rationale', 'Settings screen only; a change of default goes through change control.'),
    };
    const blocked = assessRisk({ recordType, values: low });
    expect(blocked.findings.find((f) => f.code === 'SHARED_CONFIG_LOW_WITHOUT_ACCEPTANCE')).toMatchObject({ hard_rule: 3, blocking: true });
    // ...and allowed past hard rule 3 with a valid acceptance from a named risk owner.
    const accepted = assessRisk({
      recordType, values: low,
      acceptance: { risk_id: 'risk-1', accepted_by: 'owner@example.test', accepted_at: at.toISOString(), expires_at: '2027-05-20T00:00:00.000Z', conditions: 'Four-eyes on every default change', valid: true },
    });
    expect(accepted.findings.map((f) => f.code)).not.toContain('SHARED_CONFIG_LOW_WITHOUT_ACCEPTANCE');
  });

  it('(f) shows ISO/IEC 42001 controls as NOT_ASSESSED, keeping the v1 verdict, under the organisational wording', () => {
    const iso = plan.verdicts_reset.find((v) => registryIdForV1Label(v.framework) === 'iso-42001-2023')!;
    const fw = frameworkApplicability(SEED_FRAMEWORKS, { recordType, facts: factsFrom(values), adopted: new Set(['iso-42001-2023']), at })
      .find((f) => f.framework_id === 'iso-42001-2023')!;
    const migrated: ControlAssessment[] = fw.controls.map((c) => ({
      framework_id: fw.framework_id, framework_revision: fw.revision, control_id: c.control_id, status: 'NOT_ASSESSED', justification: null, evidence_refs: [],
      assessed_by: null, assessed_at: null, implemented_by: null, verified_by: null, migrated_from_v1_verdict: iso.v1_verdict,
    }));
    const views = controlViews(fw, migrated, new Set());
    expect(views.every((v) => v.status === 'NOT_ASSESSED' && v.assessment?.migrated_from_v1_verdict === 'compliant')).toBe(true);
    expect(fw.organisational_only).toBe(true);
  });

  it('(h) is blocked from FINAL', () => {
    const app = evaluateApplicability(recordType, factsFrom(values));
    const gate = finalisationGate({ fields: app.fields, values, consistency: plan.consistency, risk: assessRisk({ recordType, values }), owner: plan.owner });
    expect(gate.can_finalise).toBe(false);
    const codes = gate.blockers.map((b) => b.code);
    expect(codes).toEqual(expect.arrayContaining([
      'STATE_NOT_DEPLOYED_ACTIVE', 'STATE_COMPONENT_UNRELEASED_ACTIVE', 'UNACCEPTED_SUGGESTION', 'RISK_NOT_ASSESSED', 'OWNER_SERVICE_ACCOUNT',
    ]));
    // The record type itself is an unaccepted code-scan value.
    expect(gate.blockers.find((b) => b.field_id === 'record_type')?.code).toBe('UNACCEPTED_SUGGESTION');
  });
});
