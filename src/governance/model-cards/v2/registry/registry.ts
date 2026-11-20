/**
 * Model card v2: the framework registry (spec §2, §8). Pure functions over
 * registry entries: normalising the seed, checking it, and deciding which
 * frameworks and controls apply to a record and whether they are in force.
 *
 * No framework applies by default: a law applies when its rule fires
 * (jurisdiction, role, use) and a standard or guidance applies only where the
 * organisation adopted it. "Applies, not yet in force" is its own answer.
 */
import { FIELDS } from '../catalogue';
import { evaluateRule, Facts, RuleOutcome, RuleResult } from '../applicability/engine';
import { RULE_IDS } from '../applicability/rules';
import { RECORD_TYPES } from '../record-types';
import seed from './registry-seed.json';
import {
  Applies, ControlDef, FRAMEWORK_TYPES, FrameworkDef, FrameworkType, InForce, isBinding, itemNoun, PhaseDef, VERIFICATION_STATUSES,
} from './types';

export const SEED_VERSION: string = seed.seed_version;
const UNVERIFIED = 'UNVERIFIED_REQUIRES_LEGAL_REVIEW' as const;

/** Fill the defaults a seed or edit may leave out. */
export function normaliseFramework(raw: any, revision = 1): FrameworkDef {
  const controls: ControlDef[] = (raw.controls ?? []).map((c: any) => ({
    control_id: c.control_id,
    title: c.title,
    record_types: c.record_types ?? null,
    applicability_rule_id: c.applicability_rule_id ?? null,
    roles: c.roles ?? null,
    phase_ids: c.phase_ids ?? [],
    evidence_type: c.evidence_type ?? null,
    assessment_method: c.assessment_method ?? (raw.type === 'LAW' || raw.type === 'REGULATION' ? 'LEGAL_REVIEW' : 'EVIDENCE_REVIEW'),
    control_owner_role: c.control_owner_role ?? null,
    verification_status: c.verification_status ?? UNVERIFIED,
    pack_clause_refs: c.pack_clause_refs ?? [],
  }));
  return {
    framework_id: raw.framework_id,
    revision: raw.revision ?? revision,
    type: raw.type,
    title: raw.title,
    short_title: raw.short_title ?? raw.title,
    jurisdiction: raw.jurisdiction ?? null,
    issuer: raw.issuer ?? '',
    requires_adoption: raw.requires_adoption ?? !(raw.type === 'LAW' || raw.type === 'REGULATION'),
    applicability_rule_id: raw.applicability_rule_id ?? null,
    pack_id: raw.pack_id ?? null,
    effective_from: raw.effective_from ?? null,
    effective_note: raw.effective_note ?? null,
    phases: (raw.phases ?? []).map((p: any): PhaseDef => ({
      phase_id: p.phase_id, title: p.title, effective_from: p.effective_from ?? null, applicability_rule_id: p.applicability_rule_id ?? null, note: p.note ?? null,
    })),
    organisational_only: Boolean(raw.organisational_only),
    verification_status: raw.verification_status ?? UNVERIFIED,
    notes: raw.notes ?? null,
    controls,
  };
}

