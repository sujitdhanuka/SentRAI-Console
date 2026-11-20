/**
 * Model card v2: the card workflow (spec §10). A pure state machine: the
 * service loads the context, calls `decide`, and writes the new state, the
 * approval record and the ledger event. Separation of duties: the card's
 * author never approves it, and the risk approver must hold a configured role.
 */
import { GateResult } from './finalisation';
import { RiskResult } from './risk/engine';

export const WORKFLOW_STATES = [
  'DRAFT', 'ASSESSMENT', 'EVIDENCE_COLLECTION', 'GOVERNANCE_REVIEW', 'RISK_APPROVAL', 'FINAL_APPROVAL', 'ACTIVE_MONITORING', 'REASSESSMENT', 'RETIRED',
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const ACTIONS = [
  'START_ASSESSMENT', 'COLLECT_EVIDENCE', 'SUBMIT_FOR_REVIEW', 'APPROVE', 'APPROVE_WITH_CONDITIONS', 'REJECT', 'REASSESS', 'RETIRE', 'COMMENT', 'REQUEST_EVIDENCE',
] as const;
export type WorkflowAction = (typeof ACTIONS)[number];

/** The approval step a review state stands for. */
export const APPROVAL_STEP: Partial<Record<WorkflowState, 'GOVERNANCE' | 'RISK' | 'FINAL'>> = {
  GOVERNANCE_REVIEW: 'GOVERNANCE', RISK_APPROVAL: 'RISK', FINAL_APPROVAL: 'FINAL',
};
const NEXT_AFTER_APPROVAL: Record<'GOVERNANCE' | 'RISK' | 'FINAL', WorkflowState> = {
  GOVERNANCE: 'RISK_APPROVAL', RISK: 'FINAL_APPROVAL', FINAL: 'ACTIVE_MONITORING',
};
const BACK_AFTER_REJECTION: Record<'GOVERNANCE' | 'RISK' | 'FINAL', WorkflowState> = {
  GOVERNANCE: 'EVIDENCE_COLLECTION', RISK: 'ASSESSMENT', FINAL: 'GOVERNANCE_REVIEW',
};

/** Roles that may edit a card and move it through the working states. */
export const EDITOR_ROLES = ['OWNER', 'CISO', 'ADMIN', 'APPROVER', 'REVIEWER'];
/** Roles that may give governance and final approval. */
export const APPROVER_ROLES = ['OWNER', 'CISO', 'ADMIN', 'APPROVER'];

export interface Condition {
  text: string;
  owner: string;
  due: string;
}

export interface DecisionContext {
  state: WorkflowState;
  action: WorkflowAction;
  actor: { email: string; role: string };
  /** The card's author: they never approve it. */
  author: string | null;
  /** Roles allowed to give the risk approval (governance settings). */
  riskApproverRoles: string[];
  /** Assigned reviewer, if any: when set, only they (or an officer) give the governance approval. */
  reviewer?: string | null;
  gate?: GateResult;
  risk?: RiskResult;
  comment?: string | null;
  conditions?: Condition[];
}

export interface Decision {
  ok: boolean;
  to: WorkflowState;
  /** Set when the action is an approval decision, for card_approvals. */
  approval?: { step: 'GOVERNANCE' | 'RISK' | 'FINAL'; decision: 'APPROVED' | 'APPROVED_WITH_CONDITIONS' | 'REJECTED'; conditions: Condition[] };
  errors: string[];
}

const OFFICERS = ['OWNER', 'CISO', 'ADMIN'];
const DATE = /^\d{4}-\d{2}-\d{2}/;

/** What `action` does from `state` for this actor, or why it cannot. */
export function decide(c: DecisionContext): Decision {
  const errors: string[] = [];
  const fail = (m: string): Decision => ({ ok: false, to: c.state, errors: [...errors, m] });
  const comment = c.comment?.trim() ?? '';

  if (c.state === 'RETIRED' && c.action !== 'COMMENT') return fail('A retired card cannot change; it stays readable.');
  if (c.action === 'COMMENT' || c.action === 'REQUEST_EVIDENCE') {
    if (comment.length < 3) return fail(c.action === 'COMMENT' ? 'Write the comment.' : 'Say what evidence is needed.');
    return { ok: true, to: c.state, errors };
  }
  if (c.action === 'RETIRE') {
    if (!OFFICERS.includes(c.actor.role)) return fail('Only an owner, CISO or administrator can retire a card.');
    if (comment.length < 10) return fail('Give the reason for retiring it (10 characters or more).');
    return { ok: true, to: 'RETIRED', errors };
  }
  if (c.action === 'REASSESS') {
    if (c.state !== 'ACTIVE_MONITORING') return fail('Only a card in active monitoring can be sent for reassessment.');
    if (!EDITOR_ROLES.includes(c.actor.role)) return fail('Your role cannot change cards.');
    if (comment.length < 10) return fail('Say why it needs reassessment (10 characters or more).');
    return { ok: true, to: 'REASSESSMENT', errors };
  }

  const working: Partial<Record<WorkflowAction, { from: WorkflowState[]; to: WorkflowState }>> = {
    START_ASSESSMENT: { from: ['DRAFT', 'REASSESSMENT'], to: 'ASSESSMENT' },
    COLLECT_EVIDENCE: { from: ['ASSESSMENT'], to: 'EVIDENCE_COLLECTION' },
    SUBMIT_FOR_REVIEW: { from: ['EVIDENCE_COLLECTION'], to: 'GOVERNANCE_REVIEW' },
  };
  const w = working[c.action];
  if (w) {
    if (!w.from.includes(c.state)) return fail(`${c.action} is not possible from ${c.state}.`);
    if (!EDITOR_ROLES.includes(c.actor.role)) return fail('Your role cannot change cards.');
    return { ok: true, to: w.to, errors };
  }

  // Approval decisions.
  const step = APPROVAL_STEP[c.state];
  if (!step) return fail(`There is no approval step in ${c.state}.`);
  if (c.author && c.author === c.actor.email) return fail('The author of a card cannot approve it (separation of duties).');
  if (step === 'RISK') {
    if (!c.riskApproverRoles.includes(c.actor.role)) return fail(`Risk approval needs one of these roles: ${c.riskApproverRoles.join(', ')}.`);
  } else if (!APPROVER_ROLES.includes(c.actor.role)) {
    return fail('Your role cannot approve cards.');
  }
  if (step === 'GOVERNANCE' && c.reviewer && c.reviewer !== c.actor.email && !OFFICERS.includes(c.actor.role)) {
    return fail(`${c.reviewer} is the assigned reviewer.`);
  }

  if (c.action === 'REJECT') {
    if (comment.length < 10) return fail('Say why it is rejected (10 characters or more).');
    return { ok: true, to: BACK_AFTER_REJECTION[step], approval: { step, decision: 'REJECTED', conditions: [] }, errors };
  }
  if (c.action !== 'APPROVE' && c.action !== 'APPROVE_WITH_CONDITIONS') return fail(`${c.action} is not possible from ${c.state}.`);

  const conditions = c.action === 'APPROVE_WITH_CONDITIONS' ? c.conditions ?? [] : [];
  if (c.action === 'APPROVE_WITH_CONDITIONS') {
    if (!conditions.length) return fail('List at least one condition.');
    for (const [i, k] of conditions.entries()) {
      if (!k?.text?.trim() || !k.owner?.trim() || !DATE.test(k.due ?? '')) errors.push(`Condition ${i + 1} needs text, an owner and a due date (YYYY-MM-DD).`);
    }
    if (errors.length) return { ok: false, to: c.state, errors };
  }
  if (step === 'RISK') {
    if (!c.risk || c.risk.status !== 'ASSESSED') {
      return fail(c.risk?.status === 'BLOCKED' ? 'The risk assessment breaks a hard rule; resolve it before risk approval.' : 'Set and accept the inherent and residual risk tiers first.');
    }
  }
  if (step === 'FINAL') {
    if (!c.gate) return fail('The finalisation gate was not evaluated.');
    if (!c.gate.can_finalise) return { ok: false, to: c.state, errors: c.gate.blockers.map((b) => b.message) };
  }
  return {
    ok: true,
    to: NEXT_AFTER_APPROVAL[step],
    approval: { step, decision: c.action === 'APPROVE' ? 'APPROVED' : 'APPROVED_WITH_CONDITIONS', conditions },
    errors,
  };
}

/** Next review date: the approval date plus the review cycle. */
export function nextReviewDate(approvedAt: Date, months: number): Date {
  const d = new Date(approvedAt.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export type ReviewStatus = 'NOT_SCHEDULED' | 'SCHEDULED' | 'DUE_SOON' | 'OVERDUE';

/** Review status shown on the card; DUE_SOON within 30 days. */
export function reviewStatus(nextReviewAt: Date | string | null, at: Date): ReviewStatus {
  if (!nextReviewAt) return 'NOT_SCHEDULED';
  const ms = new Date(nextReviewAt).getTime() - at.getTime();
  return ms < 0 ? 'OVERDUE' : ms <= 30 * 86_400_000 ? 'DUE_SOON' : 'SCHEDULED';
}
