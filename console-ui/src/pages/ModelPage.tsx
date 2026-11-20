import { ArrowLeft } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { ModelWorkspace } from '../components/console/EditDrawer';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { packInScope } from '../providers';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useGovernanceData } from '../stores/governanceData';
import { useGovernanceFeatures } from '../stores/governanceFeatures';
import { routeParam } from '../stores/route';
import { useSession } from '../stores/session';
import { EnergyTab, SecurityTab, TevvTab } from './GovernancePhase3';
import { ModelCardTab } from './ModelCard';
import { ModelCardV2Tab } from './ModelCardV2';
import { FairLendingTab, ValidationTab, VendorsTab } from './GovernancePhase2';
import { ContextTab, ImpactTab, RiskRegisterTab } from './GovernanceRegister';

type TabId = 'overview' | 'risk' | 'testing' | 'approvals' | 'operations' | 'data' | 'card' | 'history';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview & gaps' },
  { id: 'risk', label: 'Context, risk & impact' },
  { id: 'testing', label: 'Testing & security' },
  { id: 'approvals', label: 'Approvals & lifecycle' },
  { id: 'operations', label: 'Operations' },
  { id: 'data', label: 'Data & suppliers' },
  { id: 'card', label: 'Model card' },
  { id: 'history', label: 'History' },
];

const day = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

/** A section of the model page that only shows while its governance feature is on. */
function Section({ show, children }: { show: boolean | undefined; children: ReactNode }) {
  return show ? <div className="space-y-2">{children}</div> : null;
}

