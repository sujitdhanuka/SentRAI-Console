/**
 * EU AI Act controls (E5.1). Each reads the facts the EU workspace adds to
 * ctx.governance.euAct (MODEL scope) or ctx.org.euAct (ORG scope). The facts
 * exist only while GOV_E5_1_EU_ACT is on and the organisation has the EU AI
 * Act pack enabled; otherwise the control reports NOT ASSESSED: never a pass,
 * never blocking. Pack clauses with requiresFact "euAct" are skipped in that
 * case, so organisations without the EU pack see no change.
 */
import { ControlDefinition, ControlInput, ControlOutcome } from './control.types';

const out = (passed: boolean, facts: Record<string, any> = {}, key?: string): ControlOutcome => {
  const k = key ?? (passed ? 'pass' : 'fail');
  return { passed, key: k, facts, evidence: '', gapKeys: passed ? [] : [k] };
};
const notAssessed = (): ControlOutcome => ({
  ...out(false, { what: 'the EU AI Act workspace' }, 'not_assessed'),
  evidence: 'NOT ASSESSED: the EU AI Act workspace is not switched on for this organisation',
  notAssessed: true,
  gapKeys: ['not_assessed'],
});
/** Not applicable to this system: reported, not counted as a gap. */
const notApplicable = (why: string): ControlOutcome => ({ ...out(true, { why }, 'not_applicable'), notAssessed: true, gapKeys: [] });
const eu = (i: ControlInput) => i.ctx.governance?.euAct as Record<string, any> | undefined;
const list = (xs: string[] | undefined) => (xs ?? []).join('; ');
/** Pass when nothing is missing; the gap names what is. */
const missingCheck = (missing: string[] | undefined, passFacts: Record<string, any> = {}) =>
  missing?.length ? out(false, { missing: list(missing), count: missing.length }, 'missing') : out(true, passFacts);

function control(id: string, title: string, evaluate: (e: Record<string, any>, i: ControlInput) => ControlOutcome, evidenceTypes: string[] = []): ControlDefinition {
  return {
    id, title, scope: 'MODEL', evidenceTypes, parameters: [],
    evaluate: (i) => {
      const e = eu(i);
      if (!e) return notAssessed();
      // A system recorded as outside the Act (Art. 2) carries no EU duties beyond the scope record itself.
      if (e.inScope === false && id !== 'CTL-EU-SCOPE') return notApplicable('outside the scope of the EU AI Act (Art. 2)');
      return evaluate(e, i);
    },
  };
}

