import { M, SectionDef, sectionFields } from '../types';

const S = 'risk';

export const RISK_TIERS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const AUTONOMY_LEVELS = ['NONE', 'SUGGESTS', 'ACTS_WITH_APPROVAL', 'ACTS_AUTONOMOUSLY'] as const;
export const SEVERITY = ['NEGLIGIBLE', 'MINOR', 'MODERATE', 'MAJOR', 'SEVERE'] as const;
export const LIKELIHOOD = ['RARE', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'ALMOST_CERTAIN'] as const;
export const REVERSIBILITY = ['EASILY_REVERSED', 'REVERSIBLE_WITH_EFFORT', 'HARD_TO_REVERSE', 'IRREVERSIBLE'] as const;
export const TENANT_REACH = ['NONE', 'ONE_TENANT', 'SOME_TENANTS', 'ALL_TENANTS'] as const;

/**
 * Risk classification inputs (the engine is in Slice 2). Inputs left empty
 * count as "worst plausible" until assessed (hard rule 2). Risk tier and the
 * rationale are human-only: the suggestion engine never drafts them.
 */
export const RISK: SectionDef = {
  section_id: S,
  number: 6,
  title: 'Risk classification',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['impact_severity', 'Impact severity', 'enum', 'How bad the worst plausible harm would be.', { values: SEVERITY, req: M }],
    ['likelihood', 'Likelihood', 'enum', 'How likely that harm is without further controls.', { values: LIKELIHOOD, req: M }],
    ['users_reached', 'Users reached', 'number', 'Approximate number of people affected by its outputs.', { req: M, reassess: true }],
    ['organisations_reached', 'Organisations reached', 'number', 'Number of organisations (customers) affected.'],
    ['tenant_reach', 'Tenant reach', 'enum', 'How many tenants one change affects. ALL_TENANTS is the blast radius of a global setting.', { values: TENANT_REACH, req: M, reassess: true }],
    ['tenant_count', 'Tenants reached', 'number', 'How many tenants use this (for a configuration: how many use the global default).', { rule: 'R_MULTI_TENANT', reassess: true }],
    ['autonomy_level', 'Autonomy level', 'enum', 'How far it acts without a person. An empty value never lowers risk.', { values: AUTONOMY_LEVELS, req: M, reassess: true }],
    ['data_sensitivity', 'Data sensitivity', 'enum', 'Most sensitive data involved. Taken from data classification and personal data.', { values: ['LOW', 'MEDIUM', 'HIGH'], req: M }],
    ['reversibility', 'Reversibility', 'enum', 'How easily the effect of a wrong output can be undone.', { values: REVERSIBILITY, req: M }],
    ['existing_controls', 'Existing controls', 'table', 'Controls in place and whether their effectiveness has been verified.', {
      columns: [
        { key: 'control', label: 'Control', data_type: 'text', required: true },
        { key: 'implemented', label: 'Implemented', data_type: 'boolean', required: true },
        { key: 'effectiveness_verified', label: 'Effectiveness verified', data_type: 'boolean', required: true },
        { key: 'evidence', label: 'Evidence', data_type: 'url' },
      ],
    }],
    ['inherent_risk_tier', 'Inherent risk tier', 'enum', 'Risk before controls. Set by a person with the engine\'s explanation alongside.', { values: RISK_TIERS, req: M, refs: ['nist-ai-rmf-1.0:MAP-4', 'iso-23894-2023:RISK_PROCESS'] }],
    ['residual_risk_tier', 'Residual risk tier', 'enum', 'Risk after controls. Can only be lower than inherent with at least one verified effective control.', { values: RISK_TIERS, req: M, refs: ['nist-ai-rmf-1.0:MANAGE-1'] }],
    ['risk_rationale', 'Risk rationale', 'longtext', 'A human-written explanation of the tier. Never drafted by AI.', { req: M }],
    ['risk_acceptance', 'Risk acceptance', 'text', 'Reference to a risk acceptance (owner, date, expiry, conditions) where the residual risk is accepted.', { register: 'risk_acceptances' }],
  ]),
};
