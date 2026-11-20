import { M, SectionDef, sectionFields } from '../types';

const S = 'dependencies';

export const DEPENDENCIES: SectionDef = {
  section_id: S,
  number: 5,
  title: 'Dependencies and supply chain',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['third_party_provider_used', 'Third-party provider used', 'tristate', 'Whether a third party supplies a model, API or hosting. YES switches on Third-party governance.', { req: M, reassess: true }],
    ['parent_models', 'Foundation, parent or fine-tuned-from model', 'records', 'Model records this one is built on.', { rt: ['AI_MODEL', 'AI_SYSTEM'], reassess: true }],
    ['selected_models', 'Models this configuration can select', 'records', 'Every model record the configuration can select, as the global default or a tenant override.', { rt: ['MODEL_CONFIGURATION'], req: M, reassess: true }],
    ['embedding_dependencies', 'Embedding dependencies', 'records', 'Embedding model records used.'],
    ['external_apis', 'External APIs', 'list', 'Outside APIs it calls.', { reassess: true }],
    ['third_party_services', 'Third-party services', 'list', 'Other services it depends on.', { register: 'vendors' }],
    ['sub_processors', 'Sub-processors', 'list', 'Sub-processors that handle data on the provider\'s behalf.', { rule: 'R_THIRD_PARTY' }],
    ['oss_libraries', 'Open-source libraries and versions', 'list', 'Key open-source libraries with versions.'],
    ['sbom_ref', 'SBOM or AI-BOM reference', 'url', 'Link to the software or AI bill of materials.', { register: 'ai_bom' }],
    ['provider_documentation', 'Provider documentation', 'url', 'The provider\'s model card or system card.', { rule: 'R_THIRD_PARTY', ev: 'provider_documentation' }],
    ['slas', 'SLAs', 'text', 'Service levels agreed with providers.', { rule: 'R_THIRD_PARTY' }],
    ['dpas', 'Data processing agreements', 'url', 'Reference to the DPA.', { rule: 'R_THIRD_PARTY', ev: 'contract' }],
    ['provider_certifications', 'Provider certifications', 'list', 'Certifications the provider holds, with evidence.', { rule: 'R_THIRD_PARTY' }],
    ['third_party_risk_assessment', 'Third-party risk assessment', 'url', 'Reference to the vendor assessment.', { rule: 'R_THIRD_PARTY', register: 'vendor_assessments', refs: ['iso-42001-2023:A.10', 'nist-ai-600-1:VALUE_CHAIN'] }],
    ['model_update_policy', 'Model update policy', 'longtext', 'How the provider changes or updates the model, and how you are told.', { rule: 'R_THIRD_PARTY' }],
    ['deprecation_policy', 'End-of-life and deprecation policy', 'longtext', 'What happens when the model or API is withdrawn.'],
  ]),
};
