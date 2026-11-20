/**
 * Model card v2: the four scores (spec §9). Each is a numerator over a
 * denominator with a plain explanation, and they are never merged into one
 * number. None of them is a compliance verdict.
 */
import { fieldDef } from './catalogue';
import { FieldApplicability } from './applicability/engine';
import { ControlView, CONTROL_RANK } from './controls';
import { FieldValue, isPopulated } from './field-state';
import { FrameworkApplicability } from './registry/registry';

export interface Score {
  id: 'documentation' | 'evidence' | 'control_effectiveness' | 'regulatory';
  title: string;
  numerator: number;
  denominator: number;
  /** Whole percent, or null when there is nothing to count. */
  percent: number | null;
  how: string;
  /** Items behind the numbers, so the UI can list what is missing. */
  detail: Record<string, unknown>;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);

/** A justified N/A satisfies a requirement; UNKNOWN does not. */
export const satisfied = (v: FieldValue | undefined) => isPopulated(v) || (v?.status === 'NOT_APPLICABLE' && Boolean(v.na_justification && v.na_decided_by));

/** A. Documentation: required (mandatory or triggered conditional) fields populated and accepted by a person. */
export function documentationScore(fields: FieldApplicability[], values: Record<string, FieldValue | undefined>): Score {
  const required = fields.filter((f) => f.applicable && f.effective === 'MANDATORY');
  const recommended = fields.filter((f) => f.applicable && f.effective === 'RECOMMENDED');
  const done = required.filter((f) => satisfied(values[f.field_id]));
  return {
    id: 'documentation',
    title: 'Documentation',
    numerator: done.length,
    denominator: required.length,
    percent: pct(done.length, required.length),
    how: 'Mandatory fields plus conditional fields whose rule fired, counted when a person entered or accepted the value (or recorded a justified N/A). AI suggestions and imported values count only once accepted. Recommended fields are counted separately and never block.',
    detail: {
      missing: required.filter((f) => !satisfied(values[f.field_id])).map((f) => f.field_id),
      recommended: { numerator: recommended.filter((f) => satisfied(values[f.field_id])).length, denominator: recommended.length },
    },
  };
}

/** Days an evidence type stays current: case-insensitive lookup, then DEFAULT. */
export function freshnessDays(type: string, windows: Record<string, number>): number {
  const k = Object.keys(windows).find((x) => x.toLowerCase() === type.toLowerCase());
  return windows[k ?? 'DEFAULT'] ?? windows.DEFAULT ?? 365;
}

/** B. Evidence: required evidence attached, current (not past its freshness window) and verified by a second person. */
export function evidenceScore(fields: FieldApplicability[], values: Record<string, FieldValue | undefined>, windows: Record<string, number>, at: Date): Score {
  const needed = fields.filter((f) => f.applicable && f.effective !== 'NOT_REQUIRED' && fieldDef(f.field_id)?.evidence_required.required);
  const missing: string[] = [];
  const expired: string[] = [];
  const unverified: string[] = [];
  let ok = 0;
  for (const f of needed) {
    const v = values[f.field_id];
    const type = fieldDef(f.field_id)!.evidence_required.type ?? 'DEFAULT';
    const refs = v?.evidence_refs ?? [];
    if (!refs.length) { missing.push(f.field_id); continue; }
    const newest = Math.max(...refs.map((r) => new Date(r.added_at).getTime()));
    if (at.getTime() - newest > freshnessDays(type, windows) * 86_400_000) { expired.push(f.field_id); continue; }
    if (v?.status !== 'VERIFIED') { unverified.push(f.field_id); continue; }
    ok += 1;
  }
  return {
    id: 'evidence',
    title: 'Evidence',
    numerator: ok,
    denominator: needed.length,
    percent: pct(ok, needed.length),
    how: 'Fields that require evidence, counted when evidence is attached, the newest item is within the freshness window for its type, and a person other than the one who entered the value verified it.',
    detail: { missing, expired, unverified },
  };
}

