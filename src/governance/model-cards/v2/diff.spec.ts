import { diffCards } from './diff';

const card = (over: { purpose?: any; status?: string; prov?: string | null; accepted?: string | null; iso?: string; doc?: number; tier?: string; state?: string } = {}) => ({
  record: { workflow_state: over.state ?? 'DRAFT' },
  summary: { record_type: 'MODEL_CONFIGURATION', inherent_risk_tier: over.tier ?? null },
  sections: [{
    section_id: 'purpose', title: 'Purpose', fields: [
      { field_id: 'intended_purpose', label: 'Intended purpose', value: { value: over.purpose ?? null, status: over.status ?? 'NOT_ASSESSED', provenance: over.prov ?? null, accepted_by: over.accepted ?? null } },
      { field_id: 'out_of_scope', label: 'Out of scope uses', value: { value: null, status: 'NOT_ASSESSED', provenance: null, accepted_by: null } },
    ],
  }],
  frameworks: [{ framework_id: 'iso-42001-2023', revision: 1, controls: [{ control_id: 'A.2', status: over.iso ?? 'NOT_ASSESSED' }] }],
  scores: [{ id: 'documentation', numerator: over.doc ?? 0, denominator: 62 }],
});

describe('model card v2 version diff', () => {
  it('reports nothing for identical cards', () => {
    const r = diffCards(card(), card());
    expect(r.changes).toEqual([]);
    expect(r.counts).toEqual({ field: 0, control: 0, score: 0, summary: 0 });
  });

  it('lists field, control, score, summary and workflow changes, and skips fields empty in both', () => {
    const a = card({ purpose: 'Old', status: 'COMPLETE', prov: 'IMPORTED_V1' });
    const b = card({ purpose: 'New', status: 'COMPLETE', prov: 'HUMAN_ENTERED', accepted: 'a@x', iso: 'IMPLEMENTED', doc: 1, tier: 'MEDIUM', state: 'ASSESSMENT' });
    const r = diffCards(a, b);
    expect(r.counts).toEqual({ field: 1, control: 1, score: 1, summary: 2 });
    const f = r.changes.find((c) => c.kind === 'field')!;
    expect(f).toMatchObject({ key: 'intended_purpose', label: 'Intended purpose', section: 'Purpose' });
    expect(f.before).toEqual({ value: 'Old', status: 'COMPLETE', provenance: 'IMPORTED_V1', accepted: false });
    expect(f.after).toEqual({ value: 'New', status: 'COMPLETE', provenance: 'HUMAN_ENTERED', accepted: true });
    expect(r.changes.find((c) => c.kind === 'control')).toMatchObject({ key: 'iso-42001-2023:A.2', before: 'NOT_ASSESSED', after: 'IMPLEMENTED' });
    expect(r.changes.find((c) => c.kind === 'score')).toMatchObject({ before: '0/62', after: '1/62' });
    expect(r.changes.filter((c) => c.kind === 'summary').map((c) => c.key).sort()).toEqual(['inherent_risk_tier', 'workflow_state']);
    expect(r.changes.some((c) => c.key === 'out_of_scope')).toBe(false);
  });

  it('notices acceptance alone (same value, now accepted by a person)', () => {
    const r = diffCards(card({ purpose: 'P', status: 'COMPLETE', prov: 'IMPORTED_V1' }), card({ purpose: 'P', status: 'COMPLETE', prov: 'IMPORTED_V1', accepted: 'a@x' }));
    expect(r.counts.field).toBe(1);
  });

  it('handles a field or control present on only one side', () => {
    const b = card({ purpose: 'P', status: 'COMPLETE' });
    const a = { ...card(), sections: [], frameworks: [] };
    const r = diffCards(a, b);
    expect(r.changes.find((c) => c.kind === 'field')!.before).toBeNull();
    expect(r.changes.find((c) => c.kind === 'control')).toMatchObject({ before: null, after: 'NOT_ASSESSED' });
  });
});
