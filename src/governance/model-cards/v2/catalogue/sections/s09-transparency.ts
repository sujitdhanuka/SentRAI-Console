import { SectionDef, sectionFields } from '../types';

const S = 'transparency';

export const LABEL_METHODS = ['VISIBLE_LABEL', 'WATERMARK', 'METADATA', 'C2PA', 'NONE'] as const;

export const TRANSPARENCY: SectionDef = {
  section_id: S,
  number: 9,
  title: 'Explainability and transparency',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['explainability_methodology', 'Explainability methodology', 'longtext', 'How outputs are explained.', { rule: 'R_PEOPLE_IMPACT', refs: ['nist-ai-rmf-1.0:MEASURE-2'] }],
    ['interpretability', 'Interpretability', 'longtext', 'How well people can understand how it works.'],
    ['explainability_limitations', 'Explainability limitations', 'longtext', 'What cannot be explained.'],
    ['confidence_information', 'Confidence information', 'text', 'Whether and how confidence is shown with outputs.', { rule: 'R_PEOPLE_IMPACT' }],
    ['traceability', 'Traceability', 'longtext', 'How an output can be traced back to inputs, version and configuration.', { refs: ['eu-ai-act-2024:ART-12'] }],
    ['user_disclosure', 'User disclosure', 'longtext', 'How users are told they are dealing with AI.', { rule: 'R_GENERATIVE', refs: ['eu-ai-act-2024:ART-50', 'kr-ai-basic-act:USER_NOTICE'] }],
    ['content_labelling', 'AI-content labelling', 'table', 'How AI-generated output is labelled, per jurisdiction.', {
      rule: 'R_GENERATIVE',
      refs: ['eu-ai-act-2024:ART-50', 'kr-ai-basic-act:OUTPUT_LABEL', 'in-it-rules-2026:SYNTHETIC_LABEL', 'cn-ai-labelling:LABEL'],
      columns: [
        { key: 'jurisdiction', label: 'Jurisdiction', data_type: 'text', required: true },
        { key: 'method', label: 'Method', data_type: 'enum', allowed_values: LABEL_METHODS, required: true },
        { key: 'detail', label: 'Detail', data_type: 'text' },
      ],
    }],
    ['notification_mechanisms', 'Notification mechanisms', 'longtext', 'How affected people are notified.'],
    ['appeal_correction', 'Appeal and correction', 'longtext', 'How people challenge or correct an outcome.', { rule: 'R_PEOPLE_IMPACT', register: 'appeals' }],
  ]),
};
