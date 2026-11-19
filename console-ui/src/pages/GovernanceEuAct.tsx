/**
 * EU AI Act workspace (E5.1). Shown only while GOV_E5_1_EU_ACT is on, and it
 * works only for organisations that enable the EU AI Act pack in Settings.
 * Per AI system: scope and operator role, the Art. 5 screening, the Annex III
 * classification, Annex IV documentation, conformity, declaration, CE marking,
 * EU database registration, transparency and deployer duties, Art. 73
 * incidents, Art. 86 explanations and the value-chain records.
 */
import { Download, FileCheck2, PenLine, Plus, Save } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';

import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { fieldClass as FIELD, labelClass as LABEL } from '../components/ui/form';
import { day, download, Field, ModelSelect, post, Table, useLoad, useToastCall, Writable } from './GovernancePhase2';
import { governanceHref, useGovernanceModel } from './governanceTabs';

const BASE = '/governance/eu';
type Spec = 'bool' | 'text' | 'longtext' | 'date' | 'int' | 'list' | string[];

const TIER_TONE: Record<string, BadgeTone> = { Prohibited: 'negative', 'High Risk': 'warning', 'Limited Risk': 'accent', 'Minimal Risk': 'positive' };
const STATUS_TONE: Record<string, BadgeTone> = {
  COMPLETE: 'positive', PARTIAL: 'warning', MISSING: 'negative', PASSED: 'positive', FAILED: 'negative', DRAFT: 'neutral', REASSESSMENT_DUE: 'warning',
  SUPERSEDED: 'neutral', ISSUED: 'positive', REGISTERED: 'positive', OPEN: 'warning', ACTIONED: 'accent', CLOSED: 'positive', RECEIVED: 'warning',
  ANSWERED: 'positive', PROVIDER_DUTIES: 'warning', NOT_SUBSTANTIAL: 'positive', PLANNED: 'neutral',
};
const st = (s: string | null | undefined) => <Badge tone={STATUS_TONE[String(s ?? '')] ?? 'neutral'}>{String(s ?? '—').toLowerCase().replace(/_/g, ' ')}</Badge>;
const human = (s: string) => s.toLowerCase().replace(/_/g, ' ');

/** Labels for the profile fields the forms show (the server validates every one). */
const LABELS: Record<string, string> = {
  'scope.placedOnEuMarket': 'Placed on the EU market or put into service in the EU',
  'scope.outputUsedInEu': 'Output used in the EU (provider or deployer outside the EU)',
  'scope.exclusion': 'Art. 2 exclusion that applies',
  'scope.note': 'Scope note',
  'provider.name': 'Provider name (Art. 16(b))',
  'provider.address': 'Provider postal address',
  'provider.contact': 'Provider contact',
  'provider.establishedInEu': 'Provider established in the EU (no: an authorised representative is needed, Art. 22)',
  'market.status': 'Market status',
  'market.placedOnMarketAt': 'Placed on the market on',
  'market.memberStates': 'Member States (comma-separated)',
  'market.tradeName': 'Trade name',
  'market.publicAuthorityDeployer': 'Used by or on behalf of a public authority (Art. 49(3))',
  'market.legacyBeforeAug2026': 'On the market before 2 Aug 2026 (covered after a significant change, Art. 111)',
  'accessibility.applies': 'Accessibility requirements apply (Directives 2016/2102, 2019/882)',
  'accessibility.evidenceRef': 'Accessibility evidence reference',
  'annexIV.designChoices': 'Design choices and rationale (Annex IV(2)(b))',
  'annexIV.architecture': 'System architecture (Annex IV(2)(c))',
  'annexIV.computeResources': 'Computational resources used to develop, train and test',
  'annexIV.predeterminedChanges': 'Pre-determined changes (Annex IV(2)(f))',
  'annexIV.cybersecurity': 'Cybersecurity measures (Art. 15)',
  'annexIV.standardsApplied': 'Harmonised standards or specifications applied (comma-separated)',
  'annexIV.harmonisedFullyApplied': 'Harmonised standards fully applied',
  'annexIV.technicalDocumentationDocId': 'Controlled document id: technical documentation',
  'annexIV.qmsDocId': 'Controlled document id: QMS documentation',
  'instructions.declaredAccuracy': 'Declared accuracy metrics and levels (Art. 13(3)(b)(ii))',
  'instructions.expectedLifetime': 'Expected lifetime',
  'instructions.computeNeeds': 'Computational and hardware needs',
  'instructions.maintenance': 'Maintenance and care measures, update frequency',
  'instructions.inputSpecification': 'Input data specification',
  'instructions.logging': 'Logging mechanisms for deployers (Art. 12)',
  'pmm.dataCollected': 'Post-market monitoring: data collected',
  'pmm.metrics': 'Post-market monitoring: metrics and thresholds',
  'pmm.reviewFrequencyMonths': 'Plan review every (months)',
  'pmm.owner': 'Plan owner',
  'pmm.lastReviewAt': 'Last plan review',
  'data.representativeness': 'Representativeness of training, validation and test data',
  'data.statisticalProperties': 'Statistical properties',
  'data.knownGaps': 'Known data gaps or shortcomings',
  'data.specialCategoryUsed': 'Special-category data processed for bias detection (Art. 10(5))',
  'data.specialCategory.purpose': 'Art. 10(5) purpose and necessity',
  'data.specialCategory.pseudonymisation': 'Pseudonymisation and technical limits on re-use',
  'data.specialCategory.accessControls': 'Access controls and documentation',
  'data.specialCategory.deleteBy': 'Deleted by',
  'ce.affixedAt': 'CE marking affixed on',
  'ce.form': 'CE marking form',
  'ce.notifiedBodyNumber': 'Notified body identification number',
  'art50.interactsWithPersons': 'Interacts directly with natural persons',
  'art50.obviousToPersons': 'Obvious to a reasonably well-informed person that it is AI',
  'art50.noticeText': 'AI interaction notice text (Art. 50(1))',
  'art50.noticeEvidenceRef': 'Evidence the notice is shown (screenshot or reference)',
  'art50.syntheticOutputs': 'Generates synthetic audio, image, video or text',
  'art50.markingMethod': 'Machine-readable marking method (Art. 50(2))',
  'art50.markingTestResult': 'Marking detection test result',
  'art50.markingTestedAt': 'Marking tested on',
  'art50.emotionOrBiometricDeployer': 'Deploys emotion recognition or biometric categorisation',
  'art50.personsInformedRef': 'Notice to persons exposed (Art. 50(3)) reference',
  'art50.deepfakeOrPublicText': 'Publishes deep fakes or AI-generated text on matters of public interest',
  'art50.disclosureRef': 'Disclosure reference (Art. 50(4))',
  'deployer.controlsInputData': 'Deployer controls the input data (Art. 26(4))',
  'deployer.inputDatasetId': 'Input dataset id (data register)',
  'deployer.inputSuitability': 'Why the input data is relevant and representative',
  'deployer.inputCheckedAt': 'Input data checked on',
  'deployer.workplace': 'Used at the workplace (Art. 26(7))',
  'deployer.workersInformedAt': 'Workers’ representatives and workers informed on',
  'deployer.workersConsultationRef': 'Consultation record reference',
  'deployer.personNoticeTemplate': 'Notice to affected persons (Art. 26(11))',
  'deployer.personNoticeFirstSentAt': 'Notice first given on',
  'fria.required': 'FRIA required (public body, public service, credit or life and health insurance)',
  'fria.authorityNotifiedAt': 'Market surveillance authority notified of the FRIA on (Art. 27(3))',
  'fria.authority': 'Authority notified',
  'fria.reference': 'Notification reference',
  'gpai.isGpaiProvider': 'We provide a general-purpose AI model (Art. 53)',
  'gpai.annexXIDocRef': 'Annex XI technical documentation reference',
  'gpai.annexXIIDocRef': 'Annex XII information for downstream providers',
  'gpai.copyrightPolicyRef': 'Copyright policy reference',
  'gpai.trainingSummaryUrl': 'Public training-content summary URL',
  'gpai.usesUpstreamGpai': 'Built on an upstream GPAI model',
  'gpai.upstreamProvider': 'Upstream GPAI provider',
  'gpai.upstreamAnnexXIIRef': 'Upstream Annex XII information reference',
  'gpai.upstreamCopyrightUrl': 'Upstream copyright policy URL',
  'gpai.upstreamTrainingSummaryUrl': 'Upstream training summary URL',
  'verification.verifiedAt': 'Verified on',
  'verification.note': 'Verification note',
};

