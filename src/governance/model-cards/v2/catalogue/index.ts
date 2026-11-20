/**
 * Model card v2: the field catalogue (spec §3, §11). Every consumer (form,
 * validation, applicability, scoring, mapping, PDF) reads this list.
 */
import { IDENTITY } from './sections/s01-identity';
import { INTENDED_USE } from './sections/s02-intended-use';
import { TECHNICAL } from './sections/s03-technical';
import { DATA } from './sections/s04-data';
import { DEPENDENCIES } from './sections/s05-dependencies';
import { RISK } from './sections/s06-risk';
import { IMPACT } from './sections/s07-impact';
import { FAIRNESS } from './sections/s08-fairness';
import { TRANSPARENCY } from './sections/s09-transparency';
import { OVERSIGHT } from './sections/s10-oversight';
import { EVALUATION } from './sections/s11-evaluation';
import { SECURITY } from './sections/s12-security';
import { SAFETY } from './sections/s13-safety';
import { REGULATORY } from './sections/s14-regulatory';
import { THIRD_PARTY } from './sections/s15-third-party';
import { CHANGE } from './sections/s16-change';
import { MONITORING } from './sections/s17-monitoring';
import { SUSTAINABILITY } from './sections/s18-sustainability';
import { FieldDef, SectionDef } from './types';

export * from './types';

export const SECTIONS: readonly SectionDef[] = [
  IDENTITY, INTENDED_USE, TECHNICAL, DATA, DEPENDENCIES, RISK, IMPACT, FAIRNESS, TRANSPARENCY,
  OVERSIGHT, EVALUATION, SECURITY, SAFETY, REGULATORY, THIRD_PARTY, CHANGE, MONITORING, SUSTAINABILITY,
];

export const FIELDS: readonly FieldDef[] = SECTIONS.flatMap((s) => s.fields);

const BY_ID = new Map(FIELDS.map((f) => [f.field_id, f]));

export function fieldDef(fieldId: string): FieldDef | undefined {
  return BY_ID.get(fieldId);
}

export function sectionDef(sectionId: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.section_id === sectionId);
}

/**
 * Fields a person must set themselves: the suggestion engine never drafts
 * them (spec §5: risk tier, regulatory classification, legal applicability,
 * compliance status).
 */
export const HUMAN_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'inherent_risk_tier', 'residual_risk_tier', 'risk_rationale', 'risk_acceptance',
  'eu_role', 'eu_classification', 'eu_art27_criteria', 'kr_high_impact', 'in_intermediary', 'us_consequential_decision',
  'regulatory_classification_other', 'applicable_laws', 'applicability_rationale', 'exemptions', 'jurisdictions',
]);

/** Fields whose change moves an approved card back to REASSESSMENT. */
export const REASSESSMENT_TRIGGERS: readonly string[] = FIELDS.filter((f) => f.triggers_reassessment).map((f) => f.field_id);
