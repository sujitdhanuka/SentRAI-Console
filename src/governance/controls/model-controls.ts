/**
 * MODEL-scope controls (E1.1). Each one carries the check logic that used to
 * live inline in frameworks.validator.ts and sutras.validator.ts, moved here
 * without changing it: where two frameworks judged the "same" thing slightly
 * differently (for example "owner team contains 'unassigned'" vs "starts with
 * 'unassigned'"), the difference is kept as a clause option so every printed
 * verdict stays exactly as it was. The golden compatibility test
 * (pack-engine.spec.ts) proves this for every fixture.
 */
import { ModelType, RiskLevel, SutraAlignment } from '../../common/enums';
import {
  daysBetween,
  hasEvidence,
  intervalBand,
  isHighOrAbove,
  RED_TEAM_INTERVAL_DAYS,
  lastRedTeamEvidenceAt,
} from '../../domain/model-inventory';
import { bcpDrillStatus } from '../../domain/monitoring';
import { ControlDefinition, ControlInput, ControlOutcome } from './control.types';

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function outcome(passed: boolean, facts: Record<string, any> = {}, evidence = '', key?: string): ControlOutcome {
  return { passed, key: key ?? (passed ? 'pass' : 'fail'), facts, evidence };
}

function refsOf(input: ControlInput, type: string): string[] {
  return (input.entry.evidenceArtifacts ?? []).filter((a) => a.type === type).map((a) => a.ref);
}

/** Owner rule A (NIST GOVERN 2.1, Sutra 5): set and does not contain "unassigned". */
function ownerNamed(owner: string): boolean {
  return Boolean(owner) && !owner.toLowerCase().includes('unassigned');
}

/** Owner rule B (NIST MANAGE 2.1, ISO 5.3, EU Art 13): trimmed and does not start with "unassigned". */
export function ownerAssigned(owner: string): boolean {
  const o = (owner || '').trim();
  return o.length > 0 && !/^unassigned/i.test(o);
}

/** Drift evaluation recency against the resolved driftRecencyDays parameter. */
export function recentDrift(input: ControlInput): { ok: boolean; evidence: string } {
  const { ctx, params, now } = input;
  const recency = Number(params.values.driftRecencyDays ?? 30);
  if (ctx.lastDriftAt) {
    const d = Math.floor((now.getTime() - ctx.lastDriftAt.getTime()) / DAY);
    if (d <= recency) return { ok: true, evidence: `Last drift evaluation ${d} day(s) ago` };
    return { ok: false, evidence: `Drift evaluation stale: last run ${d} days ago` };
  }
  return { ok: false, evidence: 'No drift evaluations recorded for this model' };
}

/** Red-team interval for a tier from the resolver (strictest across enabled packs). */
export function redTeamInterval(input: ControlInput, risk: RiskLevel): number {
  const band = intervalBand(risk);
  return Number(input.params.values[`redTeamIntervalDays.${band}`] ?? RED_TEAM_INTERVAL_DAYS[band]);
}

const RISK_LEVELS = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL];

