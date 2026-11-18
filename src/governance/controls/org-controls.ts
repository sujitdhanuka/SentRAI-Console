/**
 * ORG-scope controls (E1.6): ISO/IEC 42001 is about the management system as
 * a whole, so these are judged once per organisation from the AIMS workspace,
 * the corrective-action register and document control (ctx.org), not per
 * model. The pack engine evaluates them only in the organisation evaluation.
 */
import { ControlDefinition, ControlInput, ControlOutcome } from './control.types';

const out = (passed: boolean, facts: Record<string, any> = {}, key?: string): ControlOutcome => ({ passed, key: key ?? (passed ? 'pass' : 'fail'), facts, evidence: '' });
const DAY = 86_400_000;

/** Approved and in-date record(s) of a type. */
function recordControl(id: string, title: string, type: string, minCount = 1): ControlDefinition {
  return {
    id, title, scope: 'ORG', evidenceTypes: ['aims_record'], parameters: [],
    evaluate: (i: ControlInput) => {
      const r = i.ctx.org?.records?.[type] ?? { approved: 0, overdue: 0 };
      if (r.approved < minCount) return out(false, { approved: r.approved, type }, 'missing');
      if (r.overdue > 0) return out(false, { approved: r.approved, overdue: r.overdue, type }, 'review_overdue');
      return out(true, { approved: r.approved, type });
    },
  };
}

/** People-side light record, or reported as customer responsibility (never silently covered). */
function peopleControl(id: string, title: string, type: string, item: string): ControlDefinition {
  return {
    id, title, scope: 'ORG', evidenceTypes: ['aims_record'], parameters: [],
    evaluate: (i) => {
      const setting = i.ctx.org?.peopleItems?.[item] ?? { mode: 'LIGHT_RECORD' };
      if (setting.mode === 'CUSTOMER') {
        return { ...out(false, { owner: setting.owner || 'no owner named' }, 'customer'), notAssessed: true };
      }
      const r = i.ctx.org?.records?.[type] ?? { approved: 0 };
      return out(r.approved > 0, { approved: r.approved }, r.approved > 0 ? 'pass' : 'missing');
    },
  };
}

export const ORG_CONTROLS: ControlDefinition[] = [
  recordControl('CTL-ORG-SCOPE', 'AIMS scope determined and approved', 'SCOPE'),
  recordControl('CTL-ORG-CONTEXT', 'Organisational context determined', 'CONTEXT'),
  recordControl('CTL-ORG-PARTIES', 'Interested parties and their requirements recorded', 'INTERESTED_PARTY'),
  recordControl('CTL-ORG-OBJECTIVES', 'AI objectives with measures', 'OBJECTIVE'),
  {
    id: 'CTL-ORG-POLICY',
    title: 'Approved AI policy in its review cycle',
    scope: 'ORG',
    evidenceTypes: ['aims_record', 'policy_document'],
    parameters: [],
    evaluate: (i) => {
      const p = i.ctx.org?.policy;
      if (!p) return out(false, {}, 'missing');
      if (p.overdue) return out(false, { approved_at: p.approvedAt }, 'review_overdue');
      if (i.opts.rec14 && p.missingRec14?.length) return out(false, { missing: p.missingRec14.join(', ') }, 'rec14_missing');
      return out(true, { approved_at: p.approvedAt, approved_by: p.approvedBy });
    },
  },
  {
    id: 'CTL-ORG-MGMT-REVIEW',
    title: 'Management review within the last 12 months',
    scope: 'ORG',
    evidenceTypes: ['aims_record'],
    parameters: [],
    evaluate: (i) => {
      const at = i.ctx.org?.lastMgmtReviewAt ? new Date(i.ctx.org.lastMgmtReviewAt) : null;
      if (!at) return out(false, {}, 'missing');
      const age = Math.floor((i.now.getTime() - at.getTime()) / DAY);
      return out(age <= 366, { date: at.toISOString().slice(0, 10), age }, age <= 366 ? 'pass' : 'stale');
    },
  },
  {
    id: 'CTL-ORG-AUDIT',
    title: 'Internal audit programme with independent auditors',
    scope: 'ORG',
    evidenceTypes: ['aims_record'],
    parameters: [],
    evaluate: (i) => {
      const a = i.ctx.org?.auditProgramme;
      if (!a) return out(false, {}, 'missing');
      if (a.planned === 0) return out(false, { planned: 0 }, 'missing');
      const ok = a.independent === a.planned;
      return out(ok, { planned: a.planned, not_independent: a.planned - a.independent }, ok ? 'pass' : 'not_independent');
    },
  },
  peopleControl('CTL-ORG-COMPETENCE', 'Competence of people doing AI work evidenced', 'COMPETENCE', 'competence'),
  peopleControl('CTL-ORG-AWARENESS', 'Awareness of the AI policy evidenced', 'AWARENESS', 'awareness'),
  {
    id: 'CTL-ORG-CA',
    title: 'Corrective actions handled on time with effectiveness reviewed',
    scope: 'ORG',
    evidenceTypes: ['corrective_action'],
    parameters: [],
    evaluate: (i) => {
      const c = i.ctx.org?.correctiveActions;
      if (!c) return { ...out(false, {}, 'not_assessed'), notAssessed: true };
      return out(c.overdue === 0, c);
    },
  },
  {
    id: 'CTL-ORG-DOCS',
    title: 'Documented information controlled (approved, in review)',
    scope: 'ORG',
    evidenceTypes: ['controlled_document'],
    parameters: [],
    evaluate: (i) => {
      const d = i.ctx.org?.documents;
      if (!d) return { ...out(false, {}, 'not_assessed'), notAssessed: true };
      if (!d.approved) return out(false, d, 'missing');
      return out(d.review_overdue === 0, d);
    },
  },
];
