import { cardPdfLines, generateCardV2Pdf, PDF_DISCLAIMER, PdfMeta } from './card-v2.pdf';

const card = {
  model_name: 'Global Ai Model Settings',
  catalogue_version: '2.0.0',
  record: { workflow_state: 'DRAFT', next_review_at: null, review_status: 'NOT_SCHEDULED' },
  summary: {
    record_type: 'MODEL_CONFIGURATION', record_type_accepted: false,
    states: { component_lifecycle: 'PLANNED', deployment_status: 'NOT_DEPLOYED', operational_status: 'ACTIVE', governance_workflow_state: 'DRAFT' },
    inherent_risk_tier: null, residual_risk_tier: null, risk_status: 'BLOCKED',
    regulatory_classification: { eu: null, kr_high_impact: null },
  },
  scores: [
    { id: 'documentation', title: 'Documentation completeness', numerator: 3, denominator: 62, percent: 5, how: 'Required fields complete or justified N/A.' },
    { id: 'evidence', title: 'Evidence', numerator: 0, denominator: 22, percent: 0, how: 'Required evidence attached and fresh.' },
  ],
  gate: { blockers: [{ code: 'RISK_NOT_ASSESSED', message: 'The risk has not been assessed.' }] },
  risk: {
    score: 23, max_score: 23, score_tier: 'CRITICAL', computed_inherent_tier: 'CRITICAL',
    contributions: [{ label: 'Severity of harm', value: null, points: 5, max_points: 5, note: 'not assessed, worst plausible' }],
    floors: [{ tier: 'HIGH', reason: 'Severity not assessed' }],
    findings: [{ code: 'INHERENT_TIER_NOT_SET', blocking: true, hard_rule: null, message: 'A person must set the inherent tier.' }],
  },
  frameworks: [
    { framework_id: 'iso-42001-2023', short_title: 'ISO/IEC 42001', applies: 'APPLIES', label: 'Applies', heading: 'ISO/IEC 42001 Annex A mapping (supporting evidence only, cannot show conformity)', revision: 1, verification_status: 'UNVERIFIED_REQUIRES_LEGAL_REVIEW',
      controls: [{ control_id: 'A.2', title: 'AI policies', status: 'NOT_ASSESSED', in_force: 'IN_FORCE' }] },
    { framework_id: 'gdpr', short_title: 'GDPR', applies: 'DOES_NOT_APPLY', label: 'Does not apply', heading: '', revision: 1, verification_status: 'UNVERIFIED_REQUIRES_LEGAL_REVIEW', controls: [] },
  ],
  sections: [
    { section_id: 'purpose', number: 2, title: 'Purpose and scope', applicable: true, completion: { numerator: 0, denominator: 2 }, fields: [
      { field_id: 'intended_purpose', label: 'Intended purpose', applicable: true, effective: 'MANDATORY', sensitive: false, framework_control_refs: ['nist-ai-rmf-1.0:MAP-1.1'],
        value: { value: 'Selects the default model', status: 'COMPLETE', provenance: 'IMPORTED_V1', accepted_by: null, suggestion: null, evidence_refs: [] } },
      { field_id: 'out_of_scope', label: 'Out of scope uses', applicable: true, effective: 'MANDATORY', sensitive: false, framework_control_refs: [],
        value: { value: null, status: 'NOT_APPLICABLE', provenance: 'HUMAN_ENTERED', accepted_by: 'a@x', na_justification: 'Internal setting only', na_decided_by: 'a@x' } },
      { field_id: 'api_secret', label: 'Secret', applicable: true, effective: 'RECOMMENDED', sensitive: true, framework_control_refs: [],
        value: { value: 'shh', status: 'COMPLETE', provenance: 'HUMAN_ENTERED', accepted_by: 'a@x', evidence_refs: [{ type: 'DOCUMENT', ref: 'doc-1' }], verified_by: 'b@x' } },
    ] },
    { section_id: 'genai', number: 9, title: 'Generative AI', applicable: false, completion: { numerator: 0, denominator: 0 }, fields: [] },
  ],
  approvals: [{ step: 'REVIEW', decision: 'APPROVED_WITH_CONDITIONS', decided_by: 'r@x', decided_role: 'REVIEWER', decided_at: '2026-11-20T00:00:00.000Z', superseded: false, comment: null,
    conditions: [{ text: 'Add a test report', owner: 'o@x', due: '2026-12-31' }] }],
};

const meta: PdfMeta = { version: null, kind: 'LIVE', content_hash: 'abc123', generated_by: 'officer@example.com', generated_at: '2026-11-20T10:00:00.000Z' };

describe('model card v2 PDF', () => {
  it('lays out the card (snapshot)', () => {
    expect(cardPdfLines(card, meta)).toMatchSnapshot();
  });

  it('has document control, the disclaimer, draft status, provenance marks, approvals; leaves out N/A sections, non-applying frameworks and sensitive values', () => {
    const text = cardPdfLines(card, meta).map((l) => ('label' in l ? `${l.label}: ${l.text}` : l.text)).join('\n');
    expect(text).toContain('Status: DRAFT (live)');
    expect(text).toContain('Content hash (SHA-256): abc123');
    expect(text).toContain('officer@example.com');
    expect(text).toContain(PDF_DISCLAIMER);
    expect(text).toContain('imported from v1');
    expect(text).toContain('awaiting acceptance');
    expect(text).toContain('N/A: Internal setting only (decided by a@x)');
    expect(text).toContain('Evidence: DOCUMENT doc-1; verified by b@x');
    expect(text).toContain('Framework refs: nist-ai-rmf-1.0:MAP-1.1');
    expect(text).toContain('condition: Add a test report (owner o@x, due 2026-12-31)');
    expect(text).toContain('Documentation completeness: 3 / 62');
    expect(text).not.toContain('Generative AI');
    expect(text).not.toContain('GDPR');
    expect(text).not.toContain('shh');
    expect(text.toLowerCase()).not.toMatch(/\bcompliant\b|\bcertified\b/);
  });

  it('marks an approved version as approved', () => {
    const lines = cardPdfLines(card, { ...meta, version: 3, kind: 'APPROVED' });
    expect(lines).toContainEqual({ k: 'kv', label: 'Status', text: 'APPROVED v3' });
  });

  it('renders a PDF with the DRAFT watermark unless approved', async () => {
    const draft = await generateCardV2Pdf(card, meta, new Date('2026-11-20T10:00:00Z'));
    expect(draft.subarray(0, 5).toString()).toBe('%PDF-');
    const approved = await generateCardV2Pdf(card, { ...meta, version: 1, kind: 'APPROVED' }, new Date('2026-11-20T10:00:00Z'));
    expect(approved.subarray(0, 5).toString()).toBe('%PDF-');
    // The watermark is drawn as text, so the draft holds one more text run per page than the approved copy.
    expect(draft.length).toBeGreaterThan(approved.length);
  });
});