const GROUPS: Record<string, string[]> = {
  scope: ['scope.placedOnEuMarket', 'scope.outputUsedInEu', 'scope.exclusion', 'scope.note'],
  provider: ['provider.name', 'provider.address', 'provider.contact', 'provider.establishedInEu', 'accessibility.applies', 'accessibility.evidenceRef'],
  market: ['market.status', 'market.placedOnMarketAt', 'market.memberStates', 'market.tradeName', 'market.publicAuthorityDeployer', 'market.legacyBeforeAug2026'],
  annexIV: ['annexIV.designChoices', 'annexIV.architecture', 'annexIV.computeResources', 'annexIV.predeterminedChanges', 'annexIV.cybersecurity', 'annexIV.standardsApplied',
    'annexIV.harmonisedFullyApplied', 'annexIV.technicalDocumentationDocId', 'annexIV.qmsDocId'],
  instructions: ['instructions.declaredAccuracy', 'instructions.expectedLifetime', 'instructions.computeNeeds', 'instructions.maintenance', 'instructions.inputSpecification', 'instructions.logging'],
  pmm: ['pmm.dataCollected', 'pmm.metrics', 'pmm.reviewFrequencyMonths', 'pmm.owner', 'pmm.lastReviewAt'],
  data: ['data.representativeness', 'data.statisticalProperties', 'data.knownGaps', 'data.specialCategoryUsed', 'data.specialCategory.purpose',
    'data.specialCategory.pseudonymisation', 'data.specialCategory.accessControls', 'data.specialCategory.deleteBy'],
  ce: ['ce.affixedAt', 'ce.form', 'ce.notifiedBodyNumber'],
  art50: ['art50.interactsWithPersons', 'art50.obviousToPersons', 'art50.noticeText', 'art50.noticeEvidenceRef', 'art50.syntheticOutputs', 'art50.markingMethod',
    'art50.markingTestResult', 'art50.markingTestedAt', 'art50.emotionOrBiometricDeployer', 'art50.personsInformedRef', 'art50.deepfakeOrPublicText', 'art50.disclosureRef'],
  deployer: ['deployer.controlsInputData', 'deployer.inputDatasetId', 'deployer.inputSuitability', 'deployer.inputCheckedAt', 'deployer.workplace',
    'deployer.workersInformedAt', 'deployer.workersConsultationRef', 'deployer.personNoticeTemplate', 'deployer.personNoticeFirstSentAt'],
  fria: ['fria.required', 'fria.authorityNotifiedAt', 'fria.authority', 'fria.reference'],
  gpai: ['gpai.isGpaiProvider', 'gpai.annexXIDocRef', 'gpai.annexXIIDocRef', 'gpai.copyrightPolicyRef', 'gpai.trainingSummaryUrl', 'gpai.usesUpstreamGpai',
    'gpai.upstreamProvider', 'gpai.upstreamAnnexXIIRef', 'gpai.upstreamCopyrightUrl', 'gpai.upstreamTrainingSummaryUrl'],
};

const getPath = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

/* ------------------------------------------------------------ the tab */

export function EuActTab() {
  const call = useToastCall();
  const overview = useLoad<any>(BASE);
  const [modelId, setModelId] = useGovernanceModel();
  if (overview.error) return <PanelError onRetry={() => void overview.reload()} />;
  if (!overview.data) return <Skeleton className="h-64 w-full" />;
  const o = overview.data;
  if (!o.active) {
    return (
      <Panel title="EU AI Act">
        <div className="space-y-2 p-3 text-[11px] text-text-secondary">
          <p>The EU AI Act workspace applies only to organisations that enable the EU AI Act pack.</p>
          <p>
            Turn it on in <a className="text-accent underline" href={governanceHref('settings')}>Settings &amp; risk appetite</a> (Framework packs). Nothing here changes results for
            organisations that leave it off.
          </p>
        </div>
      </Panel>
    );
  }
  return (
    <div className="space-y-2">
      <Panel title="AI systems under the EU AI Act" right={<ModelSelect value={modelId} onChange={setModelId} />}>
        <Table
          head={['System', 'Operator role', 'EU tier', 'Still open', '']}
          empty="No models in this organisation yet."
          rows={(o.models ?? []).map((m: any) => [
            m.name,
            m.roles?.length ? m.roles.map(human).join(', ') : <span key="r" className="text-text-secondary">not recorded</span>,
            m.prohibited ? <Badge key="t" tone="negative">Art. 5 prohibited</Badge> : m.tier ? <Badge key="t" tone={TIER_TONE[m.tier] ?? 'neutral'}>{m.tier}</Badge> : <span key="t" className="text-text-secondary">hint: {m.hint ?? '—'}</span>,
            (m.open_items ?? []).join(', ') || '—',
            <Button key="o" size="xs" variant={modelId === m.model_id ? 'primary' : 'secondary'} onClick={() => setModelId(m.model_id)}>Open</Button>,
          ])}
        />
      </Panel>
      {modelId ? <ModelWorkspace key={modelId} modelId={modelId} onChange={() => void overview.reload()} /> : (
        <p className="px-2 text-[11px] text-text-secondary">Choose a system to record its EU scope, role, screening, classification and market-entry steps.</p>
      )}
      <OrgPanel o={o} call={call} reload={() => void overview.reload()} />
    </div>
  );
}

/* ----------------------------------------------------- organisation record */

