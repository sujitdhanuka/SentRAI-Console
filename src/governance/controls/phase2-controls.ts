/**
 * Phase 2 controls (E2.1 to E2.8). Each reads register-backed facts that the
 * Phase 2 services add to ctx.governance (MODEL scope) or ctx.org (ORG
 * scope). When a fact is missing, the feature that supplies it is switched
 * off, so the control reports NOT ASSESSED: it never passes on missing data
 * and never blocks.
 *
 * MODEL facts (ctx.governance):
 *   auDta        { inScope, assessedAt, usagePattern, domain, ownerNamed, reportedToDta, lastReviewAt }
 *   usPolicy     { highImpact, determined }
 *   adverseAction{ applicable, mapped, unmappedTopFeatures, notices, inconsistent, minRetentionMonths, requiredRetentionMonths }
 *   appeals      { open, overdue, decided, correctionPath }
 *   validation   { inScope, exclusionReason, status, result, independent, expiresAt, exceptionUntil, overdueFindings, vendorModel }
 *   fairLending  { applicable, proxyHits, disparateImpact, ldaSearch, minRatio }
 *   vendors      { components, unassessed, unsatisfactory, stale, exitedInUse, highWithoutExit, contractGaps, unknownLicences, restrictedLicences }
 *   datasets     { linked, missingLawfulBasis, missingProvenance, pendingDeletion }
 *   redTeam      { requiredSince, reason, satisfied }
 * ORG facts (ctx.org):
 *   training     { mandatoryCourses, staff, compliant, overdue, topics: { [topic]: { courses, completed } } }
 *   accountableOfficial  boolean
 *   dtaRegister  { lastSharedAt, intervalMonths, overdue }
 *   frameworkReview { lastReviewAt, intervalMonths, overdue }
 */
import { ControlDefinition, ControlInput, ControlOutcome } from './control.types';

const out = (passed: boolean, facts: Record<string, any> = {}, key?: string, evidence = ''): ControlOutcome => {
  const k = key ?? (passed ? 'pass' : 'fail');
  // A failing outcome selects the gap text keyed by its outcome key (packs with keyed gaps).
  return { passed, key: k, facts, evidence, gapKeys: passed ? [] : [k] };
};
const notAssessed = (what: string): ControlOutcome => ({
  ...out(false, { what }, 'not_assessed', `NOT ASSESSED: ${what} is not switched on`),
  notAssessed: true,
  gapKeys: ['not_assessed'],
});
const day = (d: any) => (d ? String(d).slice(0, 10) : null);
const gov = (i: ControlInput, k: string) => i.ctx.governance?.[k];

