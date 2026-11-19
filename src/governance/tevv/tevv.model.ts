/**
 * TEVV and decommissioning rules (E3.4): acceptance criteria evaluation with
 * segment results, metric-review due dates, the retirement checklist.
 */
export const TEST_PURPOSES = ['ACCEPTANCE', 'REGRESSION', 'FAIRNESS', 'ROBUSTNESS', 'SECURITY', 'VALIDATION'] as const;
export const OPERATORS = ['>=', '<='] as const;

export interface Criterion {
  metric: string;
  operator: '>=' | '<=';
  threshold: number;
  /** null: the overall result; '*': every reported segment; otherwise one named segment. */
  segment: string | null;
}

export interface MetricResult {
  metric: string;
  value: number;
  segment: string | null;
}

const METRIC_RE = /^[a-z0-9_.:-]{1,60}$/i;

export function parseCriteria(v: unknown): Criterion[] {
  if (!Array.isArray(v) || !v.length || v.length > 50) throw new Error('criteria must be a list of 1 to 50 { metric, operator, threshold, segment? }');
  return v.map((c: any, i) => {
    if (!c || typeof c.metric !== 'string' || !METRIC_RE.test(c.metric)) throw new Error(`criteria[${i}].metric must be 1-60 letters, digits, _ . : -`);
    if (!(OPERATORS as readonly string[]).includes(c.operator)) throw new Error(`criteria[${i}].operator must be >= or <=`);
    const t = Number(c.threshold);
    if (c.threshold === null || c.threshold === '' || !Number.isFinite(t)) throw new Error(`criteria[${i}].threshold must be a number`);
    const seg = c.segment === undefined || c.segment === null || c.segment === '' ? null : String(c.segment);
    if (seg !== null && seg !== '*' && !METRIC_RE.test(seg)) throw new Error(`criteria[${i}].segment must be '*' or a segment name`);
    return { metric: c.metric, operator: c.operator, threshold: t, segment: seg };
  });
}

export function parseResults(v: unknown): MetricResult[] {
  if (!Array.isArray(v) || !v.length || v.length > 500) throw new Error('results must be a list of 1 to 500 { metric, value, segment? }');
  return v.map((r: any, i) => {
    if (!r || typeof r.metric !== 'string' || !METRIC_RE.test(r.metric)) throw new Error(`results[${i}].metric is invalid`);
    const value = Number(r.value);
    if (r.value === null || r.value === '' || !Number.isFinite(value)) throw new Error(`results[${i}].value must be a number`);
    const seg = r.segment === undefined || r.segment === null || r.segment === '' ? null : String(r.segment);
    if (seg !== null && (seg === '*' || !METRIC_RE.test(seg))) throw new Error(`results[${i}].segment is invalid`);
    return { metric: r.metric, value, segment: seg };
  });
}

export interface Failure {
  metric: string;
  segment: string | null;
  reason: 'missing' | 'below' | 'above';
  value: number | null;
  threshold: number;
}

/** Every criterion must be met; a criterion without a matching result fails as missing. */
export function evaluateRun(criteria: Criterion[], results: MetricResult[]): { passed: boolean; failures: Failure[] } {
  const failures: Failure[] = [];
  const meets = (c: Criterion, v: number) => (c.operator === '>=' ? v >= c.threshold : v <= c.threshold);
  for (const c of criteria) {
    const matching = c.segment === '*' ? results.filter((r) => r.metric === c.metric && r.segment !== null) : results.filter((r) => r.metric === c.metric && r.segment === c.segment);
    if (!matching.length) {
      failures.push({ metric: c.metric, segment: c.segment, reason: 'missing', value: null, threshold: c.threshold });
      continue;
    }
    for (const r of matching) {
      if (!meets(c, r.value)) failures.push({ metric: c.metric, segment: r.segment, reason: c.operator === '>=' ? 'below' : 'above', value: r.value, threshold: c.threshold });
    }
  }
  return { passed: failures.length === 0, failures };
}

export function reviewDue(lastReviewedAt: Date | null, createdAt: Date, months: number): Date {
  const base = new Date((lastReviewedAt ?? createdAt).getTime());
  base.setUTCMonth(base.getUTCMonth() + months);
  return base;
}

/* ------------------------------------------------------------ retirement */

export const RETIREMENT_ITEMS = [
  { key: 'DATA_RETENTION', label: 'Data kept or deleted under each dataset’s retention rule' },
  { key: 'DEPENDANTS', label: 'Dependent systems, deployers and integrations handled' },
  { key: 'USER_NOTICE', label: 'Users and affected people told about the retirement' },
  { key: 'REPLACEMENT', label: 'Replacement in place, or the decision to have none recorded' },
  { key: 'ACCESS_REVOKED', label: 'Endpoints, credentials and access switched off' },
  { key: 'RECORDS_ARCHIVED', label: 'Model records, evidence and logs archived for their retention period' },
] as const;

export interface ChecklistItem {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  note: string | null;
  by: string | null;
  at: string | null;
}

export function newChecklist(detail: Partial<Record<string, string>>): ChecklistItem[] {
  return RETIREMENT_ITEMS.map((i) => ({ key: i.key, label: i.label, detail: detail[i.key] ?? '', done: false, note: null, by: null, at: null }));
}

export function checklistOpen(items: ChecklistItem[]): string[] {
  return items.filter((i) => !i.done).map((i) => i.key);
}
