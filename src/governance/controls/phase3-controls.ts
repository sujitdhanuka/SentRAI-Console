/**
 * Phase 3 controls (E3.1 to E3.8). Like the Phase 2 controls, each reads
 * register-backed facts that a Phase 3 service adds to ctx.governance (MODEL
 * scope) or ctx.org (ORG scope). A missing fact means the feature is switched
 * off, so the control reports NOT ASSESSED: never a pass, never blocking.
 *
 * MODEL facts (ctx.governance):
 *   tevv         { testSets, withCriteria, latestFailing, neverRun, reviewOverdue }
 *   incidentExt  { serious, closedWithoutSignOff, openSeriousUnnotified }
 *   energy       { kwh, co2eKg, lastReadingAt, maxAgeDays }
 *   aiSecurity   { threatModel: 'NONE' | 'DRAFT' | 'APPROVED', applicable, untested, failingUnmitigated }
 *   deployers    { deployers, noticesDue }
 * ORG facts (ctx.org):
 *   disclosures  { transparencyPublishedAt, reviewOverdue }
 *   engagement   { items: { [item]: { mode, records, owner } } }
 */
import { ControlDefinition, ControlInput, ControlOutcome } from './control.types';

const out = (passed: boolean, facts: Record<string, any> = {}, key?: string): ControlOutcome => {
  const k = key ?? (passed ? 'pass' : 'fail');
  return { passed, key: k, facts, evidence: '', gapKeys: passed ? [] : [k] };
};
const notAssessed = (what: string): ControlOutcome => ({
  ...out(false, { what }, 'not_assessed'),
  evidence: `NOT ASSESSED: ${what} is not switched on`,
  notAssessed: true,
  gapKeys: ['not_assessed'],
});
const gov = (i: ControlInput, k: string) => i.ctx.governance?.[k];
const day = (d: any) => (d ? String(d).slice(0, 10) : null);

export const PHASE3_CONTROLS: ControlDefinition[] = [
  {
    id: 'CTL-TEVV-01',
    title: 'Test sets with acceptance criteria, latest results passing, metrics reviewed on schedule',
    scope: 'MODEL',
    evidenceTypes: ['validation_report'],
    parameters: [],
    evaluate: (i) => {
      const t = gov(i, 'tevv');
      if (!t) return notAssessed('the TEVV register');
      if (!t.withCriteria) return out(false, { test_sets: t.testSets }, 'missing');
      if (t.neverRun) return out(false, { never_run: t.neverRun }, 'not_run');
      if (t.latestFailing) return out(false, { failing: t.latestFailing }, 'failing');
      if (t.reviewOverdue) return out(false, { review_overdue: t.reviewOverdue }, 'review_overdue');
      return out(true, { test_sets: t.withCriteria });
    },
  },
  {
    id: 'CTL-INC-02',
    title: 'Serious incidents closed with senior sign-off, and affected people told',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const x = gov(i, 'incidentExt');
      if (!x) return notAssessed('incident extensions');
      if (x.closedWithoutSignOff) return out(false, { count: x.closedWithoutSignOff }, 'no_sign_off');
      if (x.openSeriousUnnotified) return out(false, { count: x.openSeriousUnnotified }, 'not_notified');
      return out(true, { serious: x.serious });
    },
  },
  {
    id: 'CTL-ENERGY-01',
    title: 'Energy use and CO2e measured for the system',
    scope: 'MODEL',
    evidenceTypes: ['energy_reading'],
    parameters: [],
    evaluate: (i) => {
      const e = gov(i, 'energy');
      if (!e) return notAssessed('energy measurement');
      if (!e.lastReadingAt) return out(false, {}, 'missing');
      const age = Math.floor((i.now.getTime() - new Date(e.lastReadingAt).getTime()) / 86_400_000);
      const ok = age <= Number(e.maxAgeDays ?? 365);
      return out(ok, { kwh: e.kwh, co2e_kg: e.co2eKg, last_reading: day(e.lastReadingAt), age_days: age }, ok ? 'pass' : 'stale');
    },
  },
  {
    id: 'CTL-SEC-AI-01',
    title: 'AI threat model approved and applicable attack categories evaluated',
    scope: 'MODEL',
    evidenceTypes: ['security_eval'],
    parameters: [],
    evaluate: (i) => {
      const s = gov(i, 'aiSecurity');
      if (!s) return notAssessed('AI security');
      if (s.threatModel !== 'APPROVED') return out(false, { state: s.threatModel }, 'no_threat_model');
      if (s.untested?.length) return out(false, { untested: s.untested.join(', ') }, 'untested');
      if (s.failingUnmitigated?.length) return out(false, { failing: s.failingUnmitigated.join(', ') }, 'failing');
      return out(true, { applicable: s.applicable });
    },
  },
  {
    id: 'CTL-DEPLOYER-01',
    title: 'Deployers told about material updates (developer disclosure)',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const d = gov(i, 'deployers');
      if (!d) return notAssessed('developer disclosures');
      if (!d.deployers) return { ...out(true, { deployers: 0 }, 'none'), notAssessed: true, gapKeys: [] };
      return out(!d.noticesDue, { deployers: d.deployers, notices_due: d.noticesDue }, d.noticesDue ? 'notice_due' : 'pass');
    },
  },
  {
    id: 'CTL-ORG-DISCLOSURE',
    title: 'Transparency statement published and reviewed on schedule',
    scope: 'ORG',
    evidenceTypes: ['disclosure'],
    parameters: [],
    evaluate: (i) => {
      const d = i.ctx.org?.disclosures;
      if (!d) return notAssessed('disclosures');
      if (!d.transparencyPublishedAt) return out(false, {}, 'missing');
      if (d.reviewOverdue) return out(false, { published: day(d.transparencyPublishedAt) }, 'review_overdue');
      return out(true, { published: day(d.transparencyPublishedAt) });
    },
  },
  {
    id: 'CTL-ORG-ENGAGEMENT',
    title: 'Consultation, expert input and team composition recorded, or owned by the customer',
    scope: 'ORG',
    evidenceTypes: ['engagement_record'],
    parameters: [],
    evaluate: (i) => {
      const e = i.ctx.org?.engagement;
      if (!e) return notAssessed('organisational records');
      const missing: string[] = [];
      const unowned: string[] = [];
      for (const [item, v] of Object.entries<any>(e.items ?? {})) {
        if (v.mode === 'CUSTOMER') {
          if (!v.owner) unowned.push(item);
        } else if (!v.records) missing.push(item);
      }
      if (unowned.length) return out(false, { items: unowned.join(', ') }, 'no_owner');
      if (missing.length) return out(false, { items: missing.join(', ') }, 'missing');
      return out(true, {});
    },
  },
];