export const PHASE2_CONTROLS: ControlDefinition[] = [
  /* ------------------------------------------------------- E2.1 Australia */
  {
    id: 'CTL-AU-INSCOPE',
    title: 'In-scope test (DTA Appendix C) documented for the use case',
    scope: 'MODEL',
    evidenceTypes: ['impact_assessment'],
    parameters: [],
    evaluate: (i) => {
      const au = gov(i, 'auDta');
      if (!au) return notAssessed('the Australia pack');
      if (au.inScope === null || au.inScope === undefined) return { ...out(false, {}, 'missing'), gapKeys: ['missing'] };
      return out(true, { in_scope: au.inScope ? 'in scope' : 'out of scope', assessed_at: day(au.assessedAt) ?? 'unknown date' });
    },
  },
  {
    id: 'CTL-AU-USAGE',
    title: 'DTA usage pattern and domain classified (Appendix D)',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const p = i.entry.contextProfile ?? {};
      const missing = [!p.dtaUsagePattern && 'usage pattern', !p.dtaDomain && 'domain'].filter(Boolean);
      return out(missing.length === 0, { usage_pattern: p.dtaUsagePattern ?? null, domain: p.dtaDomain ?? null, missing: missing.join(' and ') });
    },
  },
  {
    id: 'CTL-AU-REG',
    title: 'Use case on the AI register with risk rating and accountable owner',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const au = gov(i, 'auDta');
      if (!au) return notAssessed('the Australia pack');
      const missing: string[] = [];
      if (!au.ownerNamed) missing.push('a named accountable use case owner');
      if (!i.entry.riskLevel) missing.push('a risk rating');
      if (au.inScope === null || au.inScope === undefined) missing.push('the in-scope flag');
      return out(missing.length === 0, { missing: missing.join(', '), risk: i.entry.riskLevel });
    },
  },
  {
    id: 'CTL-AU-DTA-REPORT',
    title: 'High-risk use case reported to the DTA through the accountable official',
    scope: 'MODEL',
    evidenceTypes: ['regulatory_submission'],
    parameters: [],
    evaluate: (i) => {
      const au = gov(i, 'auDta');
      if (!au) return notAssessed('the Australia pack');
      return out(Boolean(au.reportedToDta), { reported_at: day(au.reportedToDta) });
    },
  },
  {
    id: 'CTL-AU-REVIEW',
    title: 'High-risk use case reviewed within the review interval',
    scope: 'MODEL',
    evidenceTypes: ['impact_assessment'],
    parameters: [],
    evaluate: (i) => {
      const au = gov(i, 'auDta');
      if (!au) return notAssessed('the Australia pack');
      const months = Number(au.reviewMonths ?? 12);
      if (!au.lastReviewAt) return { ...out(false, { months }, 'missing'), gapKeys: ['missing'] };
      const ageDays = Math.floor((i.now.getTime() - new Date(au.lastReviewAt).getTime()) / 86_400_000);
      const ok = ageDays <= Math.round(months * 30.44);
      return { ...out(ok, { last_review: day(au.lastReviewAt), months, age_days: ageDays }, ok ? 'pass' : 'stale'), gapKeys: ok ? [] : ['stale'] };
    },
  },
  {
    id: 'CTL-OWNER-01',
    title: 'Named accountable owner (a person, not only a team)',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const au = gov(i, 'auDta') ?? gov(i, 'usPolicy');
      if (!au) return notAssessed('the region pack');
      return out(Boolean(au.ownerNamed), { owner: au.ownerNamed ?? null });
    },
  },

  /* ------------------------------------------------------------ E2.2 US kit */
  {
    id: 'CTL-US-HIGHIMPACT',
    title: 'High-impact determination recorded (OMB M-25-21)',
    scope: 'MODEL',
    evidenceTypes: ['impact_assessment'],
    parameters: [],
    evaluate: (i) => {
      const us = gov(i, 'usPolicy');
      if (!us) return notAssessed('the US pack');
      if (!us.determined) return { ...out(false, {}, 'missing'), gapKeys: ['missing'] };
      return out(true, { determination: us.highImpact ? 'high impact' : 'not high impact' });
    },
  },
  {
    id: 'CTL-AA-01',
    title: 'Adverse-action reasons mapped and matching the decision factors',
    scope: 'MODEL',
    evidenceTypes: ['adverse_action_notice'],
    parameters: [],
    evaluate: (i) => {
      const aa = gov(i, 'adverseAction');
      if (!aa) return notAssessed('the adverse-action kit');
      if (!aa.applicable) return out(true, {}, 'not_applicable');
      const gapKeys: string[] = [];
      if (!aa.mapped) gapKeys.push('no_map');
      else if ((aa.unmappedTopFeatures ?? []).length) gapKeys.push('unmapped');
      if (aa.inconsistent > 0) gapKeys.push('inconsistent');
      const facts = { mapped: aa.mapped ?? 0, unmapped: (aa.unmappedTopFeatures ?? []).join(', '), notices: aa.notices ?? 0, inconsistent: aa.inconsistent ?? 0 };
      return { ...out(gapKeys.length === 0, facts), gapKeys };
    },
  },
  {
    id: 'CTL-AA-02',
    title: 'Decision records kept for the required retention period',
    scope: 'MODEL',
    evidenceTypes: ['adverse_action_notice'],
    parameters: [],
    evaluate: (i) => {
      const aa = gov(i, 'adverseAction');
      if (!aa) return notAssessed('the adverse-action kit');
      if (!aa.applicable) return out(true, {}, 'not_applicable');
      const required = Number(aa.requiredRetentionMonths ?? 25);
      const shortest = aa.minRetentionMonths;
      const ok = shortest === null || shortest === undefined || shortest >= required;
      return out(ok, { required, shortest: shortest ?? 'no notices yet' });
    },
  },
  {
    id: 'CTL-APPEAL-01',
    title: 'Appeal, human reconsideration and data correction handled on time',
    scope: 'MODEL',
    evidenceTypes: ['decision_appeal'],
    parameters: [],
    evaluate: (i) => {
      const ap = gov(i, 'appeals');
      if (!ap) return notAssessed('the appeals workflow');
      return out(ap.overdue === 0, { open: ap.open, overdue: ap.overdue, decided: ap.decided });
    },
  },

  /* ------------------------------------------------------ E2.3 validation */
  {
    id: 'CTL-VAL-SCOPE',
    title: 'Model-risk (SR 26-2) scope decided, with a reason for any exclusion',
    scope: 'MODEL',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const v = gov(i, 'validation');
      if (!v) return notAssessed('model validation');
      if (v.inScope === null || v.inScope === undefined) return { ...out(false, {}, 'missing'), gapKeys: ['missing'] };
      return out(true, { in_scope: v.inScope ? 'in scope' : `excluded: ${v.exclusionReason}` }, v.inScope ? 'pass' : 'excluded');
    },
  },
  {
    id: 'CTL-VAL-01',
    title: 'Independent validation current (or a temporary-use exception in date)',
    scope: 'MODEL',
    evidenceTypes: ['validation_report'],
    parameters: [],
    evaluate: (i) => {
      const v = gov(i, 'validation');
      if (!v) return notAssessed('model validation');
      if (v.inScope === false) return out(true, { reason: v.exclusionReason }, 'excluded');
      const facts = { status: v.status ?? 'none', result: v.result ?? null, expires: day(v.expiresAt), exception_until: day(v.exceptionUntil) };
      const current = v.status === 'COMPLETED' && v.independent && v.result !== 'REJECTED' && (!v.expiresAt || new Date(v.expiresAt) > i.now);
      if (current) return out(true, facts);
      if (v.exceptionUntil && new Date(v.exceptionUntil) > i.now) return out(true, facts, 'exception');
      const key = !v.status ? 'missing' : v.status === 'COMPLETED' && !v.independent ? 'not_independent' : v.result === 'REJECTED' ? 'rejected' : v.status === 'COMPLETED' ? 'expired' : 'missing';
      return { ...out(false, facts, key), gapKeys: [key] };
    },
  },
  {
    id: 'CTL-VAL-02',
    title: 'Validation findings tracked to closure (effective challenge)',
    scope: 'MODEL',
    evidenceTypes: ['corrective_action'],
    parameters: [],
    evaluate: (i) => {
      const v = gov(i, 'validation');
      if (!v) return notAssessed('model validation');
      return out((v.overdueFindings ?? 0) === 0, { overdue: v.overdueFindings ?? 0 });
    },
  },

  /* ---------------------------------------------------- E2.4 fair lending */
  {
    id: 'CTL-FL-01',
    title: 'No prohibited basis or unjustified proxy among model inputs',
    scope: 'MODEL',
    evidenceTypes: ['proxy_scan'],
    parameters: [],
    evaluate: (i) => {
      const f = gov(i, 'fairLending');
      if (!f) return notAssessed('fair-lending checks');
      if (!f.applicable) return out(true, {}, 'not_applicable');
      if (!f.scannedAt) return out(false, {}, 'no_scan');
      const hits = (f.proxyHits ?? []).filter((h: any) => !h.justified);
      return out(hits.length === 0, { hits: hits.map((h: any) => `${h.feature} (${h.basis})`).join(', '), scanned: f.scanned ?? 0 });
    },
  },
  {
    id: 'CTL-FL-02',
    title: 'Disparate-impact test above threshold, and alternatives searched',
    scope: 'MODEL',
    evidenceTypes: ['disparate_impact', 'lda_search'],
    parameters: ['fairnessRatioMin'],
    evaluate: (i) => {
      const f = gov(i, 'fairLending');
      if (!f) return notAssessed('fair-lending checks');
      if (!f.applicable) return out(true, {}, 'not_applicable');
      const min = Number(i.params.values.fairnessRatioMin ?? 0.8);
      const gapKeys: string[] = [];
      const ratio = f.disparateImpact?.ratio;
      if (ratio === undefined || ratio === null) gapKeys.push('no_test');
      else if (Number(ratio) < min) gapKeys.push('below');
      if (!f.ldaSearch) gapKeys.push('no_lda');
      return { ...out(gapKeys.length === 0, { ratio: ratio ?? 'none', min }), gapKeys };
    },
  },

  /* ------------------------------------------------------- E2.5 vendors */
  {
    // Upstream versions are tracked by hand in the BOM (discovery does not re-read repositories), so a stale version is not detected here.
    id: 'CTL-VENDOR-01',
    title: 'Third-party components assessed, licensed and covered by contract terms',
    scope: 'MODEL',
    evidenceTypes: ['vendor_assessment'],
    parameters: [],
    evaluate: (i) => {
      const v = gov(i, 'vendors');
      if (!v) return notAssessed('the vendor register');
      if (!v.components) return out(true, {}, 'no_third_party');
      const gapKeys: string[] = [];
      if (v.unassessed) gapKeys.push('unassessed');
      if (v.unsatisfactory) gapKeys.push('unsatisfactory');
      if (v.stale) gapKeys.push('stale');
      if (v.exitedInUse) gapKeys.push('exited');
      if (i.opts.contract && v.contractGaps) gapKeys.push('contract');
      if (v.highWithoutExit) gapKeys.push('exit');
      if (v.restrictedLicences || v.unknownLicences) gapKeys.push('licence');
      return { ...out(gapKeys.length === 0, { ...v }), gapKeys };
    },
  },

  /* ------------------------------------------------------- E2.7 datasets */
  {
    id: 'CTL-DATA-02',
    title: 'Training and evaluation data registered with lawful basis, provenance and retention',
    scope: 'MODEL',
    evidenceTypes: ['dataset'],
    parameters: [],
    evaluate: (i) => {
      const d = gov(i, 'datasets');
      if (!d) return notAssessed('the data register');
      const gapKeys: string[] = [];
      if (!d.linked) gapKeys.push('none');
      if (d.missingLawfulBasis) gapKeys.push('lawful_basis');
      if (d.missingProvenance) gapKeys.push('provenance');
      if (d.pendingDeletion) gapKeys.push('deletion');
      return { ...out(gapKeys.length === 0, { ...d }), gapKeys };
    },
  },

  /* ------------------------------------------------------- E2.8 red team */
  {
    id: 'CTL-RT-02',
    title: 'Red team done after a risk escalation and before go-live for high-risk systems',
    scope: 'MODEL',
    evidenceTypes: ['red_team'],
    parameters: [],
    evaluate: (i) => {
      const r = gov(i, 'redTeam');
      if (!r) return notAssessed('the red-team rules');
      return out(Boolean(r.satisfied), { required_since: day(r.requiredSince), reason: r.reason ?? '' }, r.satisfied ? 'pass' : r.requiredSince ? 'escalation' : 'missing');
    },
  },

  /* --------------------------------------------------------- ORG controls */
  {
    id: 'CTL-ORG-TRAINING',
    title: 'Mandatory AI training completed and in date',
    scope: 'ORG',
    evidenceTypes: ['training_record'],
    parameters: [],
    evaluate: (i) => {
      const t = i.ctx.org?.training;
      if (!t) return notAssessed('training records');
      if (i.opts.topic) {
        const tp = t.topics?.[i.opts.topic];
        if (!tp || !tp.courses) return out(false, { topic: i.opts.topic }, 'missing');
        return out(tp.completed > 0 && tp.overdue === 0, { completed: tp.completed, overdue: tp.overdue });
      }
      if (!t.mandatoryCourses) return out(false, {}, 'missing');
      return out(t.overdue === 0, { staff: t.staff, compliant: t.compliant, overdue: t.overdue });
    },
  },
  {
    id: 'CTL-ORG-ACCOUNTABLE',
    title: 'Accountable official designated',
    scope: 'ORG',
    evidenceTypes: [],
    parameters: [],
    evaluate: (i) => {
      const a = i.ctx.org?.accountableOfficial;
      if (a === undefined) return notAssessed('accountability');
      return out(Boolean(a));
    },
  },
  {
    id: 'CTL-ORG-DTA-REGISTER',
    title: 'AI use case register shared with the DTA on schedule',
    scope: 'ORG',
    evidenceTypes: ['regulatory_submission'],
    parameters: [],
    evaluate: (i) => {
      const r = i.ctx.org?.dtaRegister;
      if (!r) return notAssessed('the Australia pack');
      if (!r.lastSharedAt) return out(false, { months: r.intervalMonths }, 'missing');
      return out(!r.overdue, { last_shared: day(r.lastSharedAt), months: r.intervalMonths }, r.overdue ? 'overdue' : 'pass');
    },
  },
  {
    id: 'CTL-ORG-FRAMEWORK-REVIEW',
    title: 'AI governance framework reviewed within the review cycle',
    scope: 'ORG',
    evidenceTypes: ['aims_record'],
    parameters: [],
    evaluate: (i) => {
      const r = i.ctx.org?.frameworkReview;
      if (!r) return notAssessed('the framework review rule');
      if (!r.lastReviewAt) return out(false, { months: r.intervalMonths }, 'missing');
      return out(!r.overdue, { last_review: day(r.lastReviewAt), months: r.intervalMonths }, r.overdue ? 'overdue' : 'pass');
    },
  },
];