/** Deployment approvals for this model, from Alignment (where they are decided). */
function ModelApprovals({ modelId }: { modelId: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    api<any[]>('/alignment/approvals').then((r) => setRows((r ?? []).filter((a) => a.model_id === modelId))).catch(() => setRows([]));
  }, [modelId]);
  return (
    <Panel title="Deployment approvals" right={<a className="text-[10.5px] text-accent hover:underline" href="#/alignment">Request or decide on Alignment ↗</a>}>
      {!rows ? <SkeletonRows rows={2} /> : !rows.length ? (
        <p className="p-3 text-[11px] text-text-secondary">No review-board approval on record for this model.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <li key={a.approval_id} className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 text-[11px]">
              <Badge tone={a.status === 'APPROVED' ? 'positive' : a.status === 'REJECTED' ? 'negative' : 'warning'}>{String(a.status).toLowerCase()}</Badge>
              <span className="text-text">→ {a.target_stage}</span>
              <span className="text-text-secondary">{a.approvals_recorded}/{a.required_approvals} approvals · requested by {a.requested_by}</span>
              <span className="ml-auto font-mono text-[9.5px] text-text-tertiary">{day(a.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Incidents and grievances for this model, with links to where they are worked. */
function ModelOperations({ modelId }: { modelId: string }) {
  const [incidents, setIncidents] = useState<any[] | null>(null);
  const [grievances, setGrievances] = useState<any[] | null>(null);
  useEffect(() => {
    api<any[]>('/compliance/incident').then((r) => setIncidents((r ?? []).filter((i) => i.model_id === modelId))).catch(() => setIncidents([]));
    api<any[]>('/grievances').then((r) => setGrievances((r ?? []).filter((g) => g.model_id === modelId))).catch(() => setGrievances([]));
  }, [modelId]);
  const SEV: Record<string, BadgeTone> = { P1_CRITICAL: 'negative', P2_HIGH: 'negative', P3_MEDIUM: 'warning', P4_LOW: 'neutral' };
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <Panel title="Incidents" right={<a className="text-[10.5px] text-accent hover:underline" href="#/incidents">Report or work on Incidents ↗</a>}>
        {!incidents ? <SkeletonRows rows={2} /> : !incidents.length ? <p className="p-3 text-[11px] text-text-secondary">No incidents reported for this model.</p> : (
          <ul className="divide-y divide-border">
            {incidents.map((i) => (
              <li key={i.incident_id} className="px-3 py-1.5 text-[11px]">
                <span className="flex items-center gap-1.5"><Badge tone={SEV[i.severity] ?? 'neutral'}>{i.severity}</Badge><Badge tone="neutral">{i.status}</Badge><span className="ml-auto font-mono text-[9.5px] text-text-tertiary">{day(i.created_at)}</span></span>
                <p className="mt-0.5 truncate text-text-secondary">{i.description}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Consumer grievances" right={<a className="text-[10.5px] text-accent hover:underline" href={`#/grievances?file=1&model=${encodeURIComponent(modelId)}`}>File a grievance ↗</a>}>
        {!grievances ? <SkeletonRows rows={2} /> : !grievances.length ? <p className="p-3 text-[11px] text-text-secondary">No grievances for this model.</p> : (
          <ul className="divide-y divide-border">
            {grievances.map((g) => (
              <li key={g.grievance_id} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px]">
                <Badge tone={g.is_overdue ? 'negative' : 'neutral'}>{g.status}</Badge>
                <span className="truncate text-text">{g.subject}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Drift and BCP drills" className="lg:col-span-2">
        <p className="p-3 text-[11px] text-text-secondary">
          Drift evaluations and BCP drills for this model are on <a className="text-accent hover:underline" href={`#/monitoring?model=${encodeURIComponent(modelId)}`}>Drift Monitoring ↗</a>.
          The kill switch is under Overview &amp; gaps › Operational control.
        </p>
      </Panel>
    </div>
  );
}

/** The cross-ledger timeline (governance, gate, incident, drift, runtime) for this model. */
function ModelHistory({ modelId }: { modelId: string }) {
  const [t, setT] = useState<any | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<any>(`/telemetry/models/${modelId}/timeline`).then(setT).catch(() => setError(true));
  }, [modelId]);
  if (error) return <Panel title="History"><PanelError onRetry={() => { setError(false); api<any>(`/telemetry/models/${modelId}/timeline`).then(setT).catch(() => setError(true)); }} /></Panel>;
  return (
    <Panel title="History: every ledger for this model" right={<a className="text-[10.5px] text-accent hover:underline" href={`#/audit?model=${encodeURIComponent(modelId)}`}>Formal audits ↗</a>}>
      {!t ? <SkeletonRows rows={6} /> : !t.timeline?.length ? <p className="p-3 text-[11px] text-text-secondary">No records yet.</p> : (
        <ul className="divide-y divide-border">
          {t.timeline.map((r: any, i: number) => (
            <li key={i} className={`flex items-start gap-2 px-3 py-1.5 ${r.flagged ? 'bg-negative-soft' : ''}`}>
              <Badge tone="neutral">{r.source}</Badge>
              <div className="min-w-0 flex-1">
                <span className="font-mono text-[10px] font-medium text-text">{r.type}</span>
                <p className="truncate text-[10.5px] text-text-secondary">{r.summary}</p>
              </div>
              <span className="shrink-0 font-mono text-[9px] text-text-tertiary">{day(r.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One page per model: everything about one model's governance in one place,
 * instead of a popup plus a dozen Governance tabs that each ask for the model
 * again. The Governance tabs shown here are fixed to this model; their
 * organisation-wide views stay on the Governance page.
 */
export function ModelPage() {
  const modelId = routeParam('id') ?? '';
  const { components, loading, error, load } = useGovernanceData();
  const features = useGovernanceFeatures((s) => s.features);
  const loadFeatures = useGovernanceFeatures((s) => s.load);
  const activeProjectId = useSession((s) => s.activeProjectId);
  const setActiveProject = useSession((s) => s.setActiveProject);
  const [tab, setTab] = useState<TabId>(() => (routeParam('tab') as TabId) || 'overview');
  useEffect(() => { void loadFeatures(); }, [loadFeatures]);
  useEffect(() => {
    // A link to another tab of this page (or another model) changes only the hash.
    const sync = () => setTab((routeParam('tab') as TabId) || 'overview');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => { if (!components.length) void load(); }, [components.length, load]);
  const component = components.find((c) => c.id === modelId) ?? null;
  const f = features ?? { governanceV2: false };

  const pick = (id: TabId) => {
    setTab(id);
    window.history.replaceState(null, '', `#/model?id=${encodeURIComponent(modelId)}&tab=${id}`);
  };

  let body: ReactNode;
  if (error) body = <Panel title="Model"><PanelError onRetry={load} /></Panel>;
  else if (loading && !component) body = <Panel title="Model"><SkeletonRows rows={8} /></Panel>;
  else if (!component) body = (
    <Panel title="Model not found">
      <p className="p-3 text-[11px] text-text-secondary">
        This model is not in the current scope.{' '}
        {activeProjectId ? <button className="text-accent hover:underline" onClick={() => { setActiveProject(null); void load(); }}>Clear the project scope</button> : <a className="text-accent hover:underline" href="#/inventory">Back to Model Inventory</a>}
      </p>
    </Panel>
  );
  else if (tab === 'overview') body = <ModelWorkspace component={component} />;
  else if (tab === 'risk') body = (
    <>
      <Section show={f.contextProfile}><ContextTab /></Section>
      <Section show={f.riskRegister}><RiskRegisterTab /></Section>
      <Section show={f.impactAssessment}><ImpactTab /></Section>
      <Section show={f.modelValidation}><ValidationTab /></Section>
      {/* Fair lending (ECOA / Reg B) is a US-pack criterion: asked for only while the US pack is enabled. */}
      <Section show={f.fairLending && packInScope(component, 'us-2026')}><FairLendingTab /></Section>
      {!f.contextProfile && !f.riskRegister && !f.impactAssessment && <p className="text-[11px] text-text-secondary">Risk and impact records appear here once the governance features are on.</p>}
    </>
  );
  else if (tab === 'testing') body = (
    <>
      <Section show={f.tevv}><TevvTab /></Section>
      <Section show={f.aiSecurity}><SecurityTab /></Section>
      <p className="text-[10.5px] text-text-tertiary">Red teams, behavioural evals and other evidence are recorded under Overview &amp; gaps.</p>
    </>
  );
  else if (tab === 'approvals') body = (
    <>
      <ModelApprovals modelId={modelId} />
      <p className="text-[10.5px] text-text-tertiary">Retirement is requested and approved under Testing &amp; security › Test sets and retirement; validator independence under Context, risk &amp; impact.</p>
    </>
  );
  else if (tab === 'operations') body = (
    <>
      <ModelOperations modelId={modelId} />
      <Section show={f.energy}><EnergyTab /></Section>
    </>
  );
  else if (tab === 'data') body = (
    <>
      <Section show={f.vendors}><VendorsTab /></Section>
      {!f.vendors && <p className="text-[11px] text-text-secondary">Vendors, the AI bill of materials and linked datasets appear here once the vendor register is on.</p>}
    </>
  );
  else if (tab === 'card') body = f.modelCardV2
    ? <ModelCardV2Tab modelId={modelId} />
    : f.modelCards
      ? <ModelCardTab modelId={modelId} />
      : <p className="text-[11px] text-text-secondary">Model cards appear here once the model card feature is on (GOV_E4_1_MODEL_CARDS).</p>;
  else body = <ModelHistory modelId={modelId} />;

  return (
    <AppShell title={component ? component.name : 'Model'}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-bg-elevated px-2 py-1.5">
        <a href="#/inventory" className="mr-1 flex items-center gap-1 rounded px-1.5 py-1 text-[10.5px] text-text-secondary hover:bg-surface-hover" aria-label="Back to Model Inventory">
          <ArrowLeft size={12} /> Inventory
        </a>
        {component && (
          <Badge tone={component.riskTier === 'High' ? 'negative' : component.riskTier === 'Medium' ? 'warning' : 'positive'}>{component.riskTier} risk</Badge>
        )}
        <nav className="ml-2 flex flex-wrap gap-1" aria-label="Model sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`rounded-md px-2 py-1 text-[11px] ${tab === t.id ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:bg-surface-hover'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <main key={`${modelId}-${tab}`} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">{body}</main>
    </AppShell>
  );
}
