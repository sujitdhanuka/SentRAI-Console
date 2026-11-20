/**
 * Model card v2: field values, statuses and provenance (spec §5, §6).
 *
 * Every value carries who or what produced it. AI_SUGGESTED and CODE_SCAN
 * text is held as a suggestion beside the value and does not count as
 * populated until a named person accepts or edits it. IMPORTED_V1 values are
 * visible but unaccepted. NOT_APPLICABLE needs a written justification and
 * the decider; VERIFIED needs evidence and a verifier other than the person
 * who entered or accepted the value.
 *
 * Pure: each operation returns the next state or throws FieldStateError.
 */
import { FieldDef, HUMAN_ONLY_FIELDS } from './catalogue';
import { validateValue } from './field-validate';

export const FIELD_STATUSES = ['NOT_ASSESSED', 'UNKNOWN', 'POPULATED', 'NOT_APPLICABLE', 'EVIDENCE_PENDING', 'VERIFIED'] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];
export const PROVENANCE = ['HUMAN_ENTERED', 'AI_SUGGESTED', 'CODE_SCAN', 'INTEGRATION', 'IMPORTED_V1'] as const;
export type Provenance = (typeof PROVENANCE)[number];

export interface EvidenceRef {
  ref: string;
  type: string;
  added_by: string;
  added_at: string;
}

export interface Suggestion {
  value: any;
  provenance: 'AI_SUGGESTED' | 'CODE_SCAN';
  source_ref: string | null;
  /** Preamble, disclaimer or speculative sentences removed by the clean-up. */
  removed: string[];
  created_at: string;
}

export interface FieldValue {
  field_id: string;
  value: any;
  status: FieldStatus;
  provenance: Provenance | null;
  source_ref: string | null;
  entered_by: string | null;
  entered_at: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  suggestion: Suggestion | null;
  na_justification: string | null;
  na_decided_by: string | null;
  evidence_refs: EvidenceRef[];
  verified_by: string | null;
  verified_at: string | null;
}

export class FieldStateError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export const emptyField = (field_id: string): FieldValue => ({
  field_id, value: null, status: 'NOT_ASSESSED', provenance: null, source_ref: null, entered_by: null, entered_at: null,
  accepted_by: null, accepted_at: null, suggestion: null, na_justification: null, na_decided_by: null, evidence_refs: [], verified_by: null, verified_at: null,
});

const isUnknown = (v: any) => v === 'UNKNOWN';
const valueStatus = (def: FieldDef, v: any, evidence: EvidenceRef[]): FieldStatus =>
  isUnknown(v) ? 'UNKNOWN' : def.evidence_required.required && evidence.length === 0 ? 'EVIDENCE_PENDING' : 'POPULATED';

/** A person enters or edits a value. Human entry is accepted by that person. */
export function enterValue(prev: FieldValue, def: FieldDef, value: any, actor: string, at: Date): FieldValue {
  const errors = validateValue(def, value);
  if (errors.length) throw new FieldStateError('INVALID_VALUE', errors.join('; '));
  const now = at.toISOString();
  return {
    ...prev, value, provenance: 'HUMAN_ENTERED', source_ref: null, entered_by: actor, entered_at: now, accepted_by: actor, accepted_at: now,
    suggestion: null, na_justification: null, na_decided_by: null, verified_by: null, verified_at: null,
    status: valueStatus(def, value, prev.evidence_refs),
  };
}

/** A system source (register integration or v1 import) writes a value. INTEGRATION is accepted; IMPORTED_V1 is not. */
export function systemValue(prev: FieldValue, def: FieldDef, value: any, provenance: 'INTEGRATION' | 'IMPORTED_V1', source_ref: string, at: Date): FieldValue {
  const now = at.toISOString();
  return {
    ...prev, value, provenance, source_ref, entered_by: provenance === 'INTEGRATION' ? 'system' : 'v1-migration', entered_at: now,
    accepted_by: provenance === 'INTEGRATION' ? 'system' : null, accepted_at: provenance === 'INTEGRATION' ? now : null,
    verified_by: null, verified_at: null,
    status: value === null || value === undefined ? 'NOT_ASSESSED' : valueStatus(def, value, prev.evidence_refs),
  };
}

/** Store an AI or code-scan suggestion beside the value. Never on human-only fields. */
export function suggest(prev: FieldValue, def: FieldDef, s: Omit<Suggestion, 'created_at'>, at: Date): FieldValue {
  if (HUMAN_ONLY_FIELDS.has(def.field_id)) throw new FieldStateError('HUMAN_ONLY', `${def.label} is set by a person; it cannot be suggested.`);
  if (s.provenance === 'AI_SUGGESTED' && !def.ai_suggestable) throw new FieldStateError('NOT_SUGGESTABLE', `${def.label} is not drafted by AI.`);
  return { ...prev, suggestion: { ...s, created_at: at.toISOString() } };
}

