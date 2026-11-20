import { SectionDef, sectionFields } from '../types';

const S = 'safety';

export const SAFETY: SectionDef = {
  section_id: S,
  number: 13,
  title: 'Safety and responsible AI',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['safety_policies', 'Safety policies', 'list', 'Policies that apply to it.'],
    ['harm_prevention', 'Harm-prevention controls', 'longtext', 'Controls that prevent harm.'],
    ['moderation', 'Moderation', 'text', 'Input or output moderation.', { rule: 'R_GENERATIVE' }],
    ['output_filtering', 'Output filtering', 'text', 'Filters applied to outputs.', { rule: 'R_GENERATIVE' }],
    ['guardrails', 'Guardrails', 'longtext', 'Guardrails in place.', { rule: 'R_GENERATIVE' }],
    ['misuse_prevention', 'Misuse prevention', 'longtext', 'Controls against foreseeable misuse.'],
    ['dangerous_capability_assessment', 'Dangerous-capability assessment', 'url', 'Assessment of dangerous capabilities, for foundation and frontier models.', { rule: 'R_GPAI_PROVIDER', ev: 'evaluation_report', refs: ['eu-ai-act-2024:ART-55', 'nist-ai-600-1:CBRN'] }],
    ['robustness_safeguards', 'Robustness safeguards', 'text', 'Safeguards for unexpected inputs or conditions.'],
    ['safety_testing', 'Safety testing', 'url', 'Evidence of safety testing.', { rule: 'R_GENERATIVE', ev: 'evaluation_report' }],
    ['safety_incidents', 'Safety incidents', 'count', 'Safety incidents recorded. ZERO_RECORDED, NO_DATA and NOT_MONITORED are different answers.', { register: 'incidents' }],
    ['residual_safety_risk', 'Residual safety risk', 'longtext', 'Safety risk that remains.'],
  ]),
};
