import { FIELDS, SECTIONS } from '../catalogue';
import { evaluateApplicability, evaluateRule, Facts } from './engine';
import { RULE_IDS, RULES } from './rules';

const eff = (facts: Facts, field: string, type: any = 'AI_MODEL') => evaluateApplicability(type, facts).fields.find((f) => f.field_id === field)!;

describe('model card v2: applicability rules (spec §6)', () => {
  it('every rule the catalogue names exists, and every nested rule exists', () => {
    for (const f of FIELDS) if (f.applicability_rule_id) expect(RULE_IDS).toContain(f.applicability_rule_id);
    for (const s of SECTIONS) if (s.applicability_rule_id) expect(RULE_IDS).toContain(s.applicability_rule_id);
    for (const r of RULES) expect(() => evaluateRule(r.id, {})).not.toThrow();
  });

  it('generative → labelling, hallucination, harmful-output and prompt-injection testing become mandatory', () => {
    for (const id of ['content_labelling', 'user_disclosure', 'eval_hallucination', 'eval_harmful_output', 'eval_prompt_injection']) {
      expect(eff({ model_category: 'LLM' }, id)).toMatchObject({ effective: 'MANDATORY', rule: { id: 'R_GENERATIVE', result: 'FIRED' } });
      expect(eff({ model_category: 'TRADITIONAL_ML', uses_generative: false }, id)).toMatchObject({ applicable: false, effective: 'NOT_REQUIRED' });
    }
    // Not knowing what the record uses leaves it undetermined, not "not generative".
    expect(eff({ model_category: 'TRADITIONAL_ML' }, 'eval_hallucination')).toMatchObject({ effective: 'RECOMMENDED', rule: { result: 'UNDETERMINED' } });
    // A configuration that selects a generative model is generative too.
    expect(eff({ model_category: 'NOT_A_MODEL', uses_generative: true }, 'eval_prompt_injection', 'MODEL_CONFIGURATION').effective).toBe('MANDATORY');
  });

  it('RAG pipeline → the RAG data fields become mandatory', () => {
    expect(eff({ record_type: 'RAG_PIPELINE' }, 'rag_sources', 'RAG_PIPELINE').effective).toBe('MANDATORY');
    expect(eff({ record_type: 'AI_MODEL' }, 'rag_sources').effective).toBe('NOT_REQUIRED');
  });

  it('agent, or autonomy above NONE → agent fields become mandatory', () => {
    expect(eff({ record_type: 'AGENT' }, 'agent_emergency_stop', 'AGENT').effective).toBe('MANDATORY');
    expect(eff({ record_type: 'AI_SYSTEM', autonomy_level: 'ACTS_WITH_APPROVAL' }, 'agent_tools', 'AI_SYSTEM').effective).toBe('MANDATORY');
    expect(eff({ record_type: 'AI_SYSTEM', autonomy_level: 'NONE' }, 'agent_tools', 'AI_SYSTEM').effective).toBe('NOT_REQUIRED');
  });

  it('personal data YES → privacy, lawful basis, retention, residency and transfer fields; GDPR or DPDP by jurisdiction', () => {
    for (const id of ['privacy_impact', 'lawful_basis', 'retention', 'residency', 'cross_border_transfers', 'data_flows']) {
      expect(eff({ personal_data: 'YES' }, id).effective).toBe('MANDATORY');
      expect(eff({ personal_data: 'NO' }, id).effective).toBe('NOT_REQUIRED');
    }
    expect(evaluateRule('R_GDPR', { personal_data: 'YES', jurisdictions: ['EU'] }).result).toBe('FIRED');
    expect(evaluateRule('R_DPDP', { personal_data: 'YES', jurisdictions: ['EU'] }).result).toBe('NOT_FIRED');
    expect(evaluateRule('R_DPDP', { personal_data: 'YES', jurisdictions: ['IN'] }).result).toBe('FIRED');
  });

  it('EU jurisdiction → EU role and classification; FRIA only for a deployer meeting Art. 27', () => {
    expect(eff({ jurisdictions: ['EU'] }, 'eu_role').effective).toBe('MANDATORY');
    expect(eff({ jurisdictions: ['EU'] }, 'eu_classification').effective).toBe('MANDATORY');
    expect(eff({ jurisdictions: ['IN'] }, 'eu_classification').effective).toBe('NOT_REQUIRED');
    expect(eff({ jurisdictions: ['EU'], eu_role: ['DEPLOYER'], eu_art27_criteria: 'NO' }, 'fria_ref').effective).toBe('NOT_REQUIRED');
    expect(eff({ jurisdictions: ['EU'], eu_role: ['DEPLOYER'], eu_art27_criteria: 'YES' }, 'fria_ref').effective).toBe('MANDATORY');
    expect(eff({ jurisdictions: ['EU'], eu_role: ['AI_SYSTEM_PROVIDER'], eu_art27_criteria: 'YES' }, 'fria_ref').effective).toBe('NOT_REQUIRED');
  });

  it('third-party provider → the Third-party governance section becomes applicable and mandatory', () => {
    const on = evaluateApplicability('AI_MODEL', { third_party_provider_used: 'YES' });
    expect(on.sections.find((s) => s.section_id === 'third_party')!.applicable).toBe(true);
    expect(on.fields.find((f) => f.field_id === 'tp_exit_strategy')!.effective).toBe('MANDATORY');
    const off = evaluateApplicability('AI_MODEL', { third_party_provider_used: 'NO' });
    expect(off.sections.find((s) => s.section_id === 'third_party')!.applicable).toBe(false);
    expect(off.fields.find((f) => f.field_id === 'tp_exit_strategy')!.applicable).toBe(false);
  });

  it('tenant reach above one → change management and tenant notification become mandatory', () => {
    for (const id of ['change_management_process', 'tenant_notification', 'eval_cross_tenant_leakage']) {
      expect(eff({ tenant_reach: 'ALL_TENANTS' }, id, 'MODEL_CONFIGURATION').effective).toBe('MANDATORY');
      expect(eff({ tenant_count: 40 }, id, 'MODEL_CONFIGURATION').effective).toBe('MANDATORY');
      expect(eff({ tenant_reach: 'ONE_TENANT', tenant_count: 1 }, id, 'MODEL_CONFIGURATION').effective).toBe('NOT_REQUIRED');
    }
  });

  it('a fact that is not assessed, or UNKNOWN, leaves the rule undetermined instead of guessing', () => {
    const f = eff({ personal_data: 'UNKNOWN' }, 'lawful_basis');
    expect(f).toMatchObject({ applicable: true, effective: 'RECOMMENDED', rule: { id: 'R_PERSONAL_DATA', result: 'UNDETERMINED' } });
    expect(evaluateRule('R_EU_FRIA', { jurisdictions: ['EU'] }).missing).toEqual(expect.arrayContaining(['eu_role']));
    const tp = evaluateApplicability('AI_MODEL', {});
    expect(tp.sections.find((s) => s.section_id === 'third_party')!.applicable).toBe(true);
    expect(tp.fields.find((x) => x.field_id === 'tp_exit_strategy')!.effective).toBe('RECOMMENDED');
  });

  it('filters by record type, and shows every field while the record is unclassified', () => {
    expect(eff({}, 'config_default_model', 'AI_MODEL')).toMatchObject({ applicable: false, not_applicable_reason: 'Does not apply to AI_MODEL records.' });
    expect(eff({}, 'config_default_model', 'MODEL_CONFIGURATION').effective).toBe('MANDATORY');
    expect(eff({}, 'config_default_model', null).applicable).toBe(true);
  });
});
