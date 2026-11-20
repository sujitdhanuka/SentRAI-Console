import { M, SectionDef, sectionFields } from '../types';

const S = 'evaluation';

export const EVAL_CATEGORIES = [
  'ACCURACY', 'PRECISION', 'RECALL', 'F1', 'RELIABILITY', 'ROBUSTNESS', 'FAIRNESS', 'EXPLAINABILITY', 'PRIVACY_LEAKAGE', 'MEMORISATION',
  'HALLUCINATION', 'TOXICITY', 'HARMFUL_OUTPUT', 'PROMPT_INJECTION', 'ADVERSARIAL_ROBUSTNESS', 'DATA_LEAKAGE', 'CROSS_TENANT_LEAKAGE',
  'LATENCY', 'THROUGHPUT', 'AVAILABILITY', 'DRIFT', 'REGRESSION',
] as const;
export const VALIDATION_TYPES = ['PRE_DEPLOYMENT', 'PERIODIC', 'POST_CHANGE', 'INDEPENDENT', 'RED_TEAM'] as const;

/** One evaluation record. Results come from the TEVV, validation and red-team registers where they exist. */
export const EVALUATION_COLUMNS = [
  { key: 'test_name', label: 'Test name', data_type: 'text', required: true },
  { key: 'category', label: 'Category', data_type: 'enum', allowed_values: EVAL_CATEGORIES, required: true },
  { key: 'validation_type', label: 'Validation type', data_type: 'enum', allowed_values: VALIDATION_TYPES, required: true },
  { key: 'methodology', label: 'Methodology', data_type: 'text' },
  { key: 'dataset_ref', label: 'Dataset reference', data_type: 'text' },
  { key: 'date', label: 'Date', data_type: 'date', required: true },
  { key: 'evaluator', label: 'Evaluator', data_type: 'text', required: true },
  { key: 'metric', label: 'Metric', data_type: 'text' },
  { key: 'threshold', label: 'Threshold', data_type: 'text' },
  { key: 'result', label: 'Result', data_type: 'text', required: true },
  { key: 'outcome', label: 'Pass or fail', data_type: 'enum', allowed_values: ['PASS', 'FAIL', 'INCONCLUSIVE'], required: true },
  { key: 'evidence', label: 'Evidence', data_type: 'url', required: true },
  { key: 'remediation', label: 'Remediation', data_type: 'text' },
  { key: 'revalidation_date', label: 'Revalidation date', data_type: 'date' },
] as const;

const GEN = { rule: 'R_GENERATIVE' } as const;

export const EVALUATION: SectionDef = {
  section_id: S,
  number: 11,
  title: 'Evaluation and validation',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['evaluation_records', 'Evaluation records', 'table', 'Each test run: what was tested, how, by whom, the result and the evidence.', { columns: [...EVALUATION_COLUMNS], req: M, register: 'tevv', refs: ['nist-ai-rmf-1.0:MEASURE-2', 'eu-ai-act-2024:ART-15'] }],
    ['eval_hallucination', 'Hallucination evaluation', 'url', 'Evidence that hallucination was tested.', { ...GEN, ev: 'evaluation_report', refs: ['nist-ai-600-1:CONFABULATION'] }],
    ['eval_harmful_output', 'Harmful-output evaluation', 'url', 'Evidence that harmful or toxic output was tested.', { ...GEN, ev: 'evaluation_report', refs: ['nist-ai-600-1:DANGEROUS_CONTENT'] }],
    ['eval_prompt_injection', 'Prompt-injection testing', 'url', 'Evidence of prompt-injection testing.', { ...GEN, ev: 'security_test', refs: ['nist-ai-600-1:INFORMATION_SECURITY'] }],
    ['eval_cross_tenant_leakage', 'Cross-tenant leakage testing', 'url', 'Evidence that one tenant\'s data cannot reach another tenant.', { rule: 'R_MULTI_TENANT', ev: 'security_test' }],
    ['eval_regression_before_switch', 'Regression evaluation before a default switch', 'url', 'Evidence that the candidate model was evaluated before the default was changed.', { rt: ['MODEL_CONFIGURATION'], req: M, ev: 'evaluation_report' }],
    ['independent_validation', 'Independent validation', 'url', 'Validation by someone independent of the developers.', { rule: 'R_HIGH_RISK', register: 'validations', ev: 'validation_report' }],
    ['red_team', 'Red-team exercise', 'url', 'The latest red-team exercise.', { rule: 'R_HIGH_RISK', register: 'red_team', ev: 'red_team' }],
    ['next_revalidation', 'Next revalidation date', 'date', 'When it must be evaluated again.', { req: M }],
  ]),
};
