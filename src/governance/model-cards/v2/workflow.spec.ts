import { afterChange } from './reassessment';
import { GateResult } from './finalisation';
import { RiskResult } from './risk/engine';
import { decide, DecisionContext, nextReviewDate, reviewStatus } from './workflow';

const author = 'author@x.test';
const base = (o: Partial<DecisionContext>): DecisionContext => ({
  state: 'DRAFT', action: 'START_ASSESSMENT', actor: { email: author, role: 'OWNER' }, author, riskApproverRoles: ['CISO'], ...o,
});
const openGate: GateResult = { can_finalise: true, blockers: [], warnings: [] };
const assessed = { status: 'ASSESSED', findings: [] } as unknown as RiskResult;

describe('card workflow', () => {
  it('walks DRAFT to ACTIVE_MONITORING with three separate approvals', () => {
    expect(decide(base({})).to).toBe('ASSESSMENT');
    expect(decide(base({ state: 'ASSESSMENT', action: 'COLLECT_EVIDENCE' })).to).toBe('EVIDENCE_COLLECTION');
    expect(decide(base({ state: 'EVIDENCE_COLLECTION', action: 'SUBMIT_FOR_REVIEW' })).to).toBe('GOVERNANCE_REVIEW');
    const gov = decide(base({ state: 'GOVERNANCE_REVIEW', action: 'APPROVE', actor: { email: 'rev@x.test', role: 'APPROVER' } }));
    expect(gov).toMatchObject({ ok: true, to: 'RISK_APPROVAL', approval: { step: 'GOVERNANCE', decision: 'APPROVED' } });
    const risk = decide(base({ state: 'RISK_APPROVAL', action: 'APPROVE', actor: { email: 'ciso@x.test', role: 'CISO' }, risk: assessed }));
    expect(risk).toMatchObject({ ok: true, to: 'FINAL_APPROVAL', approval: { step: 'RISK' } });
    const fin = decide(base({ state: 'FINAL_APPROVAL', action: 'APPROVE', actor: { email: 'ciso@x.test', role: 'CISO' }, gate: openGate }));
    expect(fin).toMatchObject({ ok: true, to: 'ACTIVE_MONITORING', approval: { step: 'FINAL' } });
  });

  it('refuses moves that are not allowed from the current state, or by a viewer', () => {
    expect(decide(base({ state: 'DRAFT', action: 'SUBMIT_FOR_REVIEW' })).ok).toBe(false);
    expect(decide(base({ actor: { email: 'v@x.test', role: 'VIEWER' } })).ok).toBe(false);
    expect(decide(base({ state: 'ASSESSMENT', action: 'APPROVE', actor: { email: 'c@x.test', role: 'CISO' } })).errors[0]).toMatch(/no approval step/);
    expect(decide(base({ state: 'RETIRED', action: 'START_ASSESSMENT' })).ok).toBe(false);
  });

  it('separation of duties: the author never approves, and the risk approver holds the configured role', () => {
    for (const state of ['GOVERNANCE_REVIEW', 'RISK_APPROVAL', 'FINAL_APPROVAL'] as const) {
      const d = decide(base({ state, action: 'APPROVE', actor: { email: author, role: 'CISO' }, risk: assessed, gate: openGate }));
      expect(d.ok).toBe(false);
      expect(d.errors[0]).toMatch(/author/);
    }
    const owner = decide(base({ state: 'RISK_APPROVAL', action: 'APPROVE', actor: { email: 'o2@x.test', role: 'OWNER' }, risk: assessed }));
    expect(owner.errors[0]).toMatch(/Risk approval needs one of these roles: CISO/);
    const reviewer = decide(base({ state: 'GOVERNANCE_REVIEW', action: 'APPROVE', actor: { email: 'other@x.test', role: 'APPROVER' }, reviewer: 'rev@x.test' }));
    expect(reviewer.errors[0]).toMatch(/assigned reviewer/);
  });

  it('needs an assessed risk for risk approval and an open gate for final approval', () => {
    const blocked = { status: 'BLOCKED', findings: [] } as unknown as RiskResult;
    expect(decide(base({ state: 'RISK_APPROVAL', action: 'APPROVE', actor: { email: 'c@x.test', role: 'CISO' }, risk: blocked })).errors[0]).toMatch(/hard rule/);
    const closed: GateResult = { can_finalise: false, blockers: [{ code: 'MANDATORY_MISSING', message: 'Purpose is required.' }], warnings: [] };
    const d = decide(base({ state: 'FINAL_APPROVAL', action: 'APPROVE', actor: { email: 'c@x.test', role: 'CISO' }, gate: closed }));
    expect(d).toMatchObject({ ok: false, to: 'FINAL_APPROVAL', errors: ['Purpose is required.'] });
  });

  it('approves with conditions only when each has an owner and a due date, and rejects with a reason', () => {
    const at = { state: 'GOVERNANCE_REVIEW' as const, action: 'APPROVE_WITH_CONDITIONS' as const, actor: { email: 'r@x.test', role: 'APPROVER' } };
    expect(decide(base({ ...at, conditions: [] })).ok).toBe(false);
    expect(decide(base({ ...at, conditions: [{ text: 'Add a kill switch', owner: '', due: '2027-01-31' }] })).errors[0]).toMatch(/owner and a due date/);
    const ok = decide(base({ ...at, conditions: [{ text: 'Add a kill switch', owner: 'eng@x.test', due: '2027-01-31' }] }));
    expect(ok).toMatchObject({ ok: true, to: 'RISK_APPROVAL', approval: { decision: 'APPROVED_WITH_CONDITIONS' } });
    expect(decide(base({ state: 'GOVERNANCE_REVIEW', action: 'REJECT', actor: at.actor, comment: 'no' })).ok).toBe(false);
    expect(decide(base({ state: 'GOVERNANCE_REVIEW', action: 'REJECT', actor: at.actor, comment: 'Evidence for the evaluation is missing.' })))
      .toMatchObject({ ok: true, to: 'EVIDENCE_COLLECTION', approval: { decision: 'REJECTED' } });
  });

  it('records comments and evidence requests without moving the card, and retires only with a reason', () => {
    expect(decide(base({ state: 'GOVERNANCE_REVIEW', action: 'REQUEST_EVIDENCE', comment: 'Attach the red-team report.' }))).toMatchObject({ ok: true, to: 'GOVERNANCE_REVIEW' });
    expect(decide(base({ state: 'ACTIVE_MONITORING', action: 'RETIRE', comment: 'gone' })).ok).toBe(false);
    expect(decide(base({ state: 'ACTIVE_MONITORING', action: 'RETIRE', actor: { email: 'r@x.test', role: 'REVIEWER' }, comment: 'Replaced by the new model.' })).ok).toBe(false);
    expect(decide(base({ state: 'ACTIVE_MONITORING', action: 'RETIRE', comment: 'Replaced by the new model.' })).to).toBe('RETIRED');
  });

  it('schedules the next review and shows overdue reviews', () => {
    const approved = new Date('2026-11-20T00:00:00Z');
    expect(nextReviewDate(approved, 12).toISOString().slice(0, 10)).toBe('2027-11-20');
    expect(reviewStatus(null, approved)).toBe('NOT_SCHEDULED');
    expect(reviewStatus('2027-11-20', approved)).toBe('SCHEDULED');
    expect(reviewStatus('2026-12-01', approved)).toBe('DUE_SOON');
    expect(reviewStatus('2026-11-01', approved)).toBe('OVERDUE');
  });
});