function OrgPanel({ o, call, reload }: { o: any; call: ReturnType<typeof useToastCall>; reload: () => void }) {
  const rep = o.org?.authorised_rep ?? {};
  const [form, setForm] = useState({ name: rep.name ?? '', contact: rep.contact ?? '', mandate_ref: rep.mandateRef ?? '', mandate_date: rep.mandateDate ?? '' });
  const [retention, setRetention] = useState<Record<string, string>>(
    Object.fromEntries((o.reference?.log_stores ?? []).map((s: string) => [s, String(o.org?.log_retention?.[s] ?? '')])),
  );
  const facts = o.org?.facts;
  return (
    <Panel title="Organisation: authorised representative and log retention (Art. 19, 22, 26(6))">
      <Writable>
        <div className="space-y-2 p-2 text-[11px]">
          {facts?.authRepRequired && !facts.authRep && <p className="text-negative">A provider established outside the EU needs an authorised representative with a written mandate (Art. 22).</p>}
          <div className="grid gap-2 md:grid-cols-4">
            <Field label="Representative name"><input className={FIELD} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Contact"><input className={FIELD} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
            <Field label="Mandate document reference"><input className={FIELD} value={form.mandate_ref} onChange={(e) => setForm({ ...form, mandate_ref: e.target.value })} /></Field>
            <Field label="Mandate date"><input type="date" className={FIELD} value={form.mandate_date} onChange={(e) => setForm({ ...form, mandate_date: e.target.value })} /></Field>
          </div>
          <Button size="xs" onClick={() => void call(() => post(`${BASE}/org`, { authorised_rep: form }, 'PUT'), 'Representative saved', reload)}><Save size={12} /> Save representative</Button>
          <p className="pt-2 text-text-secondary">Log retention in months. The EU pack needs at least {o.log_retention_minimum_months} months for each store; a shorter value is refused.</p>
          <div className="grid gap-2 md:grid-cols-4">
            {Object.keys(retention).map((s) => (
              <Field key={s} label={`${s} (months)`}>
                <input type="number" min={1} className={FIELD} value={retention[s]} onChange={(e) => setRetention({ ...retention, [s]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Button size="xs" onClick={() => void call(() => post(`${BASE}/org`, { log_retention: Object.fromEntries(Object.entries(retention).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) }, 'PUT'), 'Retention saved', reload)}>
            <Save size={12} /> Save retention
          </Button>
        </div>
      </Writable>
    </Panel>
  );
}

/* ------------------------------------------------------- per-system record */

const SECTIONS = [
  { id: 'scope', label: 'Scope & role' },
  { id: 'art5', label: 'Article 5' },
  { id: 'class', label: 'Classification' },
  { id: 'docs', label: 'Documentation' },
  { id: 'conformity', label: 'Conformity & CE' },
  { id: 'registration', label: 'Registration' },
  { id: 'transparency', label: 'Transparency & deployer' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'ops', label: 'Changes, actions & requests' },
] as const;

function ModelWorkspace({ modelId, onChange }: { modelId: string; onChange: () => void }) {
  const ws = useLoad<any>(`${BASE}/models/${encodeURIComponent(modelId)}`);
  const [section, setSection] = useState<string>('scope');
  const call = useToastCall();
  if (ws.error) return <PanelError onRetry={() => void ws.reload()} />;
  if (!ws.data) return <Skeleton className="h-64 w-full" />;
  const d = ws.data;
  const reload = () => { void ws.reload(); onChange(); };
  const f = d.facts ?? {};
  const ctx: Ctx = { d, f, call, reload, modelId };
  return (
    <Panel
      title={`${d.model_name}: EU AI Act record`}
      right={
        <span className="flex items-center gap-1.5 text-[11px]">
          {f.art5?.prohibited?.length ? <Badge tone="negative">Art. 5 prohibited</Badge> : d.tier ? <Badge tone={TIER_TONE[d.tier] ?? 'neutral'}>{d.tier}</Badge> : <Badge tone="neutral">tier not set</Badge>}
          <span className="text-text-secondary">{d.tier_basis ?? ''}</span>
        </span>
      }
    >
      <div className="flex flex-wrap gap-1 border-b border-border p-2" role="tablist" aria-label="EU AI Act sections">
        {SECTIONS.map((s) => (
          <button key={s.id} role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}
            className={`rounded px-2 py-1 text-[11px] ${section === s.id ? 'bg-accent/15 text-text' : 'text-text-secondary hover:text-text'}`}>{s.label}</button>
        ))}
      </div>
      <div className="p-2">
        <Writable>
          {section === 'scope' ? <ScopeSection {...ctx} />
            : section === 'art5' ? <Art5Section {...ctx} />
              : section === 'class' ? <ClassificationSection {...ctx} />
                : section === 'docs' ? <DocsSection {...ctx} />
                  : section === 'conformity' ? <ConformitySection {...ctx} />
                    : section === 'registration' ? <RegistrationSection {...ctx} />
                      : section === 'transparency' ? <TransparencySection {...ctx} />
                        : section === 'incidents' ? <IncidentsSection {...ctx} />
                          : <OpsSection {...ctx} />}
        </Writable>
      </div>
    </Panel>
  );
}

type Ctx = { d: any; f: any; call: ReturnType<typeof useToastCall>; reload: () => void; modelId: string };

function Missing({ items, ok }: { items?: string[]; ok: string }) {
  if (!items?.length) return <p className="text-[11px] text-positive">{ok}</p>;
  return <p className="text-[11px] text-warning">Still missing: {items.join('; ')}</p>;
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-border/60 pb-3 pt-1 last:border-b-0">
      <h4 className={LABEL}>{title}</h4>
      {children}
    </section>
  );
}

/** A form over a group of profile fields; saves only what changed. */
function ProfileForm({ ctx, paths, title }: { ctx: Ctx; paths: string[]; title?: string }) {
  const spec = (ctx.d.reference?.profile_fields ?? {}) as Record<string, Spec>;
  const initial = useMemo(() => Object.fromEntries(paths.map((p) => [p, getPath(ctx.d.profile, p) ?? null])), [ctx.d.profile, paths]);
  const [vals, setVals] = useState<Record<string, any>>(initial);
  useEffect(() => setVals(initial), [initial]);
  const changed = paths.filter((p) => JSON.stringify(vals[p] ?? null) !== JSON.stringify(initial[p] ?? null));
  const set = (p: string, v: any) => setVals({ ...vals, [p]: v });
  return (
    <div className="space-y-2">
      {title && <p className="text-[11px] text-text-secondary">{title}</p>}
      <div className="grid gap-2 md:grid-cols-2">
        {paths.map((p) => {
          const s = spec[p];
          const label = LABELS[p] ?? human(p.split('.').pop()!);
          const v = vals[p];
          if (s === 'bool') {
            return (
              <Field key={p} label={label}>
                <select className={FIELD} value={v === true ? 'yes' : v === false ? 'no' : ''} onChange={(e) => set(p, e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              </Field>
            );
          }
          if (Array.isArray(s)) {
            return (
              <Field key={p} label={label}>
                <select className={FIELD} value={v ?? ''} onChange={(e) => set(p, e.target.value || null)}>
                  <option value="">—</option>
                  {s.map((o) => <option key={o} value={o}>{human(o)}</option>)}
                </select>
              </Field>
            );
          }
          if (s === 'longtext') return <Field key={p} label={label}><textarea rows={2} className={FIELD} value={v ?? ''} onChange={(e) => set(p, e.target.value)} /></Field>;
          if (s === 'date') return <Field key={p} label={label}><input type="date" className={FIELD} value={v ?? ''} onChange={(e) => set(p, e.target.value || null)} /></Field>;
          if (s === 'int') return <Field key={p} label={label}><input type="number" min={1} max={120} className={FIELD} value={v ?? ''} onChange={(e) => set(p, e.target.value === '' ? null : Number(e.target.value))} /></Field>;
          if (s === 'list') {
            return (
              <Field key={p} label={label}>
                <input className={FIELD} value={Array.isArray(v) ? v.join(', ') : v ?? ''} onChange={(e) => set(p, e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
              </Field>
            );
          }
          return <Field key={p} label={label}><input className={FIELD} value={v ?? ''} onChange={(e) => set(p, e.target.value)} /></Field>;
        })}
      </div>
      <Button size="xs" disabled={!changed.length}
        onClick={() => void ctx.call(() => post(`${BASE}/models/${ctx.modelId}/profile`, Object.fromEntries(changed.map((p) => [p, vals[p] === '' ? null : vals[p]])), 'PUT'), 'Saved', ctx.reload)}>
        <Save size={12} /> Save{changed.length ? ` (${changed.length})` : ''}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------- sections */

function ScopeSection(ctx: Ctx) {
  const { d, f } = ctx;
  const roles: string[] = d.reference?.roles ?? [];
  const [picked, setPicked] = useState<string[]>(d.profile?.roles ?? []);
  return (
    <div className="space-y-3">
      <Sub title="Operator role (Art. 3)">
        <p className="text-[11px] text-text-secondary">Only the clauses for the roles you hold apply. A substantial modification or a new high-risk purpose makes you the provider (Art. 25).</p>
        <div className="flex flex-wrap gap-3 text-[11px]">
          {roles.map((r) => (
            <label key={r} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={picked.includes(r)} onChange={(e) => setPicked(e.target.checked ? [...picked, r] : picked.filter((x) => x !== r))} />
              {human(r)}
            </label>
          ))}
        </div>
        <Button size="xs" onClick={() => void ctx.call(() => post(`${BASE}/models/${ctx.modelId}/profile`, { roles: picked }, 'PUT'), 'Roles saved', ctx.reload)}><Save size={12} /> Save roles</Button>
      </Sub>
      <Sub title="Scope (Art. 2)">
        <p className="text-[11px] text-text-secondary">{f.inScope === true ? 'In scope.' : f.inScope === false ? 'Out of scope.' : 'Scope not decided yet.'}</p>
        <ProfileForm ctx={ctx} paths={GROUPS.scope} />
      </Sub>
      <Sub title="Provider identity and accessibility (Art. 16)">
        <Missing items={f.provider?.missing} ok="Provider identity complete." />
        <ProfileForm ctx={ctx} paths={GROUPS.provider} />
      </Sub>
      <Sub title="Market facts (Art. 49, 111)"><ProfileForm ctx={ctx} paths={GROUPS.market} /></Sub>
    </div>
  );
}

function Art5Section(ctx: Ctx) {
  const { d } = ctx;
  const practices: any[] = d.reference?.art5_practices ?? [];
  const [answers, setAnswers] = useState<Record<string, { answer: string; exception: string }>>(
    Object.fromEntries(practices.map((p) => [p.key, { answer: d.art5?.answers?.[p.key]?.answer ?? '', exception: d.art5?.answers?.[p.key]?.exception ?? '' }])),
  );
  const r = d.art5?.result ?? {};
  const body = Object.fromEntries(Object.entries(answers).filter(([, a]) => a.answer).map(([k, a]) => [k, { answer: a.answer, ...(a.exception ? { exception: a.exception } : {}) }]));
  return (
    <div className="space-y-2 text-[11px]">
      <p className="text-text-secondary">
        Answer each of the eight Art. 5(1) practices. A yes without a recorded exception marks the system prohibited and the deploy gate blocks it in every gate mode.
        An officer signs the screening once every practice is answered. Changing an answer clears the signature.
      </p>
      <p>
        {r.signed ? <Badge tone="positive">signed by {r.signedBy} on {day(r.signedAt)}</Badge> : <Badge tone="warning">not signed</Badge>}{' '}
        {r.prohibited?.length ? <Badge tone="negative">prohibited: {r.prohibited.join(', ')}</Badge> : null}{' '}
        {r.unanswered?.length ? <span className="text-text-secondary">{r.unanswered.length} unanswered</span> : null}
      </p>
      <table className="w-full text-left">
        <tbody>
          {practices.map((p) => (
            <tr key={p.key} className="border-b border-border/60 align-top">
              <td className="px-2 py-1"><span className="text-text-secondary">{p.ref}</span> {p.label}</td>
              <td className="w-28 px-2 py-1">
                <select aria-label={p.ref} className={FIELD} value={answers[p.key]?.answer ?? ''} onChange={(e) => setAnswers({ ...answers, [p.key]: { ...answers[p.key], answer: e.target.value } })}>
                  <option value="">—</option><option value="NO">No</option><option value="YES">Yes</option>
                </select>
              </td>
              <td className="w-1/3 px-2 py-1">
                {p.exception && answers[p.key]?.answer === 'YES' && (
                  <input className={FIELD} placeholder="Exception relied on (medical, safety, lawful labelling, authorised law enforcement)" value={answers[p.key].exception}
                    onChange={(e) => setAnswers({ ...answers, [p.key]: { ...answers[p.key], exception: e.target.value } })} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <Button size="xs" onClick={() => void ctx.call(() => post(`${BASE}/models/${ctx.modelId}/art5`, { answers: body }, 'PUT'), 'Screening saved', ctx.reload)}><Save size={12} /> Save answers</Button>
        <Button size="xs" variant="secondary" disabled={!r.complete || r.signed} onClick={() => void ctx.call(() => post(`${BASE}/models/${ctx.modelId}/art5/sign`, {}), 'Screening signed', ctx.reload)}><PenLine size={12} /> Sign screening</Button>
      </div>
    </div>
  );
}

function ClassificationSection(ctx: Ctx) {
  const { d } = ctx;
  const c = d.classification ?? {};
  const [form, setForm] = useState({
    annex_iii: (c.annexIII ?? []) as string[],
    annex_i_product: c.annexIProduct ?? null as boolean | null,
    profiling: c.profiling ?? null as boolean | null,
    derogation: c.derogation ?? '',
    derogation_reasoning: c.derogationReasoning ?? '',
  });
  const yn = (v: boolean | null) => (v === true ? 'yes' : v === false ? 'no' : '');
  const fromYn = (v: string) => (v === '' ? null : v === 'yes');
  return (
    <div className="space-y-2 text-[11px]">
      <p className="text-text-secondary">
        The signed classification sets the EU tier; until then the functional area ({d.functional_area ?? 'not set'}) is only a hint.
        A profiling system is always high-risk; the Art. 6(3) derogation needs the reasoning documented and the system registered (Art. 6(4), 49(2)).
      </p>
      <p>{c.signedAt ? <Badge tone="positive">signed by {c.signedBy} on {day(c.signedAt)}</Badge> : <Badge tone="warning">not signed</Badge>}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {(d.reference?.annex_iii ?? []).map((a: any) => (
          <fieldset key={a.area} className="rounded border border-border/60 p-2">
            <legend className={LABEL}>{a.area}. {a.title}</legend>
            {a.points.map((p: any) => (
              <label key={p.code} className="flex items-start gap-1.5 py-0.5">
                <input type="checkbox" checked={form.annex_iii.includes(p.code)}
                  onChange={(e) => setForm({ ...form, annex_iii: e.target.checked ? [...form.annex_iii, p.code] : form.annex_iii.filter((x) => x !== p.code) })} />
                <span><span className="text-text-secondary">{p.code}</span> {p.label}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <Field label="Safety component or product under Annex I legislation (Art. 6(1))">
          <select className={FIELD} value={yn(form.annex_i_product)} onChange={(e) => setForm({ ...form, annex_i_product: fromYn(e.target.value) })}>
            <option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </Field>
        <Field label="Profiles natural persons">
          <select className={FIELD} value={yn(form.profiling)} onChange={(e) => setForm({ ...form, profiling: fromYn(e.target.value) })}>
            <option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </Field>
        <Field label="Art. 6(3) derogation relied on">
          <select className={FIELD} value={form.derogation} onChange={(e) => setForm({ ...form, derogation: e.target.value })}>
            <option value="">None (high-risk if an Annex III point applies)</option>
            {(d.reference?.derogation_conditions ?? []).map((x: any) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </Field>
      </div>
      {form.derogation && (
        <Field label="Derogation assessment (Art. 6(4), at least 50 characters)">
          <textarea rows={3} className={FIELD} value={form.derogation_reasoning} onChange={(e) => setForm({ ...form, derogation_reasoning: e.target.value })} />
        </Field>
      )}
      <div className="flex gap-2">
        <Button size="xs" onClick={() => void ctx.call(() => post(`${BASE}/models/${ctx.modelId}/classification`, { ...form, derogation: form.derogation || null }, 'PUT'), 'Classification saved', ctx.reload)}><Save size={12} /> Save</Button>
        <Button size="xs" variant="secondary" disabled={!!c.signedAt} onClick={() => void ctx.call(() => post(`${BASE}/models/${ctx.modelId}/classification/sign`, {}), 'Classification signed', ctx.reload)}><PenLine size={12} /> Sign classification</Button>
      </div>
    </div>
  );
}

function DocsSection(ctx: Ctx) {
  const { d, f, modelId } = ctx;
  const ax = d.annex_iv ?? { sections: [], score: 0 };
  const slug = (d.model_name ?? 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dl = (kind: string, file: string, q = '') => () => void ctx.call(() => download(`${BASE}/models/${modelId}/export/${kind}${q}`, file), 'Downloaded');
  return (
    <div className="space-y-3">
      <Sub title={`Annex IV technical documentation: ${ax.score}% ready`}>
        <Table
          head={['Section', 'Status', 'Missing']}
          empty="No sections."
          rows={(ax.sections ?? []).map((s: any) => [`${s.ref} ${s.title}`, st(s.status), (s.missing ?? []).join('; ') || '—'])}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant="secondary" onClick={dl('annex-iv', `${slug}-annex-iv.md`, '?format=md')}><Download size={12} /> Annex IV (Markdown)</Button>
          <Button size="xs" variant="secondary" onClick={dl('annex-iv', `${slug}-annex-iv.json`)}><Download size={12} /> Annex IV (JSON)</Button>
          <Button size="xs" variant="secondary" onClick={dl('instructions', `${slug}-instructions-for-use.json`)}><Download size={12} /> Art. 13 instructions for use</Button>
        </div>
        <p className="text-[11px] text-text-secondary">Built from the model card, context profile, data register, TEVV results and the fields below.</p>
        <ProfileForm ctx={ctx} paths={GROUPS.annexIV} />
      </Sub>
      <Sub title="Instructions for use (Art. 13)">
        <Missing items={f.instructions?.missing} ok="Instructions for use complete." />
        <ProfileForm ctx={ctx} paths={GROUPS.instructions} />
      </Sub>
      <Sub title="Data governance (Art. 10)">
        <Missing items={f.data?.missing} ok="Data governance fields complete." />
        <ProfileForm ctx={ctx} paths={GROUPS.data} />
      </Sub>
      <Sub title="Post-market monitoring plan (Art. 72)">
        <Missing items={f.pmm?.missing} ok={f.pmm?.reviewOverdue ? 'Plan recorded, but its review is overdue.' : 'Plan recorded.'} />
        <ProfileForm ctx={ctx} paths={GROUPS.pmm} />
      </Sub>
      <Sub title="Retention (Art. 18)">
        <p className="text-[11px] text-text-secondary">
          EU documentation is kept 10 years from the placing-on-market date{f.retention?.until ? ` (until ${f.retention.until})` : ''}.
          {f.retention?.short?.length ? ` Shorter retention on: ${f.retention.short.join(', ')}.` : ''}
        </p>
        <Button size="xs" variant="secondary" disabled={!f.retention?.short?.length} onClick={() => void ctx.call(() => post(`${BASE}/models/${modelId}/retention/apply`, {}), 'Retention extended', ctx.reload)}>
          Extend linked documents to 10 years
        </Button>
      </Sub>
    </div>
  );
}

function ConformitySection(ctx: Ctx) {
  const { d, f, modelId } = ctx;
  const records: any[] = d.records ?? [];
  const conf = records.filter((r) => r.kind === 'CONFORMITY');
  const draft = conf.find((r) => r.status === 'DRAFT');
  const decls = records.filter((r) => r.kind === 'DECLARATION');
  const items: any[] = d.reference?.annex_vi ?? [];
  const [form, setForm] = useState<{ route: string; items: Record<string, { ok: boolean; note: string }>; notified_body: Record<string, string>; note: string }>({
    route: draft?.data?.route ?? 'INTERNAL_CONTROL',
    items: Object.fromEntries(items.map((i) => [i.key, { ok: !!draft?.data?.items?.[i.key]?.ok, note: draft?.data?.items?.[i.key]?.note ?? '' }])),
    notified_body: { name: '', number: '', certificate_ref: '', certificate_doc_id: '', valid_until: '', ...(draft?.data?.notifiedBody ? {
      name: draft.data.notifiedBody.name, number: draft.data.notifiedBody.number, certificate_ref: draft.data.notifiedBody.certificateRef,
      certificate_doc_id: draft.data.notifiedBody.certificateDocId ?? '', valid_until: draft.data.notifiedBody.validUntil ?? '' } : {}) },
    note: draft?.data?.note ?? '',
  });
  const [decl, setDecl] = useState({ signer_name: '', signer_function: '', place: '', document_id: '' });
  const slug = (d.model_name ?? 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div className="space-y-3">
      <Sub title="Conformity assessment (Art. 43, Annex VI or VII)">
        {f.conformity?.route === 'NOT_REQUIRED' ? (
          <p className="text-[11px] text-text-secondary">Not required on the record so far: conformity, the declaration and CE marking apply to providers of high-risk systems.</p>
        ) : (
          <p className="text-[11px]">Current: {st(f.conformity?.status)} {f.conformity?.route ? human(f.conformity.route) : ''} {f.conformity?.problem ? <span className="text-negative">{f.conformity.problem}</span> : null}</p>
        )}
        <Table head={['Route', 'Status', 'Signed', 'Hash']} empty="No assessment yet."
          rows={conf.map((r) => [human(r.data?.route ?? ''), st(r.status), r.signed_by ? `${r.signed_by} · ${day(r.signed_at)}` : '—', r.content_hash ? <code key="h">{r.content_hash.slice(0, 12)}</code> : '—'])} />
        <div className="grid gap-2 md:grid-cols-3">
          <Field label="Route">
            <select className={FIELD} value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })}>
              <option value="INTERNAL_CONTROL">Internal control (Annex VI)</option><option value="NOTIFIED_BODY">Notified body (Annex VII)</option>
            </select>
          </Field>
        </div>
        {items.map((i) => (
          <div key={i.key} className="grid items-start gap-2 text-[11px] md:grid-cols-2">
            <label className="flex items-start gap-1.5"><input type="checkbox" checked={form.items[i.key]?.ok ?? false}
              onChange={(e) => setForm({ ...form, items: { ...form.items, [i.key]: { ...form.items[i.key], ok: e.target.checked } } })} /> {i.label}</label>
            <input className={FIELD} placeholder="Evidence or note" value={form.items[i.key]?.note ?? ''} onChange={(e) => setForm({ ...form, items: { ...form.items, [i.key]: { ...form.items[i.key], note: e.target.value } } })} />
          </div>
        ))}
        {form.route === 'NOTIFIED_BODY' && (
          <div className="grid gap-2 md:grid-cols-5">
            {[['name', 'Notified body'], ['number', 'Body number'], ['certificate_ref', 'Certificate reference'], ['certificate_doc_id', 'Certificate document id'], ['valid_until', 'Valid until']].map(([k, l]) => (
              <Field key={k} label={l}><input type={k === 'valid_until' ? 'date' : 'text'} className={FIELD} value={form.notified_body[k] ?? ''} onChange={(e) => setForm({ ...form, notified_body: { ...form.notified_body, [k]: e.target.value } })} /></Field>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="xs" onClick={() => void ctx.call(() => post(`${BASE}/models/${modelId}/conformity`, {
            route: form.route, items: form.items, note: form.note || null,
            ...(form.route === 'NOTIFIED_BODY' ? { notified_body: Object.fromEntries(Object.entries(form.notified_body).map(([k, v]) => [k, v || null])) } : {}),
          }), 'Draft saved', ctx.reload)}><Save size={12} /> Save draft</Button>
          {draft && <Button size="xs" variant="secondary" onClick={() => void ctx.call(() => post(`${BASE}/conformity/${draft.record_id}/sign`, { outcome: 'PASSED' }), 'Signed as passed', ctx.reload)}><PenLine size={12} /> Sign as passed</Button>}
          {draft && <Button size="xs" variant="danger" onClick={() => void ctx.call(() => post(`${BASE}/conformity/${draft.record_id}/sign`, { outcome: 'FAILED' }), 'Signed as failed', ctx.reload)}>Sign as failed</Button>}
        </div>
      </Sub>
      <Sub title="EU declaration of conformity (Art. 47, Annex V)">
        <Table head={['Status', 'Signed', 'Keep until', 'Hash']} empty="No declaration yet."
          rows={decls.map((r) => [<span key="s">{st(r.status)} {r.data?.stale ? <Badge tone="warning">out of date</Badge> : null}</span>, `${r.signed_by} · ${day(r.signed_at)}`, day(r.data?.keepUntil), <code key="h">{String(r.content_hash ?? '').slice(0, 12)}</code>])} />
        <div className="grid gap-2 md:grid-cols-4">
          <Field label="Signed by (name)"><input className={FIELD} value={decl.signer_name} onChange={(e) => setDecl({ ...decl, signer_name: e.target.value })} /></Field>
          <Field label="Function"><input className={FIELD} value={decl.signer_function} onChange={(e) => setDecl({ ...decl, signer_function: e.target.value })} /></Field>
          <Field label="Place of issue"><input className={FIELD} value={decl.place} onChange={(e) => setDecl({ ...decl, place: e.target.value })} /></Field>
          <Field label="Controlled document id (optional)"><input className={FIELD} value={decl.document_id} onChange={(e) => setDecl({ ...decl, document_id: e.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="xs" disabled={f.conformity?.status !== 'PASSED'} title={f.conformity?.status !== 'PASSED' ? 'A passed conformity assessment comes first' : undefined}
            onClick={() => void ctx.call(() => post(`${BASE}/models/${modelId}/declaration`, { ...decl, document_id: decl.document_id || null }), 'Declaration issued', ctx.reload)}><FileCheck2 size={12} /> Issue declaration</Button>
          <Button size="xs" variant="secondary" disabled={!decls.some((x) => x.status === 'ISSUED')} onClick={() => void ctx.call(() => download(`${BASE}/models/${modelId}/export/declaration`, `${slug}-eu-declaration.json`), 'Downloaded')}><Download size={12} /> Declaration</Button>
        </div>
      </Sub>
      <Sub title="CE marking (Art. 48)">
        <p className="text-[11px] text-text-secondary">SentRAI records the marking; your organisation affixes it.{f.ce?.problem ? ` ${f.ce.problem}.` : ''}</p>
        <ProfileForm ctx={ctx} paths={GROUPS.ce} />
      </Sub>
    </div>
  );
}

function RegistrationSection(ctx: Ctx) {
  const { d, f, modelId } = ctx;
  const regs = (d.records ?? []).filter((r: any) => r.kind === 'REGISTRATION');
  const required: string[] = f.registration?.required ?? [];
  const [form, setForm] = useState({ section: required[0] ?? 'A', eu_database_id: '', registered_at: '', entry_url: '' });
  const slug = (d.model_name ?? 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div className="space-y-2 text-[11px]">
      <p className="text-text-secondary">
        Annex VIII section A is the provider’s high-risk registration, B an Art. 6(3) derogation, C a public-authority deployer’s use. Needed here: {required.length ? required.join(', ') : 'none'}.
        {f.registration?.missing?.length ? ` Still to register: ${f.registration.missing.join(', ')}.` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {['A', 'B', 'C'].map((s) => (
          <Button key={s} size="xs" variant="secondary" disabled={!required.includes(s)} onClick={() => void ctx.call(() => download(`${BASE}/models/${modelId}/export/annex-viii?section=${s}`, `${slug}-annex-viii-${s}.json`), 'Downloaded')}>
            <Download size={12} /> Annex VIII section {s}
          </Button>
        ))}
      </div>
      <Table head={['Section', 'EU database id', 'Registered', 'Status']} empty="No registration recorded."
        rows={regs.map((r: any) => [r.data?.section, r.data?.euDatabaseId, day(r.data?.registeredAt), st(r.status)])} />
      <div className="grid gap-2 md:grid-cols-4">
        <Field label="Section"><select className={FIELD} value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })}>{['A', 'B', 'C'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
        <Field label="EU database id"><input className={FIELD} value={form.eu_database_id} onChange={(e) => setForm({ ...form, eu_database_id: e.target.value })} /></Field>
        <Field label="Registered on"><input type="date" className={FIELD} value={form.registered_at} onChange={(e) => setForm({ ...form, registered_at: e.target.value })} /></Field>
        <Field label="Entry URL (optional)"><input className={FIELD} value={form.entry_url} onChange={(e) => setForm({ ...form, entry_url: e.target.value })} /></Field>
      </div>
      <Button size="xs" disabled={!required.length} onClick={() => void ctx.call(() => post(`${BASE}/models/${modelId}/registrations`, { ...form, registered_at: form.registered_at || undefined, entry_url: form.entry_url || null }), 'Registration recorded', ctx.reload)}>
        <Plus size={12} /> Record registration
      </Button>
    </div>
  );
}

function TransparencySection(ctx: Ctx) {
  const { d, f } = ctx;
  const checks: any[] = d.reference?.importer_checks ?? [];
  const roles: string[] = f.roles ?? [];
  const verify = checks.filter((c) => c.roles.some((r: string) => roles.includes(r))).map((c) => `verification.${c.key}`);
  return (
    <div className="space-y-3">
      <Sub title="Transparency (Art. 50)">
        <Missing items={f.art50?.missing} ok="Article 50 duties recorded." />
        <ProfileForm ctx={ctx} paths={GROUPS.art50} />
      </Sub>
      {roles.includes('DEPLOYER') && (
        <>
          <Sub title="Deployer duties (Art. 26)">
            <Missing items={f.deployer?.missing} ok="Deployer duties recorded." />
            <ProfileForm ctx={ctx} paths={GROUPS.deployer} />
          </Sub>
          <Sub title="Fundamental rights impact assessment (Art. 27)">
            <p className="text-[11px] text-text-secondary">
              {f.fria?.required ? `A FRIA is required. ${f.fria.signed ? 'A signed EU FRIA is on record.' : 'No signed EU FRIA yet: complete the eu-fria questionnaire in Impact assessments.'}` : 'No FRIA required on the answers so far.'}
            </p>
            <ProfileForm ctx={ctx} paths={GROUPS.fria} />
          </Sub>
        </>
      )}
      {verify.length > 0 && (
        <Sub title="Importer and distributor verification (Art. 23, 24)">
          <Missing items={f.verification?.missing} ok="Verification complete." />
          <ProfileForm ctx={ctx} paths={[...verify, 'verification.verifiedAt', 'verification.note']} />
        </Sub>
      )}
      <Sub title="General-purpose AI (Art. 53; Art. 25(4) downstream)">
        <Missing items={f.gpai?.missing} ok={f.gpai?.applies ? 'GPAI records complete.' : 'Not a GPAI provider or downstream user on the answers so far.'} />
        <ProfileForm ctx={ctx} paths={GROUPS.gpai} />
      </Sub>
    </div>
  );
}

function IncidentsSection(ctx: Ctx) {
  const { d } = ctx;
  const [open, setOpen] = useState<string | null>(null);
  const classes: any[] = d.reference?.serious_classes ?? [];
  return (
    <div className="space-y-2 text-[11px]">
      <p className="text-text-secondary">
        Classify each incident under Art. 3(49). The report to the market surveillance authority is due 2 days after awareness for a widespread infringement or critical-infrastructure
        disruption, 10 days for a death and 15 days otherwise; the incident’s own deadline moves to the earlier date. Record the system state before you change anything (Art. 73(6)).
      </p>
      <Table head={['Detected', 'Severity', 'Class', 'Due', 'Reported', 'Problems', '']} empty="No incidents on this system."
        rows={(d.incidents ?? []).map((i: any) => [
          day(i.detected_at), i.severity, i.eu_status?.classification ? human(i.eu_status.classification) : '—',
          i.eu_status?.deadline_at ? <span key="d" className={i.eu_status.overdue ? 'text-negative' : ''}>{day(i.eu_status.deadline_at)}</span> : '—',
          day(i.eu_status?.reported_at), (i.eu_status?.problems ?? []).join('; ') || '—',
          <Button key="e" size="xs" variant="secondary" onClick={() => setOpen(open === i.incident_id ? null : i.incident_id)}>{open === i.incident_id ? 'Close' : 'EU record'}</Button>,
        ])} />
      {open && <IncidentForm key={open} ctx={ctx} inc={(d.incidents ?? []).find((i: any) => i.incident_id === open)} classes={classes} />}
    </div>
  );
}

function IncidentForm({ ctx, inc, classes }: { ctx: Ctx; inc: any; classes: any[] }) {
  const e = inc?.eu ?? {};
  const dt = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');
  const [form, setForm] = useState<Record<string, any>>({
    classification: e.classification ?? '', aware_at: dt(e.awareAt), reported_at: dt(e.reportedAt), authority: e.authority ?? '', reference: e.reference ?? '',
    provider_informed_at: dt(e.providerInformedAt), authority_informed_at: dt(e.authorityInformedAt), suspended_at: dt(e.suspendedAt), suspension_reason: e.suspensionReason ?? '',
    state_recorded_at: dt(e.stateRecordedAt), state_description: e.stateDescription ?? '', not_altered: e.notAltered ?? null, alteration_reason: e.alterationReason ?? '',
  });
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  const text = (k: string, l: string, long = false) => (
    <Field key={k} label={l}>{long ? <textarea rows={2} className={FIELD} value={form[k]} onChange={(x) => set(k, x.target.value)} /> : <input className={FIELD} value={form[k]} onChange={(x) => set(k, x.target.value)} />}</Field>
  );
  const date = (k: string, l: string) => <Field key={k} label={l}><input type="date" className={FIELD} value={form[k]} onChange={(x) => set(k, x.target.value)} /></Field>;
  const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]).filter(([k, v]) => !(k === 'classification' && v === null)));
  return (
    <div className="space-y-2 rounded border border-border p-2">
      <div className="grid gap-2 md:grid-cols-3">
        <Field label="Serious-incident class (Art. 3(49))">
          <select className={FIELD} value={form.classification} onChange={(x) => set('classification', x.target.value)}>
            <option value="">Not classified</option>
            {classes.map((c) => <option key={c.key} value={c.key}>{c.label}{c.days ? ` · ${c.days} days` : ''}</option>)}
          </select>
        </Field>
        {date('aware_at', 'Became aware on')}
        {date('reported_at', 'Reported to the authority on')}
        {text('authority', 'Authority')}
        {text('reference', 'Report reference')}
        {date('provider_informed_at', 'Provider informed on (deployer, Art. 26(5))')}
        {date('authority_informed_at', 'Authority informed of the risk on')}
        {date('suspended_at', 'Use suspended on')}
        {text('suspension_reason', 'Suspension reason')}
        {date('state_recorded_at', 'System state recorded on')}
        <Field label="System not altered before investigation">
          <select className={FIELD} value={form.not_altered === true ? 'yes' : form.not_altered === false ? 'no' : ''} onChange={(x) => set('not_altered', x.target.value === '' ? null : x.target.value === 'yes')}>
            <option value="">Not answered</option><option value="yes">Not altered</option><option value="no">Altered</option>
          </select>
        </Field>
        {form.not_altered === false && text('alteration_reason', 'Why it was altered')}
      </div>
      {text('state_description', 'System state before investigation (Art. 73(6))', true)}
      <div className="flex flex-wrap gap-2">
        <Button size="xs" onClick={() => void ctx.call(() => post(`${BASE}/incidents/${inc.incident_id}`, body, 'PUT'), 'EU incident record saved', ctx.reload)}><Save size={12} /> Save</Button>
        <Button size="xs" variant="secondary" disabled={!inc?.eu_status?.serious} onClick={() => void ctx.call(() => download(`${BASE}/incidents/${inc.incident_id}/report`, `serious-incident-${inc.incident_id.slice(0, 8)}.json`), 'Downloaded')}>
          <Download size={12} /> Authority report
        </Button>
        <a className="self-center text-[11px] text-accent hover:underline" href="#/incidents">Open in Incidents ↗</a>
      </div>
    </div>
  );
}

function OpsSection(ctx: Ctx) {
  const { d, modelId } = ctx;
  const recs = (k: string) => (d.records ?? []).filter((r: any) => r.kind === k);
  const [nc, setNc] = useState({ action: 'CORRECT', description: '', presents_risk: false });
  const [assess, setAssess] = useState<Record<string, any>>({});
  const [rwt, setRwt] = useState({ title: '', plan: '', registration_ref: '', authority_approval_ref: '', consent_refs: '', withdrawal_procedure: '' });
  const [expl, setExpl] = useState({ decision_ref: '', requester: '' });
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const [range, setRange] = useState({ from: '', to: '' });
  const slug = (d.model_name ?? 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-3 text-[11px]">
      <Sub title="Material changes: substantial modification? (Art. 25, 43(4))">
        <p className="text-text-secondary">Opened automatically when a material change, context change or vendor change is recorded on this system.</p>
        <Table head={['Opened', 'Trigger', 'Status', 'Decision']} empty="No changes to assess."
          rows={recs('CHANGE').map((r: any) => [day(r.created_at), human(r.data?.event ?? ''), st(r.status), r.status === 'OPEN' ? (
            <div key="a" className="space-y-1">
              {[['substantial_modification', 'Substantial modification'], ['purpose_changed_to_high_risk', 'Purpose changed to high-risk'], ['own_name_or_trademark', 'Put on the market under our name']].map(([k, l]) => (
                <label key={k} className="mr-2 inline-flex items-center gap-1"><input type="checkbox" checked={!!assess[r.record_id]?.[k]}
                  onChange={(e) => setAssess({ ...assess, [r.record_id]: { ...assess[r.record_id], [k]: e.target.checked } })} />{l}</label>
              ))}
              <input className={FIELD} placeholder="Reasoning (at least 20 characters)" value={assess[r.record_id]?.reasoning ?? ''}
                onChange={(e) => setAssess({ ...assess, [r.record_id]: { ...assess[r.record_id], reasoning: e.target.value } })} />
              <Button size="xs" onClick={() => void ctx.call(() => post(`${BASE}/changes/${r.record_id}/assess`, {
                substantial_modification: !!assess[r.record_id]?.substantial_modification, purpose_changed_to_high_risk: !!assess[r.record_id]?.purpose_changed_to_high_risk,
                own_name_or_trademark: !!assess[r.record_id]?.own_name_or_trademark, reasoning: assess[r.record_id]?.reasoning ?? '',
              }), 'Change assessed', ctx.reload)}><PenLine size={12} /> Sign decision</Button>
            </div>
          ) : (r.data?.reasoning ?? '—')])} />
      </Sub>
      <Sub title="Non-conformity actions (Art. 20)">
        <Table head={['Opened', 'Action', 'Risk', 'Status', 'Informed', '']} empty="No non-conformity actions."
          rows={recs('NONCONFORMITY').map((r: any) => [day(r.created_at), human(r.data?.action ?? ''), r.data?.presentsRisk ? 'yes' : 'no', st(r.status),
            Object.entries(r.data?.informed ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || '—',
            r.status !== 'CLOSED' ? (
              <span key="u" className="flex flex-wrap gap-1">
                <Button size="xs" variant="secondary" onClick={() => void ctx.call(() => post(`${BASE}/nonconformities/${r.record_id}`, { informed: { distributors: today, deployers: today, ...(r.data?.presentsRisk ? { authority: today } : {}) } }, 'PUT'), 'Recorded as informed', ctx.reload)}>Informed today</Button>
                <Button size="xs" variant="secondary" onClick={() => void ctx.call(() => post(`${BASE}/nonconformities/${r.record_id}`, { status: r.status === 'OPEN' ? 'ACTIONED' : 'CLOSED' }, 'PUT'), 'Updated', ctx.reload)}>{r.status === 'OPEN' ? 'Mark actioned' : 'Close'}</Button>
              </span>
            ) : '—'])} />
        <div className="grid gap-2 md:grid-cols-4">
          <Field label="Action"><select className={FIELD} value={nc.action} onChange={(e) => setNc({ ...nc, action: e.target.value })}>{(d.reference?.nonconformity_actions ?? []).map((a: string) => <option key={a} value={a}>{human(a)}</option>)}</select></Field>
          <div className="md:col-span-2"><Field label="What is not in conformity"><input className={FIELD} value={nc.description} onChange={(e) => setNc({ ...nc, description: e.target.value })} /></Field></div>
          <label className="inline-flex items-center gap-1 self-end"><input type="checkbox" checked={nc.presents_risk} onChange={(e) => setNc({ ...nc, presents_risk: e.target.checked })} /> Presents a risk (Art. 79(1))</label>
        </div>
        <Button size="xs" onClick={() => void ctx.call(() => post(`${BASE}/models/${modelId}/nonconformities`, nc), 'Action opened', ctx.reload)}><Plus size={12} /> Open action</Button>
      </Sub>
      <Sub title="Explanation requests (Art. 86)">
        <p className="text-text-secondary">Affected persons can also ask through the public path: POST /api/v1/governance/public/eu/decisions/{modelId}/explanations. Answer within 30 days.</p>
        <Table head={['Received', 'Decision', 'Due', 'Status', '']} empty="No explanation requests."
          rows={recs('EXPLANATION').map((r: any) => [day(r.created_at), r.data?.decisionRef ?? '—', day(r.due_at), st(r.status), r.status === 'RECEIVED' ? (
            <span key="a" className="flex gap-1">
              <input className={FIELD} placeholder="Explanation (blank: generated from the decision record)" value={answer[r.record_id] ?? ''} onChange={(e) => setAnswer({ ...answer, [r.record_id]: e.target.value })} />
              <Button size="xs" onClick={() => void ctx.call(() => post(`${BASE}/explanations/${r.record_id}/answer`, { text: answer[r.record_id] || undefined }), 'Answered', ctx.reload)}>Answer</Button>
            </span>
          ) : (r.data?.explanation ?? '').slice(0, 120)])} />
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Decision reference"><input className={FIELD} value={expl.decision_ref} onChange={(e) => setExpl({ ...expl, decision_ref: e.target.value })} /></Field>
          <Field label="Requester (optional)"><input className={FIELD} value={expl.requester} onChange={(e) => setExpl({ ...expl, requester: e.target.value })} /></Field>
          <Button size="xs" onClick={() => void ctx.call(() => post(`${BASE}/models/${modelId}/explanations`, { decision_ref: expl.decision_ref, requester: expl.requester || null }), 'Request logged', ctx.reload)}><Plus size={12} /> Log request</Button>
        </div>
      </Sub>
      <Sub title="Real-world testing plans (Art. 60, 61)">
        <Table head={['Plan', 'Registration', 'Approval', 'Consents']} empty="No real-world tests."
          rows={recs('RWT_PLAN').map((r: any) => [r.data?.title, r.data?.registrationRef ?? '—', r.data?.authorityApprovalRef ?? '—', String(r.data?.consentRefs?.length ?? 0)])} />
        <div className="grid gap-2 md:grid-cols-3">
          {[['title', 'Title'], ['registration_ref', 'Registration reference'], ['authority_approval_ref', 'Authority approval reference'], ['consent_refs', 'Consent record references (comma-separated)'], ['withdrawal_procedure', 'Withdrawal procedure']].map(([k, l]) => (
            <Field key={k} label={l}><input className={FIELD} value={(rwt as any)[k]} onChange={(e) => setRwt({ ...rwt, [k]: e.target.value })} /></Field>
          ))}
        </div>
        <Field label="Plan (at least 20 characters)"><textarea rows={2} className={FIELD} value={rwt.plan} onChange={(e) => setRwt({ ...rwt, plan: e.target.value })} /></Field>
        <Button size="xs" onClick={() => void ctx.call(() => post(`${BASE}/models/${modelId}/real-world-tests`, {
          ...rwt, consent_refs: rwt.consent_refs.split(',').map((x) => x.trim()).filter(Boolean), registration_ref: rwt.registration_ref || null,
          authority_approval_ref: rwt.authority_approval_ref || null, withdrawal_procedure: rwt.withdrawal_procedure || null,
        }), 'Plan recorded', ctx.reload)}><Plus size={12} /> Add plan</Button>
      </Sub>
      <Sub title="Authority request (Art. 21)">
        <p className="text-text-secondary">One file with the Annex IV documentation, declaration, conformity, registrations, incidents and logs for the dates chosen (default: the last 180 days).</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From"><input type="date" className={FIELD} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="To"><input type="date" className={FIELD} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          <Button size="xs" variant="secondary" onClick={() => {
            const q = new URLSearchParams(Object.entries(range).filter(([, v]) => v)).toString();
            void ctx.call(() => download(`${BASE}/models/${modelId}/export/authority${q ? `?${q}` : ''}`, `${slug}-authority-bundle.json`), 'Downloaded');
          }}><Download size={12} /> Authority bundle</Button>
        </div>
      </Sub>
    </div>
  );
}
