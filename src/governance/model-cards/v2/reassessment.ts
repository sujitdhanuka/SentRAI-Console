/**
 * Model card v2: change-triggered reassessment (spec §10). A change to a
 * catalogue field flagged `triggers_reassessment` (model version, provider,
 * prompts, datasets, fine-tuning, APIs, configuration, intended use, tool
 * permissions, jurisdictions, tenant reach), or to a link of the record graph,
 * sends an approved card back: ACTIVE_MONITORING goes to REASSESSMENT, and a
 * card part-way through approval goes back to ASSESSMENT because the approvals
 * so far were given on different facts. The approved version stays readable.
 */
import { fieldDef } from './catalogue';
import { WorkflowState } from './workflow';

const IN_APPROVAL: WorkflowState[] = ['GOVERNANCE_REVIEW', 'RISK_APPROVAL', 'FINAL_APPROVAL'];

export interface ReassessmentOutcome {
  triggered: boolean;
  to: WorkflowState;
  reason: string | null;
}

/** Whether changing these fields (or a graph link) reopens the card, and where it goes. */
export function afterChange(state: WorkflowState, change: { fieldIds?: string[]; linkRelation?: string | null }): ReassessmentOutcome {
  const fields = (change.fieldIds ?? []).filter((id) => fieldDef(id)?.triggers_reassessment);
  const what = [...fields.map((id) => fieldDef(id)!.label), ...(change.linkRelation ? [`link ${change.linkRelation}`] : [])];
  if (!what.length) return { triggered: false, to: state, reason: null };
  const reason = `Changed: ${what.join(', ')}.`;
  if (state === 'ACTIVE_MONITORING') return { triggered: true, to: 'REASSESSMENT', reason };
  if (IN_APPROVAL.includes(state)) return { triggered: true, to: 'ASSESSMENT', reason: `${reason} Approvals given so far no longer apply.` };
  return { triggered: false, to: state, reason };
}
