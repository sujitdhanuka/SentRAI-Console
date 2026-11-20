/**
 * Model card v2: control assessments (spec §8). A control's status on a
 * record moves only when a named person acts, with evidence where the status
 * claims something was done. Filling in the catalogue fields linked to a
 * control never moves it past APPLICABLE. Nothing here says "compliant" or
 * "certified": a mapping is not compliance.
 */
import type { ControlApplicability, FrameworkApplicability } from './registry/registry';
import { EvidenceRef } from './field-state';

export const CONTROL_STATUSES = [
  'NOT_ASSESSED', 'APPLICABLE', 'NOT_APPLICABLE', 'GAP_IDENTIFIED', 'PARTIALLY_IMPLEMENTED', 'IMPLEMENTED', 'EVIDENCE_VERIFIED', 'EFFECTIVENESS_TESTED',
] as const;
export type ControlStatus = (typeof CONTROL_STATUSES)[number];

/** Statuses that claim work was done, so they need evidence. */
const NEEDS_EVIDENCE: ReadonlySet<ControlStatus> = new Set(['PARTIALLY_IMPLEMENTED', 'IMPLEMENTED', 'EVIDENCE_VERIFIED', 'EFFECTIVENESS_TESTED']);
/** Order used for "at least implemented" checks (risk engine, scores). */
export const CONTROL_RANK: Record<ControlStatus, number> = {
  NOT_ASSESSED: 0, APPLICABLE: 1, NOT_APPLICABLE: 1, GAP_IDENTIFIED: 2, PARTIALLY_IMPLEMENTED: 3, IMPLEMENTED: 4, EVIDENCE_VERIFIED: 5, EFFECTIVENESS_TESTED: 6,
};

export interface ControlAssessment {
  framework_id: string;
  /** The registry revision this assessment was made against (pinned). */
  framework_revision: number;
  control_id: string;
  status: ControlStatus;
  justification: string | null;
  evidence_refs: EvidenceRef[];
  assessed_by: string | null;
  assessed_at: string | null;
  /** Who moved it to IMPLEMENTED (or PARTIALLY_IMPLEMENTED), so verification can be by someone else. */
  implemented_by: string | null;
  verified_by: string | null;
  /** The v1 card's verdict for the framework, kept as history when the v1 migration reset it. */
  migrated_from_v1_verdict: string | null;
}

export class ControlStateError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface ControlChange {
  status: string;
  justification?: string | null;
  evidence_refs?: EvidenceRef[];
}

/**
 * Apply a person's change to a control assessment. Rules:
 * - the actor is a named person (not the system or an AI);
 * - NOT_APPLICABLE and GAP_IDENTIFIED need a written justification;
 * - PARTIALLY_IMPLEMENTED and above need at least one evidence reference;
 * - EVIDENCE_VERIFIED needs a verifier other than the person who recorded the implementation;
 * - EFFECTIVENESS_TESTED needs the evidence to have been verified first, and a test result among the evidence.
 */
