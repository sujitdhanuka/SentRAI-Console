/**
 * Formal signal → control → plain-English mapping. Turns the code-level control
 * codes emitted by the validators into non-technical statements for the
 * executive/compliance rollup, so the translation stays in one maintainable
 * place as frameworks evolve (instead of ad-hoc gap strings scattered around).
 */

export const FRAMEWORK_NAMES: Record<string, string> = {
  rbi_free_ai: 'RBI FREE-AI (7 Sutras)',
  nist_ai_rmf: 'NIST AI RMF',
  eu_ai_act: 'EU AI Act',
  iso_42001: 'ISO/IEC 42001',
};

/**
 * A control code → the short requirement it represents, phrased so it reads as
 * "N models lack <phrase>". Keys cover the NIST/EU/ISO control codes and the
 * 7-Sutra alignment enum values used by the validators.
 */
const CONTROL_REQUIREMENT: Record<string, string> = {
  // NIST AI RMF
  'GOVERN-1.1': 'a named accountable owner',
  'GOVERN-1.2': 'a board-approved AI policy reference',
  'GOVERN-1.3': 'a defined audit schedule',
  'MAP-1.1': 'a documented purpose / use case',
  'MAP-1.2': 'documented deployment context and affected users',
  'MAP-1.3': 'source or dependency provenance',
  'MEASURE-2.1': 'a recent bias audit / red-team review',
  'MEASURE-2.2': 'recent performance-drift measurement',
  'MEASURE-2.3': 'recorded performance benchmarks',
  'MANAGE-1.1': 'a human-in-the-loop oversight control',
  'MANAGE-1.2': 'a business-continuity fallback plan',
  'MANAGE-1.3': 'on-time incident reporting',
  // EU AI Act
  'Art-9': 'a documented risk-management system',
  'Art-10': 'training-data governance / bias testing',
  'Art-11': 'complete technical documentation',
  'Art-12': 'automatic operational record-keeping',
  'Art-14': 'human oversight for high-risk decisions',
  'Art-15': 'accuracy & robustness monitoring',
  'Art-50': 'a user transparency disclosure',
  // ISO/IEC 42001
  'AIMS-6.1.2': 'a systematic risk assessment',
  'AIMS-8.2': 'a documented impact assessment',
  'AIMS-8.3': 'data & codebase governance',
  'AIMS-9.1': 'active performance monitoring',
  'AIMS-9.2': 'internal audits at planned intervals',
  'AIMS-10.1': 'timely handling of nonconformities',
  // 7 Sutras (SutraAlignment enum values)
  TRUST_IS_THE_FOUNDATION: 'a board-approved AI policy (Trust)',
  PEOPLE_FIRST: 'human oversight for medium/high-risk models (People First)',
  INNOVATION_OVER_RESTRAINT: 'a defined autonomous-action boundary (Innovation)',
  FAIRNESS_AND_EQUITY: 'documented bias-testing evidence (Fairness)',
  ACCOUNTABILITY: 'a named accountability owner (Accountability)',
  UNDERSTANDABLE_BY_DESIGN: 'an explainability mechanism (Understandable by Design)',
  SAFETY_RESILIENCE_SUSTAINABILITY: 'a red-team exercise on record (Safety & Resilience)',
};

/** Plain-English requirement for a control code, with a sensible fallback. */
export function controlRequirement(code: string, name?: string): string {
  return CONTROL_REQUIREMENT[code] ?? (name ? name.toLowerCase() : code);
}

/** "N models lack <requirement>." */
export function gapStatement(code: string, count: number, name?: string): string {
  const req = controlRequirement(code, name);
  return `${count} model${count === 1 ? '' : 's'} lack ${req}.`;
}

/** One-line readiness sentence for a framework rollup. */
export function frameworkReadiness(fwId: string, passing: number, assessed: number, openGaps: number): string {
  const fw = FRAMEWORK_NAMES[fwId] ?? fwId;
  if (assessed === 0) return `No models assessed against ${fw} yet.`;
  const pct = Math.round((passing / assessed) * 100);
  if (openGaps === 0) return `All ${assessed} model${assessed === 1 ? '' : 's'} meet ${fw}.`;
  return `${passing} of ${assessed} models (${pct}%) meet ${fw}; ${openGaps} blocking control${openGaps === 1 ? '' : 's'} still owed.`;
}