export const MODEL_CONTROLS: ControlDefinition[] = [
  {
    id: 'CTL-ACC-01',
    title: 'Accountable owner team named',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const owner = i.entry.ownerTeam || '';
      // Rule A or rule B, chosen by the clause (opts.rule = 'contains' | 'prefix').
      const ok = i.opts.rule === 'prefix' ? ownerAssigned(owner) : ownerNamed(owner);
      return outcome(ok, { ownerTeam: i.entry.ownerTeam ?? 'MISSING' });
    },
  },
  {
    id: 'CTL-POL-01',
    title: 'Board-approved AI policy referenced',
    scope: 'MODEL',
    evidenceTypes: ['ai_policy'],
    parameters: [],
    evaluate: (i) => {
      const ref = i.entry.boardPolicyRef;
      // opts.match: 'trimmed' (NIST), 'truthy' (EU), 'notEmptyString' (Sutra 1 — null counts as set).
      const ok =
        i.opts.match === 'notEmptyString' ? ref !== '' : i.opts.match === 'truthy' ? Boolean(ref) : Boolean(ref && ref.trim());
      return outcome(ok, { boardPolicyRef: ref });
    },
  },
  {
    id: 'CTL-AUD-01',
    title: 'Internal audit scheduled',
    scope: 'MODEL',
    evidenceTypes: ['audit_report'],
    parameters: [],
    evaluate: (i) => {
      const due = i.entry.nextAuditDue;
      const facts = { nextAuditDue: due ? isoDate(due) : null };
      if (!i.opts.requireFuture) return outcome(Boolean(due), facts);
      if (!due) return outcome(false, facts, '', 'none');
      const future = due.getTime() > i.now.getTime();
      return outcome(future, facts, '', future ? 'pass' : 'past_due');
    },
  },
  {
    id: 'CTL-CTX-01',
    title: 'Intended purpose documented',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const desc = i.entry.useCaseDescription || '';
      const min = Number(i.opts.minLength ?? 20);
      // opts.untrimmed: the EU Art 50 rule (length > 10 on the raw text).
      const ok = i.opts.untrimmed ? desc.length > min : desc.trim().length >= min;
      return outcome(ok, { descLength: desc.length, descPrefix: desc.slice(0, 100) });
    },
  },
  {
    id: 'CTL-CTX-02',
    title: 'Deployment context and affected people documented',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const segs = i.entry.targetCustomerSegments ?? [];
      const ok = Boolean(i.entry.functionalArea) && segs.length > 0;
      return outcome(ok, { functionalArea: i.entry.functionalArea, segments: (i.entry.targetCustomerSegments ?? []).join(', ') });
    },
  },
  {
    id: 'CTL-PROV-01',
    title: 'Source and dependency provenance recorded',
    scope: 'MODEL',
    evidenceTypes: ['sbom'],
    parameters: [],
    evaluate: (i) => {
      const deps = i.entry.dependencies ?? [];
      const ok = Boolean(i.entry.sourceRef) || deps.length > 0;
      return outcome(ok, {
        provenance: i.entry.sourceRef ?? 'dependency list',
        provenanceOrList: i.entry.sourceRef || 'Dependencies list',
      });
    },
  },
  {
    id: 'CTL-PROV-02',
    title: 'Provider along the value chain identified',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => outcome(Boolean((i.entry.developedBy || '').trim()), { developedBy: i.entry.developedBy }),
  },
  {
    id: 'CTL-SEC-01',
    title: 'Security red teaming within the tier interval',
    scope: 'MODEL',
    evidenceTypes: ['red_team'],
    parameters: ['redTeamIntervalDays.HIGH', 'redTeamIntervalDays.MEDIUM', 'redTeamIntervalDays.LOW', 'legacyRedTeamIntervalDays'],
    evaluate: (i) => {
      const { entry, flags, now } = i;
      const refs = refsOf(i, 'red_team');
      if (flags.redTeamIntervals) {
        const interval = redTeamInterval(i, entry.riskLevel);
        const at = lastRedTeamEvidenceAt(entry);
        const facts = { interval, tier: entry.riskLevel };
        if (!at) return { ...outcome(false, facts, 'No red-team evidence on record', 'none'), gapKeys: ['tiered'], evidenceRefs: refs };
        const d = daysBetween(at, now);
        const ok = d <= interval;
        return {
          ...outcome(ok, facts, ok
            ? `Last red teamed ${d} days ago (${isoDate(at)}); ${entry.riskLevel} interval is ${interval} days`
            : `Red teaming stale: last performed ${d} days ago; ${entry.riskLevel} interval is ${interval} days`),
          gapKeys: ['tiered'],
          evidenceRefs: refs,
        };
      }
      const legacy = Number(i.params.values.legacyRedTeamIntervalDays ?? 365);
      if (entry.lastRedTeamDate) {
        const d = Math.floor((now.getTime() - entry.lastRedTeamDate.getTime()) / DAY);
        const ok = d < legacy;
        return {
          ...outcome(ok, {}, ok ? `Last red teamed ${d} days ago (${isoDate(entry.lastRedTeamDate)})` : `Red teaming stale: last performed ${d} days ago`),
          gapKeys: ['legacy'],
          evidenceRefs: refs,
        };
      }
      if (hasEvidence(entry, 'red_team')) {
        return { ...outcome(true, {}, 'Red-team report attached as evidence artifact'), gapKeys: ['legacy'], evidenceRefs: refs };
      }
      return { ...outcome(false, {}, 'No red-team evidence on record'), gapKeys: ['legacy'], evidenceRefs: refs };
    },
  },
  {
    id: 'CTL-MON-01',
    title: 'Production performance and drift monitored',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: ['driftRecencyDays'],
    evaluate: (i) => {
      const d = recentDrift(i);
      return outcome(d.ok, {}, d.evidence);
    },
  },
  {
    id: 'CTL-MON-02',
    title: 'Post-market monitoring plan active',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: ['driftRecencyDays'],
    evaluate: (i) => outcome(Boolean(i.ctx.bcpConfigured) && recentDrift(i).ok),
  },
  {
    id: 'CTL-PERF-01',
    title: 'Performance benchmarks recorded',
    scope: 'MODEL',
    evidenceTypes: ['behavioral_eval'],
    parameters: [],
    evaluate: (i) => {
      const n = (i.entry.performanceBenchmarks ?? []).length;
      return outcome(n > 0, { benchmarkCount: i.entry.performanceBenchmarks?.length ?? 0 });
    },
  },
  {
    id: 'CTL-HUM-01',
    title: 'Human oversight in place where the tier requires it',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const on = Boolean(i.entry.humanOversightRequired);
      const risk = i.entry.riskLevel;
      // opts.mode: 'highRequires' (NIST: HIGH/CRITICAL need it), 'required' (EU Art 14), 'unlessLow' (Sutra 2).
      let ok: boolean;
      if (i.opts.mode === 'required') ok = i.entry.humanOversightRequired;
      else if (i.opts.mode === 'unlessLow') ok = i.entry.humanOversightRequired || risk === RiskLevel.LOW;
      else ok = !((risk === RiskLevel.HIGH || risk === RiskLevel.CRITICAL) && !i.entry.humanOversightRequired);
      return outcome(ok, {}, on ? 'Human-in-the-loop oversight enabled' : 'No oversight controls required (Low/Medium risk)');
    },
  },
  {
    id: 'CTL-AUTO-01',
    title: 'Autonomous scope boundary defined',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const e = i.entry;
      const ok = e.humanOversightRequired === false ? e.autonomousScope !== null && e.autonomousScope !== undefined : true;
      return outcome(ok);
    },
  },
  {
    id: 'CTL-BCP-01',
    title: 'Business-continuity fallback configured',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => outcome(Boolean(i.ctx.bcpConfigured)),
  },
  {
    id: 'CTL-INC-01',
    title: 'Incidents reported within their deadlines',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: ['incidentReportHours'],
    evaluate: (i) => {
      const overdue = i.ctx.overdueIncidentCount ?? 0;
      return outcome(overdue === 0, { overdue });
    },
  },
  {
    id: 'CTL-TRK-01',
    title: 'Risks tracked over time (append-only ledger)',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const n = i.ctx.ledgerEventCount ?? 0;
      return outcome(n > 0, { ledgerEventCount: i.ctx.ledgerEventCount });
    },
  },
  {
    id: 'CTL-REC-01',
    title: 'Automatic operational records kept',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const ok = (i.ctx.ledgerEventCount ?? 0) > 0 && (i.ctx.driftReportCount ?? 0) > 0;
      return outcome(ok, { ledgerEventCount: i.ctx.ledgerEventCount, driftReportCount: i.ctx.driftReportCount });
    },
  },
  {
    id: 'CTL-PRIV-01',
    title: 'Privacy / fundamental-rights impact examined (DPIA)',
    scope: 'MODEL',
    evidenceTypes: ['dpia'],
    parameters: [],
    evaluate: (i) => ({ ...outcome(hasEvidence(i.entry, 'dpia')), evidenceRefs: refsOf(i, 'dpia') }),
  },
  {
    id: 'CTL-RISK-01',
    title: 'AI system risk classified',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const classified = RISK_LEVELS.includes(i.entry.riskLevel);
      const ok = i.opts.requirePolicy ? classified && Boolean(i.entry.boardPolicyRef) : classified;
      return outcome(ok, { riskLevel: i.entry.riskLevel, boardPolicyRef: i.entry.boardPolicyRef });
    },
  },
  {
    id: 'CTL-DATA-01',
    title: 'Data governance and bias testing documented',
    scope: 'MODEL',
    evidenceTypes: ['bias_test'],
    parameters: [],
    evaluate: (i) => {
      const bias = hasEvidence(i.entry, 'bias_test');
      const ok = bias || (i.entry.dependencies ?? []).length > 0;
      return {
        ...outcome(ok, {}, '', ok ? (bias ? 'bias_test' : 'dependencies') : 'fail'),
        evidenceRefs: refsOf(i, 'bias_test'),
      };
    },
  },
  {
    id: 'CTL-DOC-01',
    title: 'Technical documentation with source traceability',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const ok = Boolean(i.entry.sourceRef) && (i.entry.useCaseDescription || '').trim().length >= 20;
      return outcome(ok, { sourceRef: i.entry.sourceRef });
    },
  },
  {
    id: 'CTL-DOC-02',
    title: 'Model card / system documentation attached',
    scope: 'MODEL',
    evidenceTypes: ['model_card'],
    parameters: [],
    evaluate: (i) => ({ ...outcome(hasEvidence(i.entry, 'model_card')), evidenceRefs: refsOf(i, 'model_card') }),
  },
  {
    id: 'CTL-INFO-01',
    title: 'Information to deployers: purpose and accountable owner',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const ok = (i.entry.useCaseDescription || '').trim().length >= 20 && ownerAssigned(i.entry.ownerTeam);
      return outcome(ok, { ownerTeam: i.entry.ownerTeam });
    },
  },
  {
    id: 'CTL-DEP-01',
    title: 'Deployment date recorded',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const d = i.entry.deploymentDate;
      return outcome(d != null, { deploymentDate: d ? isoDate(d) : null });
    },
  },
  {
    id: 'CTL-FAIR-01',
    title: 'Bias testing evidenced (declaration accepted only for LOW risk)',
    scope: 'MODEL',
    evidenceTypes: ['bias_test'],
    parameters: [],
    evaluate: (i) => {
      const e = i.entry;
      const medOrHigh = e.riskLevel === RiskLevel.MEDIUM || e.riskLevel === RiskLevel.HIGH;
      const evidence = hasEvidence(e, 'bias_test');
      const declared = e.sutrasAlignment.includes(SutraAlignment.FAIRNESS);
      const ok = medOrHigh ? evidence : evidence || declared;
      return {
        ...outcome(ok, {}, '', ok ? (evidence ? 'bias_test' : 'declared') : 'fail'),
        gapKeys: [medOrHigh ? 'needs_evidence' : 'not_declared'],
        evidenceRefs: refsOf(i, 'bias_test'),
      };
    },
  },
  {
    id: 'CTL-EXPL-01',
    title: 'Explainability mechanism declared',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) =>
      outcome(i.entry.sutrasAlignment.includes(SutraAlignment.EXPLAINABILITY) || i.entry.riskLevel === RiskLevel.LOW),
  },
  {
    id: 'CTL-RES-01',
    title: 'Safety and resilience: red teaming and BCP drills for high-risk systems',
    scope: 'MODEL',
    evidenceTypes: ['red_team', 'bcp_drill'],
    parameters: ['redTeamIntervalDays.HIGH', 'bcpDrillIntervalDays', 'bcpDrillReminderDays'],
    evaluate: (i) => {
      const { entry: e, flags } = i;
      const isHigh = flags.governanceV2 ? isHighOrAbove(e.riskLevel) : e.riskLevel === RiskLevel.HIGH;
      const tier = e.riskLevel;
      let ok = isHigh ? e.lastRedTeamDate !== null || hasEvidence(e, 'red_team') : true;
      let evidence = ok ? (e.lastRedTeamDate ? `Last red-team: ${e.lastRedTeamDate}` : 'Red-team report attached as evidence artifact') : '';
      const gapKeys: string[] = ok ? [] : ['no_red_team'];
      const facts: Record<string, any> = { tier };
      if (isHigh && flags.redTeamIntervals && ok) {
        const interval = redTeamInterval(i, e.riskLevel);
        const at = lastRedTeamEvidenceAt(e);
        const age = at ? daysBetween(at, i.now) : null;
        if (!at || (age as number) > interval) {
          ok = false;
          facts.redTeamAge = age ?? 'an unknown number of';
          facts.redTeamInterval = interval;
          gapKeys.push('red_team_stale');
        }
      }
      if (isHigh && flags.bcpDrills) {
        const interval = Number(i.params.values.bcpDrillIntervalDays ?? 365);
        const reminder = Number(i.params.values.bcpDrillReminderDays ?? 30);
        const drill = bcpDrillStatus(i.ctx.bcpDrillLastConducted ?? null, i.now, interval, reminder);
        facts.drillInterval = interval;
        facts.drillAge = drill.ageDays;
        if (drill.status === 'NONE' || drill.status === 'OVERDUE') {
          ok = false;
          gapKeys.push(drill.status === 'NONE' ? 'no_drill' : 'drill_overdue');
        } else if (evidence) {
          evidence += `; last BCP drill ${drill.ageDays} day(s) ago`;
        }
      }
      return { ...outcome(ok, facts, ok ? evidence : ''), gapKeys, evidenceRefs: refsOf(i, 'red_team') };
    },
  },
  {
    id: 'CTL-IMPACT-01',
    title: 'AI system impact assessment completed',
    scope: 'MODEL',
    evidenceTypes: ['impact_assessment'],
    parameters: [],
    evaluate: (i) => {
      // Becomes register-backed in E1.4: ctx.governance.impactAssessment carries the latest FINAL record.
      const ia = i.ctx.governance?.impactAssessment;
      if (ia === undefined) {
        return { ...outcome(false, {}, '', 'not_assessed'), notAssessed: true, gapKeys: ['not_assessed'] };
      }
      if (!ia) return { ...outcome(false, {}, '', 'missing'), gapKeys: ['missing'] };
      const ok = ia.status === 'FINAL';
      return {
        ...outcome(ok, { version: ia.version, signedAt: ia.signedAt ?? null, status: ia.status }, '', ok ? 'pass' : 'not_final'),
        gapKeys: ['missing'],
        evidenceRefs: [`impact_assessment:${ia.id}`],
      };
    },
  },
  {
    id: 'CTL-RISK-02',
    title: 'Risks assessed, treated and accepted or within appetite (risk register)',
    scope: 'MODEL',
    evidenceTypes: ['risk_register'],
    parameters: [],
    evaluate: (i) => {
      // Register-backed (E1.3): ctx.governance.riskRegister = { total, assessed, unaccepted }.
      const reg = i.ctx.governance?.riskRegister;
      if (!reg) return { ...outcome(false, {}, 'NOT ASSESSED: the risk register is not available for this model', 'not_assessed'), notAssessed: true, gapKeys: ['empty'] };
      if (!reg.assessed) return { ...outcome(false, reg, '', 'empty'), gapKeys: ['empty'] };
      return { ...outcome(reg.unaccepted === 0, reg, '', reg.unaccepted === 0 ? 'pass' : 'fail'), gapKeys: ['unaccepted'] };
    },
  },
  {
    id: 'CTL-CTX-03',
    title: 'Structured context profile complete',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const p = i.entry.contextProfile ?? {};
      const fields: string[] = i.opts.fields ?? ['intendedUsers', 'knownLimitations', 'outOfScopeUses', 'oversightPattern', 'costOfErrors'];
      const missing = fields.filter((f) => {
        const v = p[f];
        return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
      });
      return outcome(missing.length === 0, { missing: missing.join(', '), fields: fields.join(', ') });
    },
  },
  {
    id: 'CTL-NONE',
    title: 'No obligations beyond general guidelines (minimal risk)',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: () => outcome(true),
  },
];

/** EU AI Act tier from the functional area (resolved high-risk domains) and model type. */
export function euRiskTier(entry: { functionalArea: string; modelType: ModelType }, highRiskDomains: string[]): string {
  const fa = (entry.functionalArea || '').toLowerCase();
  if (highRiskDomains.includes(fa)) return 'High Risk';
  if (entry.modelType === ModelType.GENERATIVE_AI || fa.includes('chatbot')) return 'Limited Risk';
  return 'Minimal Risk';
}
