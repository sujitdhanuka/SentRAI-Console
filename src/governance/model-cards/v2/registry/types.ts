/**
 * Model card v2: framework registry types (spec §2, §8). The registry holds
 * identifiers, dates and our own one-line paraphrases only, never the text of
 * a standard or law. Every seeded entry is UNVERIFIED_REQUIRES_LEGAL_REVIEW.
 */

export const FRAMEWORK_TYPES = ['STANDARD', 'LAW', 'REGULATION', 'GUIDANCE'] as const;
export type FrameworkType = (typeof FRAMEWORK_TYPES)[number];

export const VERIFICATION_STATUSES = ['UNVERIFIED_REQUIRES_LEGAL_REVIEW', 'LEGAL_REVIEWED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Law and regulation create obligations; standards and guidance describe controls or practices. */
export const isBinding = (t: FrameworkType) => t === 'LAW' || t === 'REGULATION';
/** The noun the UI and PDF use for one item of a framework. */
export const itemNoun = (t: FrameworkType) => (isBinding(t) ? 'obligation' : t === 'GUIDANCE' ? 'practice' : 'control');

/** A dated phase of a framework (EU AI Act phases, DPDP phasing). A null date means "not known yet". */
export interface PhaseDef {
  phase_id: string;
  title: string;
  effective_from: string | null;
  /** When set, the phase is the one that governs a record only while this rule fires. */
  applicability_rule_id?: string | null;
  note?: string | null;
}

export interface ControlDef {
  control_id: string;
  /** Our own one-line paraphrase. */
  title: string;
  /** Record types it applies to; null means every type. */
  record_types: string[] | null;
  applicability_rule_id: string | null;
  /** Roles it binds (EU AI Act roles); null means every role. */
  roles: string[] | null;
  /** The phases that set its date; the earliest phase whose rule fires governs. Empty: the framework's own date. */
  phase_ids: string[];
  evidence_type: string | null;
  assessment_method: string;
  control_owner_role: string | null;
  verification_status: VerificationStatus;
  /** Clause ids in the shipped compliance packs this control corresponds to (for cross-reference only). */
  pack_clause_refs: string[];
}

export interface FrameworkDef {
  framework_id: string;
  /** Registry revision of this entry; assessments pin it. Edits create a new revision. */
  revision: number;
  type: FrameworkType;
  title: string;
  short_title: string;
  jurisdiction: string | null;
  issuer: string;
  /** Standards and guidance apply only where the organisation adopted them. */
  requires_adoption: boolean;
  /** Laws apply where this rule fires (jurisdiction, role, use). */
  applicability_rule_id: string | null;
  /** The shipped pack this framework corresponds to, if any (org adoption follows the pack being on). */
  pack_id: string | null;
  effective_from: string | null;
  effective_note: string | null;
  phases: PhaseDef[];
  /** ISO/IEC 42001: an organisational management-system standard; a card can only hold evidence for Annex A controls. */
  organisational_only: boolean;
  verification_status: VerificationStatus;
  notes: string | null;
  controls: ControlDef[];
}

export type Applies = 'APPLIES' | 'DOES_NOT_APPLY' | 'UNDETERMINED';
export type InForce = 'IN_FORCE' | 'NOT_YET_IN_FORCE' | 'DATE_UNKNOWN';
