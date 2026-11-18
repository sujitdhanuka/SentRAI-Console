/**
 * Official code lists for the frameworks SentRAI labels its checks with.
 * Every control code a validator, plugin or the coverage page prints must name
 * an entry here (enforced by phase0-labels.spec.ts), so a mislabel fails CI
 * instead of reaching a customer PDF. Sources: the NIST AI RMF 1.0 playbook,
 * ISO/IEC 42001:2023 clauses 4–10 and Annex A, the RBI FREE-AI committee report
 * (7 Sutras, 26 recommendations) — as listed in the Phase 0 gap analyses.
 * Becomes the pack code list in E1.1.
 */

/** NIST AI RMF 1.0 playbook subcategories (72). */
export const NIST_AI_RMF_SUBCATEGORIES: readonly string[] = [
  'GOVERN 1.1', 'GOVERN 1.2', 'GOVERN 1.3', 'GOVERN 1.4', 'GOVERN 1.5', 'GOVERN 1.6', 'GOVERN 1.7',
  'GOVERN 2.1', 'GOVERN 2.2', 'GOVERN 2.3', 'GOVERN 3.1', 'GOVERN 3.2', 'GOVERN 4.1', 'GOVERN 4.2',
  'GOVERN 4.3', 'GOVERN 5.1', 'GOVERN 5.2', 'GOVERN 6.1', 'GOVERN 6.2', 'MAP 1.1', 'MAP 1.2', 'MAP 1.3',
  'MAP 1.4', 'MAP 1.5', 'MAP 1.6', 'MAP 2.1', 'MAP 2.2', 'MAP 2.3', 'MAP 3.1', 'MAP 3.2', 'MAP 3.3',
  'MAP 3.4', 'MAP 3.5', 'MAP 4.1', 'MAP 4.2', 'MAP 5.1', 'MAP 5.2', 'MEASURE 1.1', 'MEASURE 1.2',
  'MEASURE 1.3', 'MEASURE 2.1', 'MEASURE 2.2', 'MEASURE 2.3', 'MEASURE 2.4', 'MEASURE 2.5', 'MEASURE 2.6',
  'MEASURE 2.7', 'MEASURE 2.8', 'MEASURE 2.9', 'MEASURE 2.10', 'MEASURE 2.11', 'MEASURE 2.12',
  'MEASURE 2.13', 'MEASURE 3.1', 'MEASURE 3.2', 'MEASURE 3.3', 'MEASURE 4.1', 'MEASURE 4.2', 'MEASURE 4.3',
  'MANAGE 1.1', 'MANAGE 1.2', 'MANAGE 1.3', 'MANAGE 1.4', 'MANAGE 2.1', 'MANAGE 2.2', 'MANAGE 2.3',
  'MANAGE 2.4', 'MANAGE 3.1', 'MANAGE 3.2', 'MANAGE 4.1', 'MANAGE 4.2', 'MANAGE 4.3',
];

/** ISO/IEC 42001:2023 clauses 4–10 and Annex A controls (65). */
export const ISO_42001_CLAUSES: readonly string[] = [
  '4.1', '4.2', '4.3', '4.4', '5.1', '5.2', '5.3', '6.1.1', '6.1.2', '6.1.3', '6.1.4', '6.2', '6.3', '7.1',
  '7.2', '7.3', '7.4', '7.5', '8.1', '8.2', '8.3', '8.4', '9.1', '9.2', '9.3', '10.1', '10.2', 'A.2.2',
  'A.2.3', 'A.2.4', 'A.3.2', 'A.3.3', 'A.4.2', 'A.4.3', 'A.4.4', 'A.4.5', 'A.4.6', 'A.5.2', 'A.5.3', 'A.5.4',
  'A.5.5', 'A.6.1.2', 'A.6.1.3', 'A.6.2.2', 'A.6.2.3', 'A.6.2.4', 'A.6.2.5', 'A.6.2.6', 'A.6.2.7', 'A.6.2.8',
  'A.7.2', 'A.7.3', 'A.7.4', 'A.7.5', 'A.7.6', 'A.8.2', 'A.8.3', 'A.8.4', 'A.8.5', 'A.9.2', 'A.9.3', 'A.9.4',
  'A.10.2', 'A.10.3', 'A.10.4',
];

/** RBI FREE-AI recommendations 1–26. */
export const RBI_FREE_AI_RECOMMENDATIONS: readonly number[] = Array.from({ length: 26 }, (_, i) => i + 1);

/** "GOVERN-2.1" → "GOVERN 2.1" (NIST); "AIMS-A.7.5" / "ISO42001-5.3" → "A.7.5" / "5.3" (ISO). */
export function nistCodeExists(code: string): boolean {
  return NIST_AI_RMF_SUBCATEGORIES.includes(code.replace('-', ' '));
}

export function isoCodeExists(code: string): boolean {
  return ISO_42001_CLAUSES.includes(code.replace(/^(AIMS|ISO42001)-/, ''));
}
