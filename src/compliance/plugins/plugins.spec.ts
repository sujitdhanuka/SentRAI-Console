import { ISO42001Plugin } from './iso-42001.plugin';
import { EUAIActPlugin } from './eu-ai-act.plugin';
import { evaluate, listFrameworks } from '../framework-registry';

const COMPLIANT_ASSET = {
  model_id: '11111111-1111-1111-1111-111111111111',
  name: 'Credit Risk Scorer',
  model_type: 'MACHINE_LEARNING',
  functional_area: 'credit_underwriting',
  use_case_description: 'Evaluates credit applications for SME loans',
  risk_level: 'HIGH',
  lifecycle_stage: 'DEPLOYED',
  owner_team: 'Risk Engineering',
  developed_by: 'internal',
  board_policy_ref: 'AI-POLICY-2026-001',
  human_oversight_required: true,
  sutras_alignment: ['TRUST_IS_THE_FOUNDATION', 'PEOPLE_FIRST'],
  target_customer_segments: ['sme'],
};

const NON_COMPLIANT_ASSET = {
  model_id: '22222222-2222-2222-2222-222222222222',
  name: 'Unmanaged AI',
  model_type: 'GENERATIVE_AI',
  functional_area: 'general_purpose',
  use_case_description: '',
  risk_level: '',
  lifecycle_stage: 'DESIGN',
  owner_team: '',
  developed_by: '',
  board_policy_ref: null,
  human_oversight_required: false,
  sutras_alignment: [],
  target_customer_segments: [],
};

describe('compliance plugins (parity with test_compliance_plugins.py)', () => {
  it('ISO plugin passes a compliant asset with score > 0.5', () => {
    const report = new ISO42001Plugin().evaluate(COMPLIANT_ASSET);
    expect(report.frameworkId).toBe('ISO_42001');
    expect(report.overallPass).toBe(true);
    expect(report.score).toBeGreaterThan(0.5);
  });

  it('ISO plugin flags blocking gaps for a non-compliant asset', () => {
    const report = new ISO42001Plugin().evaluate(NON_COMPLIANT_ASSET);
    expect(report.overallPass).toBe(false);
    expect(report.blockingGaps.length).toBeGreaterThan(0);
  });

  it('ISO plugin: missing owner team is blocking (ISO42001-5.3)', () => {
    const report = new ISO42001Plugin().evaluate({ ...COMPLIANT_ASSET, owner_team: '' });
    expect(report.blockingGaps.map((r) => r.controlId)).toContain('ISO42001-5.3');
  });

  it('EU plugin classifies high risk and passes the Art6 classification control', () => {
    const report = new EUAIActPlugin().evaluate(COMPLIANT_ASSET);
    expect(report.frameworkId).toBe('EU_AI_ACT');
    expect(report.passedControls.some((r) => r.controlId === 'EUAIA-Art6')).toBe(true);
  });

  it('EU plugin blocks high-risk asset missing human oversight (EUAIA-Art14)', () => {
    const report = new EUAIActPlugin().evaluate({ ...COMPLIANT_ASSET, human_oversight_required: false });
    expect(report.overallPass).toBe(false);
    expect(report.blockingGaps.map((r) => r.controlId)).toContain('EUAIA-Art14');
  });

  it('registry lists three frameworks and evaluates by id, throwing on unknown', () => {
    const ids = listFrameworks().map((f) => f.framework_id);
    expect(ids).toEqual(expect.arrayContaining(['RBI_FREE_AI', 'ISO_42001', 'EU_AI_ACT']));
    expect(evaluate(COMPLIANT_ASSET, 'ISO_42001').frameworkId).toBe('ISO_42001');
    expect(() => evaluate(COMPLIANT_ASSET, 'UNKNOWN_FRAMEWORK')).toThrow('Unknown compliance framework');
  });
});