export const EU_CONTROLS: ControlDefinition[] = [
  control('CTL-EU-SCOPE', 'EU scope decided and operator role recorded (Art. 2–3)', (e) => {
    if (!e.roles?.length) return out(false, {}, 'no_role');
    if (!e.scopeDecided) return out(false, {}, 'no_scope');
    return out(true, { roles: e.roles.join(', ').toLowerCase(), in_scope: e.inScope ? 'in scope' : 'out of scope' });
  }),
  control('CTL-EU-ART5', 'Prohibited-practice screening signed and clear (Art. 5)', (e) => {
    if (!e.art5?.signed) return out(false, { unanswered: e.art5?.unanswered?.length ?? 8 }, 'unsigned');
    if (e.art5.prohibited?.length) return out(false, { practices: list(e.art5.prohibited) }, 'prohibited');
    return out(true, { signed_by: e.art5.signedBy, signed_at: String(e.art5.signedAt ?? '').slice(0, 10) });
  }),
  control('CTL-EU-CLASS', 'Annex III / Annex I classification signed (Art. 6)', (e) => {
    if (!e.classification?.signed) return out(false, { hint: e.hint }, 'unsigned');
    return out(true, { tier: e.tier, basis: e.basis });
  }),
  control('CTL-EU-ANNEX4', 'Technical documentation complete in the Annex IV layout (Art. 11)', (e) =>
    e.annexIV?.score === 100 ? out(true, { score: 100 }) : out(false, { score: e.annexIV?.score ?? 0, missing: list(e.annexIV?.missing) }, 'missing'), ['technical_documentation']),
  control('CTL-EU-INSTRUCTIONS', 'Instructions for use for deployers complete (Art. 13)', (e) => missingCheck(e.instructions?.missing)),
  control('CTL-EU-PROVIDER', 'Provider name and contact on the system; accessibility evidenced (Art. 16)', (e) => missingCheck(e.provider?.missing)),
  control('CTL-EU-RETENTION', 'Technical documentation kept 10 years from placing on the market (Art. 18)', (e) => {
    if (!e.retention?.applies) return notApplicable('no documents or market date recorded');
    return e.retention.short?.length ? out(false, { documents: list(e.retention.short) }, 'short') : out(true, { until: e.retention.until });
  }),
  control('CTL-EU-CORRECTIVE', 'Non-conformity acted on and the right parties informed (Art. 20)', (e) => {
    if (e.nonconformity?.open) return out(false, { open: e.nonconformity.open }, 'open');
    if (e.nonconformity?.informPending) return out(false, { pending: e.nonconformity.informPending }, 'not_informed');
    return out(true, { closed: e.nonconformity?.closed ?? 0 });
  }),
  control('CTL-EU-VERIFY', 'Importer or distributor checks done before making the system available (Art. 23–24)', (e) => missingCheck(e.verification?.missing)),
  control('CTL-EU-VALUECHAIN', 'Material changes assessed for substantial modification or change of purpose (Art. 25)', (e) =>
    e.valueChain?.open ? out(false, { open: e.valueChain.open }, 'open') : out(true, { assessed: e.valueChain?.assessed ?? 0 })),
  control('CTL-EU-DEPLOYER', 'Deployer duties: input data, workers informed, persons informed (Art. 26)', (e) => missingCheck(e.deployer?.missing)),
  control('CTL-EU-FRIA', 'Fundamental rights impact assessment signed and the authority notified (Art. 27)', (e) => {
    if (!e.fria?.required) return notApplicable('no FRIA required for this deployer');
    if (!e.fria.signed) return out(false, {}, 'no_fria');
    if (!e.fria.notified) return out(false, {}, 'not_notified');
    return out(true, { notified_at: e.fria.notifiedAt });
  }, ['impact_assessment']),
  control('CTL-EU-CONFORMITY', 'Conformity assessment passed and current (Art. 43, Annex VI / VII)', (e) => {
    const c = e.conformity ?? {};
    if (c.status === 'PASSED') return out(true, { route: c.route, at: c.at });
    if (c.status === 'REASSESSMENT_DUE') return out(false, {}, 'reassess');
    if (c.problem) return out(false, { problem: c.problem }, 'route');
    return out(false, { status: (c.status ?? 'NONE').toLowerCase() }, 'missing');
  }),
  control('CTL-EU-DECLARATION', 'EU declaration of conformity issued and current (Art. 47, Annex V)', (e) => {
    if (!e.declaration?.issued) return out(false, {}, 'missing');
    if (e.declaration.stale) return out(false, {}, 'stale');
    return out(true, { issued_at: e.declaration.issuedAt });
  }),
  control('CTL-EU-CE', 'CE marking affixed after the declaration (Art. 48)', (e) => {
    if (!e.ce?.affixed) return out(false, {}, 'missing');
    if (e.ce.problem) return out(false, { problem: e.ce.problem }, 'problem');
    return out(true, { form: e.ce.form, at: e.ce.at });
  }),
  control('CTL-EU-REGISTRATION', 'Registered in the EU database before placing on the market or use (Art. 49, 26(8))', (e) => {
    if (!e.registration?.required?.length) return notApplicable('no Annex VIII section applies');
    return e.registration.missing?.length
      ? out(false, { sections: e.registration.missing.join(', ') }, 'missing')
      : out(true, { sections: e.registration.required.join(', ') });
  }),
  control('CTL-EU-ART50', 'Transparency: AI interaction notice, output marking and deployer disclosures (Art. 50)', (e) => missingCheck(e.art50?.missing)),
  control('CTL-EU-GPAI', 'General-purpose AI documentation, copyright policy and training summary (Art. 53)', (e) => {
    if (!e.gpai?.applies) return notApplicable('no general-purpose AI model provided or used');
    return missingCheck(e.gpai.missing);
  }),
  control('CTL-EU-RWT', 'Real-world testing plans approved, registered and with consent (Art. 60–61)', (e) => {
    if (!e.rwt?.plans) return notApplicable('no real-world testing recorded');
    return missingCheck(e.rwt.missing, { plans: e.rwt.plans });
  }),
  control('CTL-EU-PMM', 'Written post-market monitoring plan, reviewed on schedule (Art. 72)', (e) => {
    if (e.pmm?.missing?.length) return out(false, { missing: list(e.pmm.missing) }, 'missing');
    if (e.pmm?.reviewOverdue) return out(false, { last: e.pmm.lastReviewAt ?? 'never' }, 'overdue');
    return out(true, { every: e.pmm?.frequency });
  }),
  control('CTL-EU-INCIDENT', 'Serious incidents classified and reported within 2, 10 or 15 days (Art. 73, 26(5))', (e) => {
    const x = e.incidents ?? {};
    if (x.overdue) return out(false, { overdue: x.overdue }, 'overdue');
    if (x.problems?.length) return out(false, { problems: list(x.problems) }, 'problems');
    return out(true, { serious: x.serious ?? 0 });
  }),
  control('CTL-EU-EXPLANATION', 'Requests for an explanation of a decision answered (Art. 86)', (e) => {
    if (e.explanations?.overdue) return out(false, { overdue: e.explanations.overdue }, 'overdue');
    return out(true, { answered: e.explanations?.answered ?? 0, open: e.explanations?.open ?? 0 });
  }),
  control('CTL-EU-DATA', 'Data representativeness, known gaps and Art. 10(5) safeguards recorded (Art. 10)', (e) => missingCheck(e.data?.missing), ['dataset']),
  {
    id: 'CTL-EU-ORG',
    title: 'Authorised representative where needed; log retention at least six months (Art. 19, 22, 26(6))',
    scope: 'ORG',
    evidenceTypes: [],
    parameters: ['logRetentionMonths'],
    evaluate: (i) => {
      const o = i.ctx.org?.euAct;
      if (!o) return notAssessed();
      const min = Number(i.params.values.logRetentionMonths ?? 6);
      const missing: string[] = [];
      if (o.authRepRequired && !o.authRep) missing.push('authorised representative (Art. 22)');
      const ret = o.logRetention ?? {};
      for (const store of o.logStores ?? []) {
        const v = Number(ret[store]);
        if (!Number.isFinite(v) || v <= 0) missing.push(`${store} log retention`);
        else if (v < min) missing.push(`${store} logs kept ${v} months, below ${min}`);
      }
      return missingCheck(missing, { min });
    },
  },
];
