import { M, SectionDef, sectionFields } from '../types';

const S = 'oversight';
const AG = { rule: 'R_AGENT' } as const;
const CFG = { rt: ['MODEL_CONFIGURATION'] as const };

export const OVERSIGHT_MODELS = ['HUMAN_IN_THE_LOOP', 'HUMAN_ON_THE_LOOP', 'HUMAN_IN_COMMAND', 'CHANGE_CONTROL'] as const;

/**
 * Human oversight and accountability (defect D6). Oversight is described per
 * record type: for a configuration it means change approval, a four-eyes
 * check, audit, tenant notice and rollback, not "a person reviews outputs".
 */
export const OVERSIGHT: SectionDef = {
  section_id: S,
  number: 10,
  title: 'Human oversight and accountability',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['oversight_model', 'Oversight model', 'enum', 'How people oversee it. CHANGE_CONTROL is the model for configurations.', { values: OVERSIGHT_MODELS, req: M, refs: ['eu-ai-act-2024:ART-14', 'nist-ai-600-1:HUMAN_AI_CONFIGURATION'] }],
    ['oversight_role', 'Responsible role', 'text', 'The role that oversees it.', { req: M }],
    ['review_frequency', 'Review frequency', 'text', 'How often outputs or changes are reviewed.'],
    ['intervention_override', 'Intervention and override', 'longtext', 'How a person intervenes or overrides it.', { rt: ['AI_MODEL', 'AI_SYSTEM', 'AGENT', 'RAG_PIPELINE'] }],
    ['escalation', 'Escalation', 'longtext', 'When and to whom issues are escalated.'],
    ['reviewer_competency', 'Reviewer competency', 'longtext', 'The skills reviewers need.'],
    ['ai_literacy_training', 'AI literacy training', 'text', 'Training given to people who operate or oversee it.', { register: 'training', refs: ['eu-ai-act-2024:ART-4'] }],
    ['final_decision_accountability', 'Final decision accountability', 'text', 'Who is accountable for decisions made with its output.', { rule: 'R_PEOPLE_IMPACT' }],
    ['automation_boundaries', 'Automation boundaries', 'longtext', 'What it may and may not do without a person.'],
    ['change_permission', 'Who may change the setting', 'text', 'The role and permission needed to change this configuration.', { ...CFG, req: M }],
    ['four_eyes', 'Four-eyes approval', 'tristate', 'Whether a second person must approve a change before it takes effect.', { ...CFG, req: M }],
    ['change_audit', 'Change audit trail', 'url', 'Where changes to the configuration are logged.', { ...CFG, req: M, ev: 'audit_log' }],
    ['tenant_notification', 'Tenant notification', 'longtext', 'How tenants are told before or after a change that affects them.', { rule: 'R_MULTI_TENANT' }],
    ['rollback_capability', 'Rollback capability', 'longtext', 'How a change is rolled back, and how fast.', { ...CFG, req: M }],
    ['agent_tools', 'Tools', 'list', 'Tools the agent can call.', { ...AG, reassess: true, register: 'permitted_tools' }],
    ['agent_permissions', 'Permissions', 'longtext', 'What the agent is allowed to access or change.', { ...AG, reassess: true }],
    ['agent_execution_privileges', 'Execution privileges', 'text', 'The identity and privileges the agent runs with.', AG],
    ['agent_autonomous_actions', 'Autonomous actions', 'list', 'Actions it takes without approval.', AG],
    ['agent_approval_gates', 'Approval gates', 'list', 'Actions that need a person to approve first.', AG],
    ['agent_prohibited_actions', 'Prohibited actions', 'list', 'Actions it must never take.', AG],
    ['agent_transaction_limits', 'Transaction limits', 'text', 'Limits on value, volume or rate of actions.', AG],
    ['agent_emergency_stop', 'Emergency stop', 'longtext', 'How to stop it at once (kill switch).', AG],
  ]),
};
