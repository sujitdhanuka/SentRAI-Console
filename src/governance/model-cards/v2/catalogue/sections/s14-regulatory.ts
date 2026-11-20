import { M, SectionDef, sectionFields } from '../types';

const S = 'regulatory';

export const JURISDICTIONS = ['EU', 'EEA', 'UK', 'IN', 'KR', 'CN', 'US', 'US-CO', 'SG', 'AU', 'OTHER'] as const;
export const EU_ROLES_V2 = ['GPAI_MODEL_PROVIDER', 'AI_SYSTEM_PROVIDER', 'DEPLOYER', 'IMPORTER', 'DISTRIBUTOR', 'AUTHORISED_REP', 'NONE'] as const;
export const EU_CLASSIFICATION = ['PROHIBITED', 'HIGH_RISK_ANNEX_I', 'HIGH_RISK_ANNEX_III', 'ART50_TRANSPARENCY', 'MINIMAL', 'OUT_OF_SCOPE', 'NOT_ASSESSED'] as const;

/**
 * Regulatory and legal. Regulatory classification is its own field, never
 * derived from the internal risk tier and never used to derive it (risk hard
 * rule 5). Human-only: the suggestion engine never drafts these.
 */
export const REGULATORY: SectionDef = {
  section_id: S,
  number: 14,
  title: 'Regulatory and legal',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['jurisdictions', 'Jurisdictions', 'multi', 'Jurisdictions where it is offered, used or affects people. Drives which laws apply.', { values: JURISDICTIONS, req: M, reassess: true }],
    ['eu_role', 'EU AI Act role', 'multi', 'Your role under the EU AI Act. GPAI-model-provider duties are separate from AI-system provider and deployer duties.', { values: EU_ROLES_V2, rule: 'R_EU', register: 'eu_act', refs: ['eu-ai-act-2024:ART-3'] }],
    ['eu_classification', 'EU AI Act classification', 'enum', 'Prohibited, high-risk, Art. 50 transparency, or minimal. Set by a person.', { values: EU_CLASSIFICATION, rule: 'R_EU', register: 'eu_act', refs: ['eu-ai-act-2024:ART-5', 'eu-ai-act-2024:ART-6'] }],
    ['eu_art27_criteria', 'EU AI Act Art. 27 criteria met', 'tristate', 'Whether the deployer falls under Art. 27 (fundamental rights impact assessment).', { rule: 'R_EU_DEPLOYER' }],
    ['kr_high_impact', 'Korea: high-impact AI', 'tristate', 'Whether it is high-impact AI under the Korean AI Basic Act.', { rule: 'R_KR', refs: ['kr-ai-basic-act:HIGH_IMPACT'] }],
    ['in_intermediary', 'India: acts as an intermediary', 'tristate', 'Whether SentRAI or the tenant acts as an intermediary for this use (IT Rules).', { rule: 'R_IN' }],
    ['cn_filing', 'China: generative AI service filing', 'text', 'Filing reference, if the China jurisdiction is enabled.', { rule: 'R_CN', refs: ['cn-genai-filing:FILING'] }],
    ['us_consequential_decision', 'US: consequential decision', 'tristate', 'Whether it makes or is a substantial factor in a consequential decision (Colorado as replaced by SB 26-189).', { rule: 'R_US', refs: ['us-co-sb26-189:CONSEQUENTIAL_DECISION'] }],
    ['regulatory_classification_other', 'Other regulatory classifications', 'table', 'Classifications under other laws.', {
      columns: [
        { key: 'framework', label: 'Law or framework', data_type: 'text', required: true },
        { key: 'classification', label: 'Classification', data_type: 'text', required: true },
        { key: 'basis', label: 'Basis', data_type: 'text' },
      ],
    }],
    ['applicable_laws', 'Applicable laws', 'list', 'Laws and regulations that apply. Proposed by the registry; confirmed by a person.', { req: M }],
    ['applicability_rationale', 'Applicability rationale', 'longtext', 'Why those laws apply, and why others do not.', { req: M }],
    ['exemptions', 'Exemptions', 'longtext', 'Exemptions relied on, with the basis.'],
    ['compliance_owner', 'Compliance owner', 'user', 'The named person responsible for regulatory obligations.', { req: M }],
    ['legal_review_date', 'Legal review date', 'date', 'When legal last reviewed applicability.', { req: M, ev: 'legal_review' }],
    ['regulatory_next_review', 'Next regulatory review', 'date', 'When applicability must be reviewed again.'],
  ]),
};
