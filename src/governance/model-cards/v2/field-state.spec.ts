import { fieldDef } from './catalogue';
import {
  acceptImported, acceptSuggestion, attachEvidence, awaitingAcceptance, emptyField, enterValue, FieldStateError, isPopulated, markNotApplicable,
  markUnknown, suggest, systemValue, verify,
} from './field-state';
import { validateValue } from './field-validate';

const at = new Date('2026-11-20T10:00:00Z');
const def = (id: string) => fieldDef(id)!;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as FieldStateError).code;
  }
  return null;
};

describe('model card v2: provenance (spec §5)', () => {
  it('holds an AI suggestion beside the value; it counts only once a person accepts it', () => {
    const s = suggest(emptyField('purpose'), def('purpose'), { value: 'Selects the default LLM for every tenant.', provenance: 'AI_SUGGESTED', source_ref: 'llm:model_summary', removed: [] }, at);
    expect(s.value).toBeNull();
    expect(isPopulated(s)).toBe(false);
    expect(awaitingAcceptance(s)).toBe(true);
    const a = acceptSuggestion(s, def('purpose'), 'alice@example.test', at);
    expect(a).toMatchObject({ value: 'Selects the default LLM for every tenant.', provenance: 'AI_SUGGESTED', accepted_by: 'alice@example.test', status: 'POPULATED' });
    expect(isPopulated(a)).toBe(true);
  });

  it('makes an edited suggestion HUMAN_ENTERED', () => {
    const s = suggest(emptyField('purpose'), def('purpose'), { value: 'Draft', provenance: 'AI_SUGGESTED', source_ref: null, removed: [] }, at);
    expect(acceptSuggestion(s, def('purpose'), 'bob@example.test', at, 'Picks the platform default model.').provenance).toBe('HUMAN_ENTERED');
  });

  it('never suggests human-only fields, or AI text for fields AI may not draft', () => {
    expect(code(() => suggest(emptyField('inherent_risk_tier'), def('inherent_risk_tier'), { value: 'LOW', provenance: 'CODE_SCAN', source_ref: null, removed: [] }, at))).toBe('HUMAN_ONLY');
    expect(code(() => suggest(emptyField('eu_classification'), def('eu_classification'), { value: 'MINIMAL', provenance: 'AI_SUGGESTED', source_ref: null, removed: [] }, at))).toBe('HUMAN_ONLY');
    expect(code(() => suggest(emptyField('personal_data'), def('personal_data'), { value: 'YES', provenance: 'AI_SUGGESTED', source_ref: null, removed: [] }, at))).toBe('NOT_SUGGESTABLE');
  });

  it('shows IMPORTED_V1 values unaccepted until a person accepts them', () => {
    const v = systemValue(emptyField('purpose'), def('purpose'), 'Old text', 'IMPORTED_V1', 'ai_models.useCaseDescription', at);
    expect(isPopulated(v)).toBe(false);
    expect(awaitingAcceptance(v)).toBe(true);
    expect(isPopulated(acceptImported(v, 'carol@example.test', at))).toBe(true);
    expect(isPopulated(systemValue(emptyField('incident_count'), def('incident_count'), { state: 'ZERO_RECORDED', count: 0 }, 'INTEGRATION', 'incidents', at))).toBe(true);
  });
});

describe('model card v2: field statuses (spec §6)', () => {
  it('keeps UNKNOWN distinct from populated', () => {
    const u = markUnknown(emptyField('personal_data'), 'alice@example.test', at);
    expect(u.status).toBe('UNKNOWN');
    expect(isPopulated(u)).toBe(false);
    expect(enterValue(emptyField('personal_data'), def('personal_data'), 'UNKNOWN', 'a', at).status).toBe('UNKNOWN');
  });

  it('needs a written justification and a decider for NOT_APPLICABLE', () => {
    expect(code(() => markNotApplicable(emptyField('water'), 'alice@example.test', 'n/a', at))).toBe('NA_JUSTIFICATION');
    const na = markNotApplicable(emptyField('water'), 'alice@example.test', 'Third-party API; provider does not disclose.', at);
    expect(na).toMatchObject({ status: 'NOT_APPLICABLE', na_decided_by: 'alice@example.test' });
  });

  it('holds evidence-required values in EVIDENCE_PENDING until evidence is attached', () => {
    const v = enterValue(emptyField('privacy_impact'), def('privacy_impact'), 'DPIA-2026-04', 'alice@example.test', at);
    expect(v.status).toBe('EVIDENCE_PENDING');
    expect(attachEvidence(v, { ref: 'doc:dpia-2026-04', type: 'privacy_impact_assessment', added_by: 'alice@example.test' }, at).status).toBe('POPULATED');
  });

  it('verifies only with evidence and a different person', () => {
    const v = enterValue(emptyField('purpose'), def('purpose'), 'Scores SME credit applications.', 'alice@example.test', at);
    expect(code(() => verify(v, 'bob@example.test', at))).toBe('NO_EVIDENCE');
    const e = attachEvidence(v, { ref: 'doc:1', type: 'design_doc', added_by: 'alice@example.test' }, at);
    expect(code(() => verify(e, 'alice@example.test', at))).toBe('SAME_PERSON');
    expect(verify(e, 'bob@example.test', at)).toMatchObject({ status: 'VERIFIED', verified_by: 'bob@example.test' });
  });

  it('a new value clears an earlier verification', () => {
    const e = attachEvidence(enterValue(emptyField('purpose'), def('purpose'), 'First text here.', 'a', at), { ref: 'r', type: 't', added_by: 'a' }, at);
    const v = verify(e, 'b', at);
    expect(enterValue(v, def('purpose'), 'Changed text here.', 'a', at)).toMatchObject({ status: 'POPULATED', verified_by: null });
  });
});

describe('model card v2: value validation against the catalogue', () => {
  it('checks enums, tri-state, counts and tables', () => {
    expect(validateValue(def('record_type'), 'MODEL_CONFIGURATION')).toEqual([]);
    expect(validateValue(def('record_type'), 'GENERATIVE_AI')).toHaveLength(1);
    expect(validateValue(def('personal_data'), 'likely')).toHaveLength(1);
    expect(validateValue(def('incident_count'), { state: 'NO_DATA' })).toEqual([]);
    expect(validateValue(def('incident_count'), { state: 'RECORDED', count: 0 })).toHaveLength(1);
    expect(validateValue(def('incident_count'), 0)).toHaveLength(1);
    expect(validateValue(def('data_flows'), [{ source: 'App', destination: 'Provider', purpose: 'Inference' }])).toEqual([]);
    expect(validateValue(def('data_flows'), [{ source: 'App' }])).toHaveLength(2);
    expect(validateValue(def('data_flows'), [{ source: 'a', destination: 'b', purpose: 'c', extra: 1 }])[0]).toContain('unknown column');
  });
});