/** The shipped seed, revision 1 of every entry. */
export const SEED_FRAMEWORKS: readonly FrameworkDef[] = seed.frameworks.map((f) => normaliseFramework(f, 1));

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with a set of registry entries; empty when they are usable. */
export function validateFrameworks(defs: readonly FrameworkDef[]): string[] {
  const p: string[] = [];
  const ids = new Set<string>();
  for (const f of defs) {
    const at = f.framework_id || '(no id)';
    if (!/^[a-z0-9][a-z0-9.-]{1,60}$/.test(f.framework_id ?? '')) p.push(`${at}: framework_id must be lower-case letters, digits, dots and dashes`);
    if (ids.has(f.framework_id)) p.push(`${at}: duplicate framework_id`);
    ids.add(f.framework_id);
    if (!(FRAMEWORK_TYPES as readonly string[]).includes(f.type)) p.push(`${at}: type must be one of ${FRAMEWORK_TYPES.join(', ')}`);
    if (!f.title?.trim()) p.push(`${at}: title is required`);
    if (!(VERIFICATION_STATUSES as readonly string[]).includes(f.verification_status)) p.push(`${at}: unknown verification status`);
    if (f.applicability_rule_id && !RULE_IDS.has(f.applicability_rule_id)) p.push(`${at}: unknown rule ${f.applicability_rule_id}`);
    if (!f.requires_adoption && !f.applicability_rule_id) p.push(`${at}: a framework that needs no adoption must name the rule that makes it apply`);
    if (f.effective_from && !DATE.test(f.effective_from)) p.push(`${at}: effective_from must be YYYY-MM-DD`);
    const phases = new Set<string>();
    for (const ph of f.phases) {
      if (phases.has(ph.phase_id)) p.push(`${at}: duplicate phase ${ph.phase_id}`);
      phases.add(ph.phase_id);
      if (ph.effective_from && !DATE.test(ph.effective_from)) p.push(`${at}/${ph.phase_id}: effective_from must be YYYY-MM-DD`);
      if (ph.applicability_rule_id && !RULE_IDS.has(ph.applicability_rule_id)) p.push(`${at}/${ph.phase_id}: unknown rule ${ph.applicability_rule_id}`);
    }
    const cids = new Set<string>();
    for (const c of f.controls) {
      const cat = `${at}:${c.control_id}`;
      if (!c.control_id || cids.has(c.control_id)) p.push(`${cat}: missing or duplicate control_id`);
      cids.add(c.control_id);
      if (!c.title?.trim()) p.push(`${cat}: title is required`);
      if (c.title && c.title.length > 160) p.push(`${cat}: title must be a one-line paraphrase (160 characters at most)`);
      if (c.applicability_rule_id && !RULE_IDS.has(c.applicability_rule_id)) p.push(`${cat}: unknown rule ${c.applicability_rule_id}`);
      for (const ph of c.phase_ids) if (!phases.has(ph)) p.push(`${cat}: unknown phase ${ph}`);
      for (const t of c.record_types ?? []) if (!(RECORD_TYPES as readonly string[]).includes(t)) p.push(`${cat}: unknown record type ${t}`);
      if (!(VERIFICATION_STATUSES as readonly string[]).includes(c.verification_status)) p.push(`${cat}: unknown verification status`);
    }
  }
  return p;
}

/** Catalogue fields that reference a control (framework_control_refs), so a control's fields are never listed twice. */
export function linkedFieldIds(frameworkId: string, controlId: string): string[] {
  const ref = `${frameworkId}:${controlId}`;
  return FIELDS.filter((f) => f.framework_control_refs.includes(ref)).map((f) => f.field_id);
}

const combine = (a: RuleResult, b: RuleResult): RuleResult => (a === 'NOT_FIRED' || b === 'NOT_FIRED' ? 'NOT_FIRED' : a === 'UNDETERMINED' || b === 'UNDETERMINED' ? 'UNDETERMINED' : 'FIRED');
const toApplies = (r: RuleResult): Applies => (r === 'FIRED' ? 'APPLIES' : r === 'NOT_FIRED' ? 'DOES_NOT_APPLY' : 'UNDETERMINED');

function inForceOn(date: string | null, at: Date): InForce {
  if (!date) return 'DATE_UNKNOWN';
  return new Date(`${date}T00:00:00Z`).getTime() <= at.getTime() ? 'IN_FORCE' : 'NOT_YET_IN_FORCE';
}

export interface ControlApplicability {
  control_id: string;
  title: string;
  applies: Applies;
  reasons: string[];
  /** The date that governs it for this record, and the phase it comes from. */
  effective_from: string | null;
  phase_id: string | null;
  in_force: InForce;
  linked_field_ids: string[];
  evidence_type: string | null;
  assessment_method: string;
  verification_status: string;
}

export interface FrameworkApplicability {
  framework_id: string;
  revision: number;
  type: FrameworkType;
  binding: boolean;
  /** "obligation" for law and regulation, otherwise "control" or "practice". */
  noun: string;
  title: string;
  short_title: string;
  applies: Applies;
  reasons: string[];
  in_force: InForce;
  effective_from: string | null;
  effective_note: string | null;
  organisational_only: boolean;
  verification_status: string;
  controls: ControlApplicability[];
}

export interface RegistryContext {
  recordType: string | null;
  facts: Facts;
  /** Framework ids the organisation adopted (standards and guidance). */
  adopted: ReadonlySet<string>;
  at: Date;
}

