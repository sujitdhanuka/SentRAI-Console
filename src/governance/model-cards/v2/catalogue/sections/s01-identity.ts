import { COMPONENT_LIFECYCLE, DEPLOYMENT_STATUS, MODEL_LIFECYCLE, OPERATIONAL_STATUS, RECORD_TYPES } from '../../record-types';
import { M, MODEL_LIKE, SectionDef, sectionFields } from '../types';

export const MODEL_CATEGORIES = [
  'TRADITIONAL_ML', 'DEEP_LEARNING', 'GENERATIVE', 'FOUNDATION', 'LLM', 'SLM', 'EMBEDDING', 'MULTIMODAL', 'AGENTIC_COMPONENT', 'NOT_A_MODEL',
] as const;
export const GENERATIVE_CATEGORIES = ['GENERATIVE', 'FOUNDATION', 'LLM', 'SLM', 'MULTIMODAL'] as const;
export const ACCESS_TYPES = ['OPEN_WEIGHTS', 'API', 'SAAS', 'INTERNAL', 'NOT_APPLICABLE'] as const;
export const HOSTING_TYPES = ['SELF_HOSTED', 'PRIVATE_CLOUD', 'PROVIDER_HOSTED', 'ON_DEVICE', 'HYBRID'] as const;

const S = 'identity';

export const IDENTITY: SectionDef = {
  section_id: S,
  number: 1,
  title: 'Identity and metadata',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['record_type', 'Record type', 'enum', 'What this card documents: a model, a system, a component, a configuration that selects models, an agent or a RAG pipeline.', { values: RECORD_TYPES, req: M, reassess: true }],
    ['model_id', 'Model or record identifier', 'text', 'The identifier used by the provider or your code (for example a model name and version string).', { req: M }],
    ['name', 'Name', 'text', 'The name people use for this record.', { req: M }],
    ['provider', 'Provider', 'text', 'Who supplies the model or service. "In-house" if you built it.', { req: M, reassess: true, rt: MODEL_LIKE }],
    ['developer', 'Developer', 'text', 'Who built it, if different from the provider.'],
    ['model_family', 'Model family', 'text', 'The family or series the model belongs to.', { rt: ['AI_MODEL'] }],
    ['model_category', 'Model category', 'enum', 'The kind of model. Generative categories switch on the generative-AI fields. NOT_A_MODEL for configurations and components.', { values: MODEL_CATEGORIES, req: M, reassess: true }],
    ['architecture', 'Architecture', 'text', 'The model architecture in a few words (for example "decoder-only transformer").', { rt: ['AI_MODEL'] }],
    ['version', 'Version', 'text', 'The version in use. A change triggers reassessment.', { req: M, reassess: true }],
    ['release_date', 'Release date', 'date', 'When this version was released by its provider or team.'],
    ['fingerprint', 'Fingerprint or hash', 'text', 'A hash or fingerprint that identifies the exact artefact, where one exists.', { rt: ['AI_MODEL'] }],
    ['licence', 'Licence', 'text', 'The licence or contract the model is used under.', { rt: MODEL_LIKE }],
    ['access_type', 'Access type', 'enum', 'How the model is reached.', { values: ACCESS_TYPES, rt: MODEL_LIKE }],
    ['hosting_type', 'Hosting type', 'enum', 'Where it runs.', { values: HOSTING_TYPES, req: M, rt: MODEL_LIKE }],
    ['hosting_region', 'Hosting region', 'list', 'Regions or countries where it runs and where data is processed.', { req: M, reassess: true }],
    ['deployment_identifier', 'Deployment identifier', 'text', 'The service, endpoint or deployment name in your environment.'],
    ['component_lifecycle', 'Component lifecycle', 'enum', 'Where the software component is in its own life (planned to retired).', { values: COMPONENT_LIFECYCLE, req: M, rt: ['AI_COMPONENT', 'MODEL_CONFIGURATION', 'AI_SYSTEM', 'AGENT', 'RAG_PIPELINE'] }],
    ['model_lifecycle', 'Model lifecycle', 'enum', 'Where the model is in its life. Taken from the inventory lifecycle stage.', { values: MODEL_LIFECYCLE, req: M, rt: ['AI_MODEL', 'AI_SYSTEM', 'AGENT'] }],
    ['deployment_status', 'Deployment status', 'enum', 'Whether it is deployed, and where.', { values: DEPLOYMENT_STATUS, req: M }],
    ['operational_status', 'Operational status', 'enum', 'Whether it is operating right now. SUSPENDED is set by the kill switch.', { values: OPERATIONAL_STATUS, req: M }],
    ['accountable_owner', 'Accountable owner', 'user', 'The named person accountable for this record. Must be a person, not a service account.', { req: M, refs: ['nist-ai-rmf-1.0:GOVERN-2', 'iso-42001-2023:A.3'] }],
    ['technical_owner', 'Technical owner', 'user', 'The named person who runs it technically.', { req: M }],
    ['business_owner', 'Business owner', 'user', 'The named person who owns the business use.'],
    ['registration_date', 'Registration date', 'date', 'When the record entered the inventory. Set by SentRAI.', { register: 'inventory' }],
    ['last_updated', 'Last updated', 'date', 'When the card last changed. Set by SentRAI.', { register: 'card' }],
    ['next_review_date', 'Next review date', 'date', 'When the card must be reviewed again. Overdue reviews show as a status.', { req: M }],
  ]),
};
