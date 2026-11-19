import { gapLinesOf } from '../../inventory/remediation-plan';
import { frameworksInScopeOf } from '../../compliance/framework-scope';
import { buildCard, CardFacts, cardHash, cardMarkdown, changedSections, frameworkRefs, readiness } from './model-card.model';

const facts = (over: Partial<CardFacts['model']> = {}, packIds = ['nist-ai-rmf', 'iso-42001']): CardFacts => ({
  model: {
    id: 'm-1', name: 'Credit Scorer', modelType: 'MACHINE_LEARNING', functionalArea: 'credit_underwriting',
    useCaseDescription: 'Scores SME credit applications for the underwriting team', targetCustomerSegments: ['sme'],
    riskLevel: 'HIGH', lifecycleStage: 'PRODUCTION', ownerTeam: 'Credit Risk', developedBy: 'In-house', deploymentDate: null,
    dependencies: [], performanceBenchmarks: [], humanOversightRequired: true, autonomousScope: null, boardPolicyRef: 'BP-1',
    lastRedTeamDate: null, nextAuditDue: null, grievanceCount: 0, sourceRefs: ['svc/score.py'],
    evidenceArtifacts: [{ type: 'bias_test', ref: 'B-1', added_at: '2026-11-01' }],
    riskRationale: 'Consequential credit decisions about SME applicants.', registeredAt: '2026-10-01', operationalState: 'ACTIVE',
    energyKwh: null, co2eKg: null, ...over,
  },
  organisation: 'Acme', project: 'Lending', packIds,
  compliance: [{ framework: 'NIST AI RMF', pass: false, gaps: 2 }],
  governance: {}, datasets: [], approvals: [], validations: [], drift: null, incidents: { total: 0, open: 0 },
});

describe('model cards (E4.1)', () => {
  it('maps sections only to the packs in scope', () => {
    const card = buildCard(facts());
    const packs = new Set(card.sections.flatMap((s) => s.frameworks.map((f) => f.pack_id)));
    expect(packs).toEqual(new Set(['nist-ai-rmf', 'iso-42001']));
    expect(frameworkRefs(['CTL-ACC-01'], ['rbi-free-ai']).map((f) => f.pack_id)).toEqual(['rbi-free-ai']);
    expect(frameworkRefs(['CTL-ACC-01'], [])).toEqual([]);
  });

  it('is final-ready with every required field and clear gates; a gate block or a missing field refuses it', () => {
    const card = buildCard(facts());
    expect(readiness(card, null)).toMatchObject({ final_allowed: true, missing_required: [] });
    const blocked = readiness(card, { block: [{ code: 'IA', message: 'Impact assessment is not final' }], warn: [] });
    expect(blocked.final_allowed).toBe(false);
    expect(blocked.final_blockers).toEqual(['Gate: Impact assessment is not final']);
    const missing = readiness(buildCard(facts({ ownerTeam: 'Unassigned', riskRationale: null, evidenceArtifacts: [] })), null);
    expect(missing.final_allowed).toBe(false);
    expect(missing.missing_required.map((m) => m.label)).toEqual(['Accountable owner', 'Why this tier', 'Evaluation evidence']);
    // An autonomous model needs its scope.
    const auto = readiness(buildCard(facts({ humanOversightRequired: false, autonomousScope: null })), null);
    expect(auto.missing_required.map((m) => m.label)).toEqual(['Autonomous scope']);
  });

  it('flags the sections that changed since a version, and a change of packs', () => {
    const v1 = buildCard(facts());
    const same = buildCard(facts());
    expect(cardHash(same)).toBe(cardHash(v1));
    expect(changedSections(v1, same)).toEqual([]);
    const changed = buildCard(facts({ boardPolicyRef: 'BP-2' }));
    expect(cardHash(changed)).not.toBe(cardHash(v1));
    expect(changedSections(v1, changed)).toEqual(['Governance and compliance']);
    expect(changedSections(v1, buildCard(facts({}, ['nist-ai-rmf', 'iso-42001', 'eu-ai-act'])))).toEqual(['Frameworks in scope']);
  });

  it('exports Markdown with the status, staleness and required markers', () => {
    const card = buildCard(facts());
    const md = cardMarkdown(card, { status: 'LIVE DRAFT', version: null, generated_at: '2026-11-19T00:00:00Z', content_hash: cardHash(card), readiness: readiness(card, null) });
    expect(md).toContain('# Model card: Credit Scorer');
    expect(md).toContain('> DRAFT: not a final model card');
    expect(md).toContain('| Accountable owner * | Credit Risk |');
    const stale = cardMarkdown(card, { status: 'FINAL', version: 3, generated_at: '2026-11-19T00:00:00Z', content_hash: 'x', stale: true, changed_sections: ['Intended use'] });
    expect(stale).toContain('**Status:** FINAL (version 3)');
    expect(stale).toContain('STALE: the model has changed since this version was frozen (Intended use)');
  });
});

describe('framework scope', () => {
  it('reads the frameworks in scope (every framework for an older response)', () => {
    expect(frameworksInScopeOf({})).toEqual(['rbi_free_ai', 'nist_ai_rmf', 'eu_ai_act', 'iso_42001']);
    expect(frameworksInScopeOf({ frameworks_in_scope: ['iso_42001', 'nist_ai_rmf'] })).toEqual(['nist_ai_rmf', 'iso_42001']);
  });

  it('keeps a switched-off pack out of the remediation plan', () => {
    const report = { blocking_gaps: ['rbi gap'], nist_rmf: { blocking_gaps: ['nist gap'] }, eu_ai_act: { blocking_gaps: ['eu gap'] }, iso_42001: { blocking_gaps: [] } };
    expect(gapLinesOf(report)).toHaveLength(3);
    expect(gapLinesOf({ ...report, frameworks_in_scope: ['nist_ai_rmf', 'iso_42001'] })).toEqual(['[NIST AI RMF] nist gap']);
  });
});
