/**
 * Remediation plan currency.
 *
 * A remediation plan is drafted against the gaps that were open at the time and
 * persisted on the model. Gaps then close (evidence attached, drift evaluated,
 * red team recorded) or new ones open, but the persisted text never changed, so
 * "Close Governance Gaps" kept showing the plan for the gaps found at first scan.
 *
 * Every read now compares the plan with the live evaluation:
 *  - a heuristic plan is a pure function of the open gaps, so it is rebuilt from
 *    them on every read and is always current;
 *  - an AI plan cannot be rebuilt for free, so it is returned as written and
 *    flagged stale, with how many of its gaps have closed and how many are new,
 *    so the console can offer a re-draft instead of presenting it as current.
 */

/** Labels used to prefix each gap line, one per framework report. */
export const GAP_LINE_PREFIX = {
  rbi: '[RBI FREE-AI]',
  nist: '[NIST AI RMF]',
  eu: '[EU AI Act]',
  iso: '[ISO 42001]',
} as const;

/** Deterministic remediation hint per known gap pattern — the no-AI fallback. */
export function heuristicRemediationStep(gap: string): string {
  const g = gap.toLowerCase();
  if (g.includes('board-approved') || g.includes('board policy')) return 'Set a board-approved AI policy reference in the governance form (e.g. AI-POLICY-2026-xxx).';
  if (g.includes('owner') || g.includes('accountability chain')) return 'Assign a named owner team in the governance form.';
  // Continuity before drift: the BCP gap mentions /monitoring/bcp.
  if (g.includes('continuity') || g.includes('fallback') || g.includes('bcp')) return 'Configure the business-continuity fallback via /monitoring/bcp.';
  if (g.includes('bias')) return 'Run a bias/fairness test and attach the report as a bias_test evidence artifact.';
  if (g.includes('red-team') || g.includes('red team')) return 'Complete a red-team review and record its date (or attach a red_team artifact).';
  if (g.includes('privacy') || g.includes('dpia')) return 'Complete a privacy impact assessment and attach it as a dpia evidence artifact.';
  if (g.includes('drift') || g.includes('inference scores') || g.includes('monitoring')) return 'Push live score windows to /monitoring/scores so drift evaluation runs.';
  if (g.includes('audit schedule') || g.includes('audit due')) return 'Set the next audit due date to establish a recurring audit schedule.';
  if (g.includes('oversight') || g.includes('human')) return 'Enable human oversight or document the bounded autonomous scope.';
  if (g.includes('secret')) return 'Remove the hardcoded credential from source, rotate it, and re-scan the project.';
  return 'Assign an owner and schedule this item in the next governance review.';
}

interface ReportLike {
  /** Frameworks whose criteria apply (enabled packs); every framework when absent. */
  frameworks_in_scope?: string[];
  blocking_gaps?: string[];
  nist_rmf?: { blocking_gaps?: string[] } | null;
  eu_ai_act?: { blocking_gaps?: string[] } | null;
  iso_42001?: { blocking_gaps?: string[] } | null;
}

/** The open gaps of a compliance-check report, one prefixed line per gap. */
export function gapLinesOf(report: ReportLike): string[] {
  // A switched-off pack's gaps are not asked for: they never enter the plan.
  const on = (id: string) => !Array.isArray(report.frameworks_in_scope) || report.frameworks_in_scope.includes(id);
  return [
    ...(on('rbi_free_ai') ? report.blocking_gaps ?? [] : []).map((g) => `${GAP_LINE_PREFIX.rbi} ${g}`),
    ...(on('nist_ai_rmf') ? report.nist_rmf?.blocking_gaps ?? [] : []).map((g) => `${GAP_LINE_PREFIX.nist} ${g}`),
    ...(on('eu_ai_act') ? report.eu_ai_act?.blocking_gaps ?? [] : []).map((g) => `${GAP_LINE_PREFIX.eu} ${g}`),
    ...(on('iso_42001') ? report.iso_42001?.blocking_gaps ?? [] : []).map((g) => `${GAP_LINE_PREFIX.iso} ${g}`),
  ];
}

/** The deterministic plan for these gaps (null when nothing is open). */
export function heuristicPlan(gapLines: string[]): string | null {
  if (!gapLines.length) return null;
  return gapLines.map((g) => `• ${g}\n  → Action: ${heuristicRemediationStep(g)}`).join('\n');
}

const PLAN_LINE = /^•\s+(\[(?:RBI FREE-AI|NIST AI RMF|EU AI Act|ISO 42001)\][^\n]*)$/gm;

/** Gap lines a plan was written for: recorded at draft time, else read back from a bulleted plan. */
export function draftedGapLines(plan: string | null, recorded: string[] | null | undefined): string[] | null {
  if (recorded) return recorded;
  if (!plan) return null;
  const found = [...plan.matchAll(PLAN_LINE)].map((m) => m[1].trim());
  return found.length ? found : null;
}

export interface PlanView {
  text: string | null;
  source: string | null;
  /** True when the plan was written for a different set of gaps than are open now. */
  stale: boolean;
  /** Gaps the plan covers that are no longer open. */
  closed: number;
  /** Open gaps the plan does not cover. */
  added: number;
}

/** What the console should show as the model's remediation plan right now. */
export function currentPlan(
  m: { gapRemediation: string | null; gapRemediationSource: string | null; gapRemediationGaps?: string[] | null },
  openGapLines: string[],
): PlanView {
  const source = m.gapRemediationSource ?? null;
  // Heuristic (or never drafted): rebuild from the live gaps — always current.
  if (!m.gapRemediation || source === 'heuristic') {
    const text = heuristicPlan(openGapLines);
    return { text, source: text ? 'heuristic' : null, stale: false, closed: 0, added: 0 };
  }
  const drafted = draftedGapLines(m.gapRemediation, m.gapRemediationGaps);
  const open = new Set(openGapLines);
  if (drafted) {
    const was = new Set(drafted);
    const closed = drafted.filter((g) => !open.has(g)).length;
    const added = openGapLines.filter((g) => !was.has(g)).length;
    return { text: m.gapRemediation, source, stale: closed + added > 0, closed, added };
  }
  // A free-form plan with no record of its gaps: stale when it misses an open gap.
  const body = m.gapRemediation;
  const added = openGapLines.filter((g) => !body.includes(g.replace(/^\[[^\]]+\]\s*/, ''))).length;
  const stale = added > 0 || openGapLines.length === 0;
  return { text: body, source, stale, closed: 0, added };
}
