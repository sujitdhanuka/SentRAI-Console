/**
 * Model card v2: the applicability engine (spec §6). Three-valued: a rule is
 * FIRED, NOT_FIRED or UNDETERMINED (a fact it reads has not been assessed or
 * is UNKNOWN). Field and section applicability are computed here and only
 * here; the UI receives the result and the text of the rule that fired.
 */
import { FieldDef, Requirement, SECTIONS } from '../catalogue';
import { RecordType } from '../record-types';
import { Cond, RULES, ruleDef } from './rules';

export type Facts = Record<string, unknown>;
export type RuleResult = 'FIRED' | 'NOT_FIRED' | 'UNDETERMINED';

export interface RuleOutcome {
  id: string;
  title: string;
  why: string;
  result: RuleResult;
  /** Facts that were not assessed, when the result is UNDETERMINED. */
  missing: string[];
}

export type EffectiveRequirement = 'MANDATORY' | 'RECOMMENDED' | 'NOT_REQUIRED';

export interface FieldApplicability {
  field_id: string;
  section_id: string;
  applicable: boolean;
  /** Why the field is not applicable (record type, or the section's rule did not fire). */
  not_applicable_reason: string | null;
  default_requirement: Requirement;
  effective: EffectiveRequirement;
  /** The rule that made a CONDITIONAL field mandatory, or would once its facts are assessed. */
  rule: { id: string; result: RuleResult; why: string } | null;
}

export interface SectionApplicability {
  section_id: string;
  applicable: boolean;
  reason: string | null;
}

const unknown = (v: unknown) => v === null || v === undefined || v === 'UNKNOWN' || (Array.isArray(v) && v.length === 0);

function evalCond(c: Cond, facts: Facts, memo: Map<string, RuleOutcome>, missing: Set<string>): RuleResult {
  if ('all' in c || 'any' in c) {
    const parts = ('all' in c ? c.all : c.any).map((x) => evalCond(x, facts, memo, missing));
    const decisive = 'all' in c ? 'NOT_FIRED' : 'FIRED';
    if (parts.includes(decisive)) return decisive;
    return parts.includes('UNDETERMINED') ? 'UNDETERMINED' : 'all' in c ? 'FIRED' : 'NOT_FIRED';
  }
  if ('rule' in c) {
    const o = evaluateRule(c.rule, facts, memo);
    o.missing.forEach((m) => missing.add(m));
    return o.result;
  }
  const v = facts[c.fact];
  if (unknown(v)) {
    missing.add(c.fact);
    return 'UNDETERMINED';
  }
  let hit: boolean;
  if ('in' in c) hit = c.in.includes(String(v));
  else if ('includes_any' in c) hit = (Array.isArray(v) ? v : [v]).some((x) => c.includes_any.includes(String(x)));
  else if ('gt' in c) hit = typeof v === 'number' && v > c.gt;
  else hit = v === c.eq;
  return hit ? 'FIRED' : 'NOT_FIRED';
}

export function evaluateRule(id: string, facts: Facts, memo = new Map<string, RuleOutcome>()): RuleOutcome {
  const cached = memo.get(id);
  if (cached) return cached;
  const def = ruleDef(id);
  if (!def) throw new Error(`Unknown applicability rule ${id}`);
  const missing = new Set<string>();
  const result = evalCond(def.when, facts, memo, missing);
  const out = { id, title: def.title, why: def.why, result, missing: result === 'UNDETERMINED' ? [...missing] : [] };
  memo.set(id, out);
  return out;
}

export interface ApplicabilityResult {
  rules: RuleOutcome[];
  sections: SectionApplicability[];
  fields: FieldApplicability[];
}

/** Every rule, section and field for this record type and these facts. */
export function evaluateApplicability(recordType: RecordType | null, facts: Facts): ApplicabilityResult {
  const memo = new Map<string, RuleOutcome>();
  const rules = RULES.map((x) => evaluateRule(x.id, facts, memo));
  const sections: SectionApplicability[] = [];
  const fields: FieldApplicability[] = [];
  for (const s of SECTIONS) {
    const sr = s.applicability_rule_id ? evaluateRule(s.applicability_rule_id, facts, memo) : null;
    const sectionApplies = !sr || sr.result !== 'NOT_FIRED';
    sections.push({ section_id: s.section_id, applicable: sectionApplies, reason: sr ? (sr.result === 'NOT_FIRED' ? `Not applicable: ${sr.title} does not apply.` : sr.why) : null });
    for (const f of s.fields) fields.push(fieldOutcome(f, recordType, sectionApplies, sr, facts, memo));
  }
  return { rules, sections, fields };
}

function fieldOutcome(f: FieldDef, recordType: RecordType | null, sectionApplies: boolean, sr: RuleOutcome | null, facts: Facts, memo: Map<string, RuleOutcome>): FieldApplicability {
  const base = { field_id: f.field_id, section_id: f.section_id, default_requirement: f.default_requirement };
  // An unclassified record sees every field, so nothing is hidden before the type is known.
  if (recordType && !f.applies_to_record_types.includes(recordType)) {
    return { ...base, applicable: false, not_applicable_reason: `Does not apply to ${recordType} records.`, effective: 'NOT_REQUIRED', rule: null };
  }
  if (!sectionApplies) return { ...base, applicable: false, not_applicable_reason: sr!.title + ' does not apply.', effective: 'NOT_REQUIRED', rule: null };
  // A section that is only possibly applicable asks for nothing until its rule is determined.
  if (sr?.result === 'UNDETERMINED') return { ...base, applicable: true, not_applicable_reason: null, effective: 'RECOMMENDED', rule: { id: sr.id, result: sr.result, why: sr.why } };
  if (f.default_requirement !== 'CONDITIONAL') {
    return { ...base, applicable: true, not_applicable_reason: null, effective: f.default_requirement, rule: null };
  }
  const o = evaluateRule(f.applicability_rule_id!, facts, memo);
  const rule = { id: o.id, result: o.result, why: o.why };
  if (o.result === 'FIRED') return { ...base, applicable: true, not_applicable_reason: null, effective: 'MANDATORY', rule };
  if (o.result === 'UNDETERMINED') return { ...base, applicable: true, not_applicable_reason: null, effective: 'RECOMMENDED', rule };
  return { ...base, applicable: false, not_applicable_reason: `${o.title} does not apply.`, effective: 'NOT_REQUIRED', rule };
}
