import { RECORD_TYPES } from '../record-types';
import { CATALOGUE_VERSION, fieldDef, FIELDS, HUMAN_ONLY_FIELDS, REASSESSMENT_TRIGGERS, SECTIONS } from './index';

describe('model card v2: field catalogue', () => {
  it('has the 18 sections in order', () => {
    expect(SECTIONS.map((s) => s.number)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(new Set(SECTIONS.map((s) => s.section_id)).size).toBe(18);
  });

  it('has unique field ids, each in the section it is listed under, with help text', () => {
    const ids = FIELDS.map((f) => f.field_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SECTIONS) for (const f of s.fields) expect(f.section_id).toBe(s.section_id);
    for (const f of FIELDS) {
      expect(f.field_id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(f.help_text.length).toBeGreaterThan(10);
      expect(f.catalogue_version).toBe(CATALOGUE_VERSION);
    }
    expect(FIELDS.length).toBeGreaterThanOrEqual(250);
  });

  it('types every field fully', () => {
    for (const f of FIELDS) {
      if (f.data_type === 'enum' || f.data_type === 'multi' || f.data_type === 'tristate') expect(f.allowed_values?.length).toBeGreaterThan(1);
      if (f.data_type === 'table') expect(f.columns?.length).toBeGreaterThan(0);
      for (const c of f.columns ?? []) if (c.data_type === 'enum') expect(c.allowed_values?.length).toBeGreaterThan(1);
      expect(f.applies_to_record_types.length).toBeGreaterThan(0);
      for (const t of f.applies_to_record_types) expect(RECORD_TYPES).toContain(t);
      if (f.default_requirement === 'CONDITIONAL') expect(f.applicability_rule_id).toMatch(/^R_[A-Z_]+$/);
      if (f.evidence_required.required) expect(f.evidence_required.type).toBeTruthy();
      for (const r of f.framework_control_refs) expect(r).toMatch(/^[a-z0-9.-]+:[A-Za-z0-9._-]+$/);
    }
  });

  it('never lets the suggestion engine draft human-only fields', () => {
    for (const id of HUMAN_ONLY_FIELDS) {
      expect(fieldDef(id)).toBeDefined();
      expect(fieldDef(id)!.ai_suggestable).toBe(false);
    }
  });

  it('records personal data as YES / NO / UNKNOWN (D4), and counts as ZERO_RECORDED / NO_DATA / NOT_MONITORED (D9)', () => {
    expect(fieldDef('personal_data')).toMatchObject({ data_type: 'tristate', allowed_values: ['YES', 'NO', 'UNKNOWN'], default_requirement: 'MANDATORY' });
    expect(fieldDef('incident_count')!.data_type).toBe('count');
    expect(fieldDef('grievance_count')!.data_type).toBe('count');
  });

  it('triggers reassessment on every change the spec names', () => {
    for (const id of [
      'version', 'provider', 'system_prompt', 'training_data_sources', 'fine_tuning', 'api_integration', 'config_default_model',
      'config_tenant_overrides', 'intended_use', 'agent_tools', 'agent_permissions', 'jurisdictions', 'tenant_reach',
    ]) expect(REASSESSMENT_TRIGGERS).toContain(id);
  });

  it('describes owners as people and keeps the four state fields separate', () => {
    for (const id of ['accountable_owner', 'technical_owner', 'business_owner', 'compliance_owner']) expect(fieldDef(id)!.data_type).toBe('user');
    for (const id of ['component_lifecycle', 'model_lifecycle', 'deployment_status', 'operational_status']) expect(fieldDef(id)!.section_id).toBe('identity');
  });
});
