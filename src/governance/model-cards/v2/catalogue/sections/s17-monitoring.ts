import { M, SectionDef, sectionFields } from '../types';

const S = 'monitoring';
const LIVE = { rule: 'R_DEPLOYED' } as const;

/** Monitoring and incidents. Every count distinguishes ZERO_RECORDED, NO_DATA and NOT_MONITORED (defect D9). */
export const MONITORING: SectionDef = {
  section_id: S,
  number: 17,
  title: 'Monitoring and incidents',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['monitored_dimensions', 'Monitored dimensions', 'multi', 'What is monitored.', {
      ...LIVE, values: ['PERFORMANCE', 'ACCURACY', 'DATA_DRIFT', 'CONCEPT_DRIFT', 'SAFETY', 'SECURITY', 'PRIVACY', 'FAIRNESS', 'COST'], refs: ['nist-ai-rmf-1.0:MANAGE-4', 'eu-ai-act-2024:ART-72'],
    }],
    ['monitoring_thresholds', 'Thresholds', 'longtext', 'Thresholds that raise an alert.', LIVE],
    ['monitoring_frequency', 'Frequency', 'text', 'How often each dimension is checked.', LIVE],
    ['drift_status', 'Latest drift status', 'text', 'From the drift reports.', { ...LIVE, register: 'drift' }],
    ['incident_count', 'Incidents', 'count', 'Incidents recorded.', { req: M, register: 'incidents' }],
    ['open_incident_count', 'Open incidents', 'count', 'Incidents still open.', { register: 'incidents' }],
    ['incident_classification', 'Incident severity and classification', 'text', 'How incidents are classified.'],
    ['incident_affected_users', 'Affected users', 'count', 'People affected by incidents.'],
    ['incident_root_cause', 'Root cause', 'longtext', 'Root cause of the latest significant incident.'],
    ['incident_corrective_action', 'Corrective action', 'longtext', 'What was done about it.', { register: 'corrective_actions' }],
    ['regulatory_notification', 'Regulatory notification', 'longtext', 'Which regulators must be notified of serious incidents, and the deadline per jurisdiction (from the registry).', { rule: 'R_HAS_JURISDICTION', refs: ['eu-ai-act-2024:ART-73', 'in-dpdp-2023:BREACH_NOTICE'] }],
    ['grievance_channel', 'Grievance channel', 'text', 'The actual contact people use to complain (an address or URL, not a description).', { rule: 'R_PEOPLE_IMPACT' }],
    ['grievance_count', 'Grievances', 'count', 'Grievances recorded.', { rule: 'R_PEOPLE_IMPACT', register: 'grievances' }],
    ['grievance_resolution', 'Grievance resolution', 'longtext', 'How grievances are resolved.', { rule: 'R_PEOPLE_IMPACT' }],
    ['suspension_criteria', 'Suspension criteria', 'longtext', 'When it would be suspended.', LIVE],
    ['remediation_status', 'Remediation status', 'text', 'Status of open remediation.'],
  ]),
};