/** Which frameworks and controls apply to one record, and whether each is in force on `at`. */
export function frameworkApplicability(defs: readonly FrameworkDef[], ctx: RegistryContext): FrameworkApplicability[] {
  const memo = new Map<string, RuleOutcome>();
  const rule = (id: string | null | undefined): { result: RuleResult; why: string } =>
    id ? (({ result, why, missing }) => ({ result, why: result === 'UNDETERMINED' ? `${why} Not yet known: ${missing.join(', ')}.` : why }))(evaluateRule(id, ctx.facts, memo))
      : { result: 'FIRED', why: '' };
  const roles: string[] = Array.isArray(ctx.facts.eu_role) ? (ctx.facts.eu_role as string[]) : [];

  return defs.map((f) => {
    const reasons: string[] = [];
    let result: RuleResult = 'FIRED';
    if (f.requires_adoption) {
      const adopted = ctx.adopted.has(f.framework_id);
      reasons.push(adopted ? 'The organisation adopted it.' : 'The organisation has not adopted it.');
      if (!adopted) result = 'NOT_FIRED';
    }
    if (f.applicability_rule_id) {
      const r = rule(f.applicability_rule_id);
      result = combine(result, r.result);
      reasons.push(`${f.applicability_rule_id} ${r.result === 'FIRED' ? 'fired' : r.result === 'NOT_FIRED' ? 'did not fire' : 'is undetermined'}: ${r.why}`);
    }
    const fwApplies = toApplies(result);
    const fwInForce = inForceOn(f.effective_from, ctx.at);

    const controls = f.controls.map((c): ControlApplicability => {
      const cr: string[] = [];
      let res: RuleResult = result;
      if (c.record_types && ctx.recordType && !c.record_types.includes(ctx.recordType)) {
        res = 'NOT_FIRED';
        cr.push(`Not for ${ctx.recordType} records.`);
      }
      if (c.applicability_rule_id) {
        const r = rule(c.applicability_rule_id);
        res = combine(res, r.result);
        cr.push(`${c.applicability_rule_id}: ${r.result}.`);
      }
      if (c.roles && f.framework_id.startsWith('eu-ai-act')) {
        if (!roles.length) { res = combine(res, 'UNDETERMINED'); cr.push('EU AI Act role not recorded.'); }
        else if (!c.roles.some((x) => roles.includes(x))) { res = 'NOT_FIRED'; cr.push(`Binds ${c.roles.join(' or ')} only.`); }
      }
      // The governing date: the earliest of its phases whose rule fires; an undetermined phase leaves the date unknown.
      let effective = f.effective_from;
      let phaseId: string | null = null;
      if (c.phase_ids.length) {
        const phases = f.phases.filter((p) => c.phase_ids.includes(p.phase_id));
        const live = phases.filter((p) => rule(p.applicability_rule_id).result === 'FIRED');
        const open = phases.filter((p) => rule(p.applicability_rule_id).result === 'UNDETERMINED');
        // Phases that fire govern; if none fires but some are undetermined, the date is not known yet.
        const pool = live.length ? live : open.length ? [] : phases;
        const pick = [...pool].sort((a, b) => String(a.effective_from ?? '9999').localeCompare(String(b.effective_from ?? '9999')))[0];
        effective = pick?.effective_from ?? null;
        phaseId = pick?.phase_id ?? null;
      }
      return {
        control_id: c.control_id, title: c.title, applies: toApplies(res), reasons: cr, effective_from: effective, phase_id: phaseId,
        in_force: inForceOn(effective, ctx.at), linked_field_ids: linkedFieldIds(f.framework_id, c.control_id), evidence_type: c.evidence_type,
        assessment_method: c.assessment_method, verification_status: c.verification_status,
      };
    });

    return {
      framework_id: f.framework_id, revision: f.revision, type: f.type, binding: isBinding(f.type), noun: itemNoun(f.type), title: f.title, short_title: f.short_title,
      applies: fwApplies, reasons, in_force: fwInForce, effective_from: f.effective_from, effective_note: f.effective_note,
      organisational_only: f.organisational_only, verification_status: f.verification_status, controls,
    };
  });
}

/** The one-line status a UI or PDF shows for a framework that applies. Never says compliant or certified. */
export function applicabilityLabel(a: { applies: Applies; in_force: InForce; organisational_only?: boolean }): string {
  if (a.applies === 'DOES_NOT_APPLY') return 'Does not apply';
  if (a.applies === 'UNDETERMINED') return 'Applicability not yet determined';
  const base = a.in_force === 'NOT_YET_IN_FORCE' ? 'Applies, not yet in force' : a.in_force === 'DATE_UNKNOWN' ? 'Applies, date to be confirmed' : 'Applies';
  return a.organisational_only ? `${base} (organisational standard: this card holds supporting evidence only)` : base;
}

/** Registry ids adopted through the shipped packs an organisation has on (NIST and ISO are the pack baseline). */
export function adoptedFromPacks(defs: readonly FrameworkDef[], packIds: readonly string[] | null | undefined): string[] {
  return defs.filter((f) => f.requires_adoption && f.pack_id && (packIds == null || packIds.includes(f.pack_id))).map((f) => f.framework_id);
}