/** A person accepts the pending suggestion, unchanged or edited. Edited text becomes HUMAN_ENTERED. */
export function acceptSuggestion(prev: FieldValue, def: FieldDef, actor: string, at: Date, edited?: any): FieldValue {
  if (!prev.suggestion) throw new FieldStateError('NO_SUGGESTION', 'There is no suggestion to accept.');
  if (edited !== undefined) return enterValue(prev, def, edited, actor, at);
  const s = prev.suggestion;
  const errors = validateValue(def, s.value);
  if (errors.length) throw new FieldStateError('INVALID_VALUE', errors.join('; '));
  const now = at.toISOString();
  return {
    ...prev, value: s.value, provenance: s.provenance, source_ref: s.source_ref, entered_by: s.provenance === 'AI_SUGGESTED' ? 'ai' : 'code-scan', entered_at: s.created_at,
    accepted_by: actor, accepted_at: now, suggestion: null, verified_by: null, verified_at: null, status: valueStatus(def, s.value, prev.evidence_refs),
  };
}

/** A person accepts an imported (IMPORTED_V1) or scanned (CODE_SCAN) value as it stands. */
export function acceptImported(prev: FieldValue, def: FieldDef, actor: string, at: Date): FieldValue {
  if ((prev.provenance !== 'IMPORTED_V1' && prev.provenance !== 'CODE_SCAN') || prev.accepted_by) {
    throw new FieldStateError('NOTHING_TO_ACCEPT', 'Only an unaccepted imported or scanned value can be accepted.');
  }
  // A human-only field drafted by AI in v1 (for example the risk rationale) must be rewritten, not accepted.
  if (HUMAN_ONLY_FIELDS.has(def.field_id) && /\((ai|heuristic|unknown)\)/.test(prev.source_ref ?? '')) {
    throw new FieldStateError('HUMAN_ONLY', `${def.label} was drafted by AI in v1 and must be written by a person.`);
  }
  const errors = validateValue(def, prev.value);
  if (errors.length) throw new FieldStateError('INVALID_VALUE', `The imported value does not fit the v2 field: ${errors.join('; ')}. Enter it again.`);
  return { ...prev, accepted_by: actor, accepted_at: at.toISOString() };
}

/** The value is not known yet. Allowed in a draft; blocks FINAL on mandatory fields. */
export function markUnknown(prev: FieldValue, actor: string, at: Date): FieldValue {
  const now = at.toISOString();
  return { ...prev, value: 'UNKNOWN', status: 'UNKNOWN', provenance: 'HUMAN_ENTERED', entered_by: actor, entered_at: now, accepted_by: actor, accepted_at: now, verified_by: null, verified_at: null };
}

/** Not applicable, with a written justification and the name of the person who decided. */
export function markNotApplicable(prev: FieldValue, actor: string, justification: string, at: Date): FieldValue {
  const why = String(justification ?? '').trim();
  if (why.length < 10) throw new FieldStateError('NA_JUSTIFICATION', 'Not applicable needs a written justification (at least 10 characters).');
  const now = at.toISOString();
  return {
    ...prev, value: null, status: 'NOT_APPLICABLE', provenance: 'HUMAN_ENTERED', entered_by: actor, entered_at: now, accepted_by: actor, accepted_at: now,
    na_justification: why.slice(0, 2000), na_decided_by: actor, verified_by: null, verified_at: null,
  };
}

/** Attach evidence. An EVIDENCE_PENDING value with evidence becomes POPULATED. */
export function attachEvidence(prev: FieldValue, ev: Omit<EvidenceRef, 'added_at'>, at: Date): FieldValue {
  if (!ev.ref?.trim()) throw new FieldStateError('EVIDENCE_REF', 'Evidence needs a reference.');
  const evidence_refs = [...prev.evidence_refs, { ...ev, added_at: at.toISOString() }];
  return { ...prev, evidence_refs, status: prev.status === 'EVIDENCE_PENDING' ? 'POPULATED' : prev.status };
}

/** Verify: needs an accepted value, attached evidence and a verifier who did not enter or accept it. */
export function verify(prev: FieldValue, verifier: string, at: Date): FieldValue {
  if (!isPopulated(prev)) throw new FieldStateError('NOT_POPULATED', 'Only an accepted, populated value can be verified.');
  if (prev.evidence_refs.length === 0) throw new FieldStateError('NO_EVIDENCE', 'Verification needs attached evidence.');
  if (verifier === prev.entered_by || verifier === prev.accepted_by) {
    throw new FieldStateError('SAME_PERSON', 'The verifier must be a different person from the one who entered or accepted the value.');
  }
  return { ...prev, status: 'VERIFIED', verified_by: verifier, verified_at: at.toISOString() };
}

/** Counts as populated for the documentation score: a real value, accepted by a person or an integration. */
export function isPopulated(v: FieldValue | null | undefined): boolean {
  if (!v || !v.accepted_by) return false;
  return v.status === 'POPULATED' || v.status === 'EVIDENCE_PENDING' || v.status === 'VERIFIED';
}

/** A suggestion or imported value waiting for a person. */
export const awaitingAcceptance = (v: FieldValue | null | undefined): boolean =>
  Boolean(v && (v.suggestion || ((v.provenance === 'IMPORTED_V1' || v.provenance === 'CODE_SCAN') && !v.accepted_by && v.value !== null)));