/** C. Control effectiveness: controls that apply, counted when their effectiveness was tested; open remediation listed. */
export function controlScore(frameworks: Array<{ fw: FrameworkApplicability; controls: ControlView[] }>): Score {
  const all = frameworks.filter((x) => x.fw.applies === 'APPLIES').flatMap((x) => x.controls.filter((c) => c.applies === 'APPLIES' && c.status !== 'NOT_APPLICABLE').map((c) => ({ fw: x.fw.framework_id, c })));
  const at = (s: keyof typeof CONTROL_RANK) => all.filter((x) => CONTROL_RANK[x.c.status] >= CONTROL_RANK[s]).length;
  const tested = at('EFFECTIVENESS_TESTED');
  return {
    id: 'control_effectiveness',
    title: 'Control effectiveness',
    numerator: tested,
    denominator: all.length,
    percent: pct(tested, all.length),
    how: 'Controls and obligations that apply to this record, counted when a person recorded an effectiveness test after the evidence was verified. Filling in linked fields does not move a control past APPLICABLE.',
    detail: {
      implemented: at('IMPLEMENTED'),
      evidence_verified: at('EVIDENCE_VERIFIED'),
      effectiveness_tested: tested,
      open_remediation: all.filter((x) => x.c.status === 'GAP_IDENTIFIED' || x.c.status === 'PARTIALLY_IMPLEMENTED').map((x) => `${x.fw}:${x.c.control_id}`),
    },
  };
}

/**
 * D. Regulatory assessment: jurisdictions confirmed, in-force obligations
 * identified and assessed, legal review recorded. Obligations not yet in
 * force are listed but not counted as gaps.
 */
export function regulatoryScore(
  frameworks: Array<{ fw: FrameworkApplicability; controls: ControlView[] }>,
  values: Record<string, FieldValue | undefined>,
): Score {
  const binding = frameworks.filter((x) => x.fw.binding && x.fw.applies === 'APPLIES');
  const obligations = binding.flatMap((x) => x.controls.filter((c) => c.applies === 'APPLIES').map((c) => ({ fw: x.fw.framework_id, c })));
  const inForce = obligations.filter((o) => o.c.in_force === 'IN_FORCE');
  const assessed = inForce.filter((o) => o.c.assessment && o.c.status !== 'NOT_ASSESSED' && o.c.status !== 'APPLICABLE');
  const jurisdictions = isPopulated(values.jurisdictions);
  const legal = isPopulated(values.legal_review_date);
  const numerator = (jurisdictions ? 1 : 0) + (legal ? 1 : 0) + assessed.length;
  const denominator = 2 + inForce.length;
  return {
    id: 'regulatory',
    title: 'Regulatory assessment',
    numerator,
    denominator,
    percent: pct(numerator, denominator),
    how: 'One point for confirmed jurisdictions, one for a recorded legal review, and one for each obligation in force that a person has assessed. Obligations not yet in force, or whose date is still to be confirmed, are shown but not counted.',
    detail: {
      jurisdictions_confirmed: jurisdictions,
      legal_review_recorded: legal,
      obligations_in_force: inForce.length,
      obligations_assessed: assessed.length,
      gaps_outstanding: inForce.filter((o) => o.c.status === 'GAP_IDENTIFIED' || o.c.status === 'PARTIALLY_IMPLEMENTED').map((o) => `${o.fw}:${o.c.control_id}`),
      not_yet_in_force: obligations.filter((o) => o.c.in_force === 'NOT_YET_IN_FORCE').map((o) => ({ ref: `${o.fw}:${o.c.control_id}`, effective_from: o.c.effective_from })),
      date_to_confirm: obligations.filter((o) => o.c.in_force === 'DATE_UNKNOWN').map((o) => `${o.fw}:${o.c.control_id}`),
    },
  };
}
