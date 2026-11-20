import { SectionDef, sectionFields } from '../types';

const S = 'fairness';
const F = { rule: 'R_PEOPLE_IMPACT' } as const;

/**
 * Fairness and bias. Groups are recorded only where lawful: nothing here
 * requires collecting sensitive demographic data.
 */
export const FAIRNESS: SectionDef = {
  section_id: S,
  number: 8,
  title: 'Fairness and bias',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['fairness_methodology', 'Methodology', 'longtext', 'How fairness was assessed.', { ...F, refs: ['nist-ai-rmf-1.0:MEASURE-2', 'nist-ai-600-1:HARMFUL_BIAS'] }],
    ['relevant_groups', 'Relevant groups', 'list', 'Groups compared, where it is lawful to do so. Do not collect sensitive demographics just for this field.', F],
    ['fairness_representativeness', 'Representativeness', 'longtext', 'Whether test data represents the groups affected.'],
    ['fairness_metrics', 'Metrics', 'list', 'Fairness measures used.', F],
    ['disparate_impact', 'Disparate impact', 'text', 'Disparate-impact results, with the measure.', { ...F, ev: 'bias_test' }],
    ['fairness_results', 'Results', 'longtext', 'What the testing found.', { ...F, ev: 'bias_test' }],
    ['fairness_mitigation', 'Mitigation', 'longtext', 'What was done about unfair results.'],
    ['residual_bias', 'Residual bias', 'longtext', 'Bias that remains after mitigation.', F],
    ['fairness_review_date', 'Review date', 'date', 'When fairness was last reviewed.', F],
    ['fairness_independent_evidence', 'Independent evidence', 'url', 'Evidence from someone independent of the developers.', { ev: 'independent_review' }],
  ]),
};
