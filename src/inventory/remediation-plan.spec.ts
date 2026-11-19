import { currentPlan, draftedGapLines, gapLinesOf, heuristicPlan, heuristicRemediationStep } from './remediation-plan';

const report = {
  blocking_gaps: ['No bias-test evidence attached.'],
  nist_rmf: { blocking_gaps: ['Measure stage requires recent drift evaluation over live inference scores.'] },
  eu_ai_act: { blocking_gaps: [] },
  iso_42001: { blocking_gaps: ['Clause 9.1 requires active performance monitoring of deployed AI systems.'] },
};

describe('remediation plan currency', () => {
  const open = gapLinesOf(report);

  it('prefixes each open gap with its framework', () => {
    expect(open).toEqual([
      '[RBI FREE-AI] No bias-test evidence attached.',
      '[NIST AI RMF] Measure stage requires recent drift evaluation over live inference scores.',
      '[ISO 42001] Clause 9.1 requires active performance monitoring of deployed AI systems.',
    ]);
  });

  it('rebuilds a heuristic plan from the live gaps, dropping closed ones', () => {
    const firstScan = heuristicPlan([...open, '[NIST AI RMF] A recurring audit schedule must be defined for each model.']);
    const view = currentPlan({ gapRemediation: firstScan, gapRemediationSource: 'heuristic' }, open);
    expect(view.text).toBe(heuristicPlan(open));
    expect(view.text).not.toContain('recurring audit schedule');
    expect(view.stale).toBe(false);
  });

  it('returns no plan once every gap is closed', () => {
    const view = currentPlan({ gapRemediation: heuristicPlan(open), gapRemediationSource: 'heuristic' }, []);
    expect(view.text).toBeNull();
  });

  it('flags an AI plan stale with counts when its recorded gaps changed', () => {
    const view = currentPlan(
      { gapRemediation: 'AI plan text', gapRemediationSource: 'ai', gapRemediationGaps: [open[0], '[EU AI Act] gone'] },
      open,
    );
    expect(view.text).toBe('AI plan text');
    expect(view.stale).toBe(true);
    expect(view.closed).toBe(1);
    expect(view.added).toBe(2);
  });

  it('treats an AI plan for the same gaps as current', () => {
    const view = currentPlan({ gapRemediation: 'AI plan', gapRemediationSource: 'ai', gapRemediationGaps: [...open] }, open);
    expect(view.stale).toBe(false);
  });

  it('reads the gaps back from a bulleted plan saved before they were recorded', () => {
    expect(draftedGapLines(heuristicPlan(open), null)).toEqual(open);
  });

  it('maps the BCP gap to the continuity step, not the drift step', () => {
    expect(heuristicRemediationStep('High-risk models need a configured business-continuity fallback (activate via /monitoring/bcp).'))
      .toContain('business-continuity');
  });
});