describe('change-triggered reassessment', () => {
  it('sends an approved card to REASSESSMENT when a triggering field changes', () => {
    expect(afterChange('ACTIVE_MONITORING', { fieldIds: ['system_prompt'] })).toMatchObject({ triggered: true, to: 'REASSESSMENT' });
    expect(afterChange('ACTIVE_MONITORING', { fieldIds: ['jurisdictions', 'tenant_reach'] }).reason).toMatch(/Jurisdictions.*Tenant reach/);
  });

  it('sends a card in approval back to ASSESSMENT, and ignores fields that do not trigger', () => {
    expect(afterChange('RISK_APPROVAL', { fieldIds: ['intended_use'] })).toMatchObject({ triggered: true, to: 'ASSESSMENT' });
    expect(afterChange('ACTIVE_MONITORING', { fieldIds: ['risk_rationale'] })).toMatchObject({ triggered: false, to: 'ACTIVE_MONITORING' });
    expect(afterChange('DRAFT', { fieldIds: ['system_prompt'] }).triggered).toBe(false);
  });

  it('treats a change of graph link (provider, selected model) as a trigger', () => {
    expect(afterChange('ACTIVE_MONITORING', { linkRelation: 'selects_model' })).toMatchObject({ triggered: true, to: 'REASSESSMENT' });
  });
});
