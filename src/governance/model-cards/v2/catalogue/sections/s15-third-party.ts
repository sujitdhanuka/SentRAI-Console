import { M, SectionDef, sectionFields } from '../types';

const S = 'third_party';

/** Third-party governance. The whole section applies when a third-party provider is used (rule R_THIRD_PARTY). */
export const THIRD_PARTY: SectionDef = {
  section_id: S,
  number: 15,
  title: 'Third-party governance',
  applicability_rule_id: 'R_THIRD_PARTY',
  fields: sectionFields(S, [
    ['tp_provider', 'Provider', 'text', 'The third party, as recorded in the vendor register.', { req: M, register: 'vendors', refs: ['iso-42001-2023:A.10'] }],
    ['tp_location', 'Provider location', 'list', 'Where the provider is established and processes data.', { req: M }],
    ['tp_documentation', 'Provider documentation', 'url', 'Model or system card, usage policy, security documentation.', { req: M, ev: 'provider_documentation' }],
    ['tp_audit_evidence', 'Audit evidence', 'url', 'Independent audit reports from the provider.', { ev: 'audit_report' }],
    ['tp_certifications', 'Certifications', 'list', 'Certifications the provider holds.'],
    ['tp_sub_processors', 'Sub-processors', 'list', 'The provider\'s sub-processors.'],
    ['tp_dpa', 'Data processing agreement', 'url', 'The DPA in place.', { rule: 'R_PERSONAL_DATA', ev: 'contract' }],
    ['tp_contract_obligations', 'Contractual obligations', 'longtext', 'Key obligations in the contract.', { req: M }],
    ['tp_incident_history', 'Incident history', 'longtext', 'Known incidents at the provider.'],
    ['tp_change_notification', 'Change-notification terms', 'longtext', 'How and when the provider must tell you about model changes.', { req: M }],
    ['tp_exit_strategy', 'Exit strategy', 'longtext', 'How you would leave the provider.', { req: M, register: 'vendors' }],
    ['tp_concentration_risk', 'Concentration risk', 'longtext', 'How much depends on this one provider.'],
    ['tp_responsibility_split', 'Responsibility split', 'table', 'Who is responsible for what: platform, provider or tenant (for BYOK tenants).', {
      req: M,
      columns: [
        { key: 'area', label: 'Area', data_type: 'text', required: true },
        { key: 'platform', label: 'Platform', data_type: 'text' },
        { key: 'provider', label: 'Provider', data_type: 'text' },
        { key: 'tenant', label: 'Tenant', data_type: 'text' },
      ],
    }],
  ]),
};