export function changeControl(
  prev: ControlAssessment | null,
  key: { framework_id: string; framework_revision: number; control_id: string },
  change: ControlChange,
  actor: string,
  at: Date,
): ControlAssessment {
  if (!actor || /^(system|ai)[:@]/i.test(actor)) throw new ControlStateError('HUMAN_REQUIRED', 'Only a named person can change a control status');
  const status = change.status as ControlStatus;
  if (!(CONTROL_STATUSES as readonly string[]).includes(status)) throw new ControlStateError('BAD_STATUS', `Status must be one of ${CONTROL_STATUSES.join(', ')}`);
  const justification = change.justification?.trim() || null;
  const evidence = change.evidence_refs ?? prev?.evidence_refs ?? [];
  if ((status === 'NOT_APPLICABLE' || status === 'GAP_IDENTIFIED') && (!justification || justification.length < 10)) {
    throw new ControlStateError('JUSTIFICATION_REQUIRED', status === 'NOT_APPLICABLE' ? 'Say why the control does not apply (10 characters or more)' : 'Describe the gap (10 characters or more)');
  }
  if (NEEDS_EVIDENCE.has(status) && !evidence.length) throw new ControlStateError('EVIDENCE_REQUIRED', `${status} needs at least one evidence reference`);

  let implementedBy = prev?.implemented_by ?? null;
  let verifiedBy = prev?.verified_by ?? null;
  if (status === 'PARTIALLY_IMPLEMENTED' || status === 'IMPLEMENTED') {
    implementedBy = actor;
    verifiedBy = null;
  }
  if (status === 'EVIDENCE_VERIFIED') {
    if (!prev || CONTROL_RANK[prev.status] < CONTROL_RANK.IMPLEMENTED) throw new ControlStateError('NOT_IMPLEMENTED', 'Record the control as implemented before verifying its evidence');
    if (implementedBy && implementedBy === actor) throw new ControlStateError('SAME_PERSON', 'The person who recorded the implementation cannot verify its evidence');
    verifiedBy = actor;
  }
  if (status === 'EFFECTIVENESS_TESTED') {
    if (!prev || CONTROL_RANK[prev.status] < CONTROL_RANK.EVIDENCE_VERIFIED) throw new ControlStateError('NOT_VERIFIED', 'Verify the evidence before recording an effectiveness test');
    if (!evidence.some((e) => /TEST/i.test(e.type))) throw new ControlStateError('TEST_EVIDENCE_REQUIRED', 'Attach the effectiveness test result (an evidence reference of a TEST type)');
  }
  if (CONTROL_RANK[status] < CONTROL_RANK.EVIDENCE_VERIFIED) verifiedBy = null;

  return {
    framework_id: key.framework_id,
    framework_revision: key.framework_revision,
    control_id: key.control_id,
    status,
    justification,
    evidence_refs: evidence,
    assessed_by: actor,
    assessed_at: at.toISOString(),
    implemented_by: CONTROL_RANK[status] >= CONTROL_RANK.PARTIALLY_IMPLEMENTED ? implementedBy : null,
    verified_by: verifiedBy,
    migrated_from_v1_verdict: prev?.migrated_from_v1_verdict ?? null,
  };
}

export interface ControlView extends ControlApplicability {
  status: ControlStatus;
  /** Set when a person assessed it; null when the status is derived from applicability. */
  assessment: ControlAssessment | null;
  /** The assessment was made against an older registry revision. */
  stale_revision: boolean;
  /** Linked fields are filled in, which alone never moves the status past APPLICABLE. */
  linked_fields_filled: number;
}

/**
 * The status shown for each control of an applicable framework: the person's
 * assessment when there is one, otherwise APPLICABLE when the control applies
 * and NOT_ASSESSED while applicability is undetermined.
 */
export function controlViews(
  fw: FrameworkApplicability,
  assessments: ReadonlyArray<ControlAssessment>,
  filledFieldIds: ReadonlySet<string>,
): ControlView[] {
  return fw.controls
    .filter((c) => c.applies !== 'DOES_NOT_APPLY')
    .map((c) => {
      const a = assessments.find((x) => x.framework_id === fw.framework_id && x.control_id === c.control_id) ?? null;
      const derived: ControlStatus = c.applies === 'APPLIES' ? 'APPLICABLE' : 'NOT_ASSESSED';
      return {
        ...c,
        status: a ? a.status : derived,
        assessment: a,
        stale_revision: Boolean(a && a.framework_revision !== fw.revision),
        linked_fields_filled: c.linked_field_ids.filter((id) => filledFieldIds.has(id)).length,
      };
    });
}

/** The heading a framework gets on the card. ISO/IEC 42001 is organisational: the card holds supporting evidence only. */
export function frameworkHeading(fw: Pick<FrameworkApplicability, 'short_title' | 'noun' | 'organisational_only'>): string {
  return fw.organisational_only
    ? `${fw.short_title}: evidence supporting Annex A controls (organisational standard; this card cannot show conformity)`
    : `${fw.short_title}: ${fw.noun}s mapped to this record (a mapping is not compliance)`;
}

/** Map a v1 card framework label to a registry id (RBI FREE-AI has no registry entry yet). */
export function registryIdForV1Label(label: string): string | null {
  const l = label.toLowerCase();
  if (l.includes('42001')) return 'iso-42001-2023';
  if (l.includes('nist')) return 'nist-ai-rmf-1.0';
  if (l.includes('eu ai act')) return 'eu-ai-act-2024';
  return null;
}
