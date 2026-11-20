import { SectionDef, sectionFields } from '../types';

const S = 'impact';
const IA = { rule: 'R_PEOPLE_IMPACT' } as const;

export const IMPACT: SectionDef = {
  section_id: S,
  number: 7,
  title: 'Impact assessment',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['impact_assessment_ref', 'Impact assessment', 'url', 'Reference to the signed impact assessment.', { ...IA, register: 'impact_assessments', ev: 'impact_assessment', refs: ['iso-42001-2023:A.5', 'iso-42005-2025:IMPACT_ASSESSMENT'] }],
    ['rights_impact', 'Human and fundamental rights impact', 'longtext', 'Effects on people\'s rights.', IA],
    ['privacy_impact_summary', 'Privacy impact', 'longtext', 'Summary of privacy effects.', { rule: 'R_PERSONAL_DATA' }],
    ['societal_impact', 'Societal impact', 'longtext', 'Wider effects on society.'],
    ['financial_impact', 'Financial impact', 'longtext', 'Financial effects on people or the organisation.'],
    ['employment_impact', 'Employment impact', 'longtext', 'Effects on jobs or working conditions.'],
    ['health_safety_impact', 'Health and safety impact', 'longtext', 'Effects on health or physical safety.'],
    ['discrimination_impact', 'Discrimination impact', 'longtext', 'Risk of unfair treatment of groups.', IA],
    ['vulnerable_groups', 'Vulnerable groups', 'list', 'Vulnerable groups who may be affected.', IA],
    ['environmental_impact', 'Environmental impact', 'longtext', 'Environmental effects.'],
    ['stakeholder_consultation', 'Stakeholder consultation', 'longtext', 'Who was consulted and what they said.'],
    ['impact_mitigations', 'Mitigations', 'longtext', 'What reduces the impacts above.', IA],
    ['impact_approval', 'Impact assessment approval', 'text', 'Who approved the impact assessment, and when.', IA],
    ['fria_ref', 'Fundamental rights impact assessment (EU AI Act Art. 27)', 'url', 'Required for some deployers of high-risk systems. Applies when the deployer role and the Art. 27 criteria are met.', { rule: 'R_EU_FRIA', ev: 'fria', refs: ['eu-ai-act-2024:ART-27'] }],
    ['iso_42005_alignment', 'ISO/IEC 42005 alignment', 'longtext', 'How the impact assessment follows ISO/IEC 42005, where the organisation uses it.', { rule: 'R_PEOPLE_IMPACT', refs: ['iso-42005-2025:IMPACT_ASSESSMENT'] }],
  ]),
};
