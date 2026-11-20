import { M, SectionDef, sectionFields } from '../types';

const S = 'change';
const CFG = { rt: ['MODEL_CONFIGURATION'] as const };
const MT = { rule: 'R_MULTI_TENANT' } as const;

/**
 * Deployment and change management, plus the configuration-specific fields
 * for records such as "Global AI Model Settings" (spec §4).
 */
export const CHANGE: SectionDef = {
  section_id: S,
  number: 16,
  title: 'Deployment and change management',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['environment', 'Environment', 'list', 'Environments it is deployed to.'],
    ['deployment_date', 'Deployment date', 'date', 'When it went into production.'],
    ['deployment_approval', 'Deployment approval', 'text', 'The approval that let it go live.', { register: 'approvals' }],
    ['change_log', 'Change history', 'table', 'Changes to models, prompts, datasets, fine-tuning, providers, APIs, configuration, intended use or tool permissions.', {
      ...MT,
      columns: [
        { key: 'change_request_id', label: 'Change request', data_type: 'text', required: true },
        { key: 'date', label: 'Date', data_type: 'date', required: true },
        { key: 'kind', label: 'What changed', data_type: 'enum', allowed_values: ['MODEL', 'PROMPT', 'DATASET', 'FINE_TUNING', 'PROVIDER', 'API', 'CONFIGURATION', 'INTENDED_USE', 'TOOL_PERMISSIONS'], required: true },
        { key: 'previous_version', label: 'Previous version', data_type: 'text' },
        { key: 'new_version', label: 'New version', data_type: 'text' },
        { key: 'description', label: 'Description', data_type: 'text', required: true },
        { key: 'classification', label: 'Classification', data_type: 'enum', allowed_values: ['MINOR', 'MAJOR', 'EMERGENCY'] },
        { key: 'impact_assessment', label: 'Impact assessment', data_type: 'text' },
        { key: 'revalidation_required', label: 'Revalidation required', data_type: 'boolean' },
        { key: 'approved_by', label: 'Approved by', data_type: 'text' },
        { key: 'rolled_back', label: 'Rolled back', data_type: 'boolean' },
      ],
    }],
    ['change_management_process', 'Change-management process', 'longtext', 'How changes are requested, assessed, approved and released.', MT],
    ['decommissioning_date', 'Decommissioning date', 'date', 'When it was or will be retired.', { register: 'retirements' }],
    ['config_default_model', 'Default model', 'records', 'The model the configuration selects by default for every tenant without an override.', { ...CFG, req: M, reassess: true }],
    ['config_tenant_overrides', 'Tenant overrides (BYOK)', 'table', 'Tenants that use their own key or model instead of the default.', {
      ...CFG, req: M, reassess: true, sensitive: true,
      columns: [
        { key: 'tenant', label: 'Tenant', data_type: 'text', required: true },
        { key: 'byok', label: 'Own key (BYOK)', data_type: 'boolean', required: true },
        { key: 'model_record_id', label: 'Model record', data_type: 'text' },
        { key: 'provider', label: 'Provider', data_type: 'text' },
        { key: 'inherits_default', label: 'Inherits default', data_type: 'boolean', required: true },
      ],
    }],
    ['config_selection_rules', 'Model selection rules', 'longtext', 'How the effective model is chosen (default, override, fallback).', { ...CFG, req: M, reassess: true }],
    ['config_tenants_on_default', 'Tenants on the default', 'count', 'How many tenants use the default model.', { ...CFG, req: M }],
    ['config_users_on_default', 'Users on the default', 'count', 'How many users those tenants have.', CFG],
    ['config_endpoints', 'Provider and API endpoints', 'table', 'Endpoints the configuration can route to, and where each processes data.', {
      ...CFG, req: M, reassess: true,
      columns: [
        { key: 'provider', label: 'Provider', data_type: 'text', required: true },
        { key: 'endpoint', label: 'Endpoint', data_type: 'text', required: true },
        { key: 'region', label: 'Processing region', data_type: 'text', required: true },
      ],
    }],
    ['config_version', 'Configuration version', 'text', 'The version of the configuration in force.', { ...CFG, req: M, reassess: true }],
    ['config_downstream', 'Downstream dependencies', 'records', 'Records that depend on this configuration.', CFG],
  ]),
};
