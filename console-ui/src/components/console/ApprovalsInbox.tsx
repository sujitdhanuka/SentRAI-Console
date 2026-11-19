import { CalendarClock, Inbox, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../../api/client';
import { governanceHref } from '../../pages/governanceTabs';
import { GovernanceFeatures, useGovernanceFeatures } from '../../stores/governanceFeatures';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { SkeletonRows } from '../ui/Skeleton';

/** One thing waiting on someone, with a link to where it is acted on. */
export interface WorkItem {
  key: string;
  kind: string;
  title: string;
  detail?: string;
  href: string;
  /** ISO date it is due or was requested; drives the sort. */
  date?: string | null;
  overdue?: boolean;
}

const day = (d?: string | null) => (d ? String(d).slice(0, 10) : '');
const get = <T,>(path: string): Promise<T | null> => api<T>(path).catch(() => null);

type Names = Record<string, string>;
const nameOf = (names: Names, id?: string | null) => (id ? names[id] ?? id.slice(0, 8) : 'organisation');

/** Pending approvals across the console. Each source is read only while its feature is on, and a source that fails is skipped. */
async function loadApprovals(f: GovernanceFeatures, names: Names): Promise<WorkItem[]> {
  const out: WorkItem[] = [];
  const jobs: Array<Promise<void>> = [];
  jobs.push(get<any[]>('/alignment/approvals').then((r) => {
    for (const a of r ?? []) if (a.status === 'PENDING') out.push({
      key: `al-${a.approval_id}`, kind: 'Deployment approval', title: `${a.model_name} → ${a.target_stage}`,
      detail: `${a.approvals_recorded}/${a.required_approvals} approvals · requested by ${a.requested_by}`, href: '#/alignment', date: a.created_at,
    });
  }));
  if (f.riskRegister) jobs.push(get<any>('/governance/risks').then((r) => {
    for (const x of r?.risks ?? []) if (x.status === 'ASSESSED' && !x.within_appetite && !x.acceptance) out.push({
      key: `rk-${x.risk_id}`, kind: 'Risk acceptance', title: x.title,
      detail: `${nameOf(names, x.scope_id)} · residual ${x.assessment?.residual?.band ?? '?'} above appetite${x.required_approvers?.length ? ` · ${x.required_approvers.join(' or ')}` : ''}`,
      href: governanceHref('risks', x.scope_type === 'MODEL' ? x.scope_id : null, { risk: x.risk_id }), date: x.next_review_at,
    });
  }));
  if (f.aims) jobs.push(get<any>('/governance/aims/records').then((r) => {
    for (const x of r?.records ?? []) if (x.status === 'DRAFT') out.push({ key: `ai-${x.record_id}`, kind: 'AIMS record', title: x.title, detail: x.type.replace(/_/g, ' ').toLowerCase(), href: governanceHref('aims'), date: x.updated_at });
  }));
  if (f.documentControl) jobs.push(get<any>('/governance/documents').then((r) => {
    for (const x of r?.documents ?? []) if (x.status === 'DRAFT') out.push({ key: `dc-${x.document_id}`, kind: 'Controlled document', title: `${x.title} v${x.version}`, href: governanceHref('documents') });
  }));
  if (f.soa) jobs.push(get<any>('/governance/soa').then((r) => {
    if (r && (!r.approved || r.approved.changed_since)) out.push({ key: 'soa', kind: 'Statement of Applicability', title: r.approved ? 'Changed since the approved version' : 'Never approved', href: governanceHref('soa') });
  }));
  if (f.aiSecurity) jobs.push(get<any>('/governance/security').then((r) => {
    for (const m of r?.models ?? []) if (m.threatModel === 'DRAFT') out.push({ key: `tm-${m.model_id}`, kind: 'Threat model', title: m.name, detail: 'draft awaiting a second officer', href: governanceHref('security', m.model_id) });
  }));
  if (f.tevv) jobs.push(get<any>('/governance/tevv').then((r) => {
    for (const x of r?.retirements ?? []) if (x.status === 'REQUESTED') out.push({ key: `rt-${x.retirement_id}`, kind: 'Retirement', title: nameOf(names, x.model_id), detail: x.reason, href: governanceHref('tevv', x.model_id), date: x.requested_at });
  }));
  if (f.modelValidation) jobs.push(get<any>('/governance/validations').then((r) => {
    for (const v of r?.validations ?? []) if (['PLANNED', 'IN_PROGRESS'].includes(v.status) && !v.independent && !v.independence_attested_by) out.push({
      key: `va-${v.validation_id}`, kind: 'Validator independence', title: nameOf(names, v.model_id), detail: (v.independence_problems ?? []).join('; ') || 'needs an officer to attest', href: governanceHref('validation', v.model_id),
    });
  }));
  if (f.disclosures) jobs.push(get<any>('/governance/disclosures').then((r) => {
    for (const d of r?.disclosures ?? []) if (d.status === 'DRAFT') out.push({ key: `ds-${d.disclosure_id}`, kind: 'Disclosure', title: d.title, detail: 'draft to publish', href: governanceHref('disclosures'), date: d.updated_at });
  }));
  await Promise.all(jobs);
  return out.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

/** Review clocks that are due in the next 30 days or already overdue, across the console. */
async function loadDue(f: GovernanceFeatures, names: Names): Promise<WorkItem[]> {
  const horizon = Date.now() + 30 * 86_400_000;
  const soon = (d?: string | null) => !!d && new Date(d).getTime() <= horizon;
  const past = (d?: string | null) => !!d && new Date(d).getTime() < Date.now();
  const out: WorkItem[] = [];
  const jobs: Array<Promise<void>> = [];
  jobs.push(get<any[]>('/alignment/attestations').then(async (cs) => {
    for (const c of cs ?? []) if (c.status === 'OPEN') out.push({ key: `at-${c.campaign_id}`, kind: 'Attestation', title: c.title, detail: `${c.attested} of ${c.total_items} attested${c.flagged ? `, ${c.flagged} flagged` : ''}`, href: '#/alignment', date: c.due_at, overdue: past(c.due_at) });
  }));
  if (f.redTeamAuditRules) jobs.push(get<any>('/governance/assurance').then((r) => {
    for (const m of r?.models ?? []) {
      if (m.red_team_due) out.push({ key: `rd-${m.model_id}`, kind: 'Red team', title: m.name, detail: m.red_team_reason ?? 'due', href: governanceHref('assurance', m.model_id), overdue: true });
      if (m.audit_due && soon(m.audit_due)) out.push({ key: `au-${m.model_id}`, kind: 'Audit', title: m.name, href: `#/audit?model=${encodeURIComponent(m.model_id)}`, date: m.audit_due, overdue: !!m.audit_overdue });
    }
    const fr = r?.framework_review;
    if (fr && (fr.overdue || soon(fr.next_due_at))) out.push({ key: 'fr', kind: 'Framework review', title: 'AI policy or management review', href: governanceHref('aims'), date: fr.next_due_at, overdue: !!fr.overdue });
  }));
  if (f.tevv) jobs.push(get<any>('/governance/tevv').then((r) => {
    for (const m of r?.models ?? []) if (m.reviewOverdue) out.push({ key: `tv-${m.model_id}`, kind: 'Test-set review', title: m.name, detail: `${m.reviewOverdue} overdue`, href: governanceHref('tevv', m.model_id), overdue: true });
  }));
  if (f.aims) jobs.push(get<any>('/governance/aims/records').then((r) => {
    for (const x of r?.records ?? []) if (x.status === 'APPROVED' && soon(x.review_due_at)) out.push({ key: `ar-${x.record_id}`, kind: 'AIMS review', title: x.title, href: governanceHref('aims'), date: x.review_due_at, overdue: !!x.review_overdue });
  }));
  if (f.documentControl) jobs.push(get<any>('/governance/documents').then((r) => {
    for (const x of r?.documents ?? []) if (x.status === 'APPROVED' && soon(x.review_due_at)) out.push({ key: `dr-${x.document_id}`, kind: 'Document review', title: x.title, href: governanceHref('documents'), date: x.review_due_at, overdue: !!x.review_overdue });
  }));
  if (f.dataRegister) jobs.push(get<any>('/governance/datasets/retention?days=30').then((r) => {
    for (const d of r?.due ?? []) out.push({ key: `rn-${d.dataset_id}`, kind: 'Data retention', title: d.name, href: governanceHref('datasets'), date: d.retention_until, overdue: !!d.passed });
  }));
  if (f.correctiveActions) jobs.push(get<any>('/governance/actions?overdue=true').then((r) => {
    for (const a of r?.actions ?? []) out.push({
      key: `ca-${a.action_id}`, kind: a.source === 'RISK' ? 'Risk treatment' : 'Corrective action', title: a.action, detail: nameOf(names, a.model_id),
      href: a.source === 'RISK' ? governanceHref('risks', a.model_id, { risk: a.source_id }) : governanceHref('actions'), date: a.due_at, overdue: true,
    });
  }));
  if (f.training) jobs.push(get<any>('/governance/training/matrix').then((r) => {
    const facts = r?.facts;
    if (facts && facts.staff > facts.compliant) out.push({ key: 'tr', kind: 'Training', title: `${facts.staff - facts.compliant} of ${facts.staff} staff not compliant`, href: governanceHref('training'), overdue: true });
  }));
  await Promise.all(jobs);
  return out.sort((a, b) => Number(!!b.overdue) - Number(!!a.overdue) || (a.date ?? '9').localeCompare(b.date ?? '9'));
}

function useModelNames(): Names {
  const [names, setNames] = useState<Names>({});
  useEffect(() => {
    api<any>('/inventory/models')
      .then((r) => setNames(Object.fromEntries((Array.isArray(r) ? r : r.models ?? r.items ?? []).map((m: any) => [m.model_id, m.name]))))
      .catch(() => setNames({}));
  }, []);
  return names;
}

function ItemList({ items, empty }: { items: WorkItem[]; empty: string }) {
  if (!items.length) return <p className="p-3 text-[11px] text-text-secondary">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((i) => (
        <li key={i.key}>
          <a href={i.href} className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 text-[11px] hover:bg-surface-hover">
            <Badge tone={i.overdue ? 'negative' : 'neutral'}>{i.kind}</Badge>
            <span className="font-medium text-text">{i.title}</span>
            {i.detail && <span className="truncate text-[10px] text-text-secondary">{i.detail}</span>}
            {i.date && <span className={`ml-auto font-mono text-[9.5px] ${i.overdue ? 'text-negative' : 'text-text-tertiary'}`}>{day(i.date)}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Approvals inbox and Due soon: one list of every pending sign-off (deployment,
 * risk acceptance, AIMS records, documents, SoA, threat models, retirements,
 * validator independence, disclosures) and every review clock coming due.
 * The actions stay where they are; each row links to its screen.
 */
export function ApprovalsInbox() {
  const features = useGovernanceFeatures((s) => s.features);
  const load = useGovernanceFeatures((s) => s.load);
  const names = useModelNames();
  const [approvals, setApprovals] = useState<WorkItem[] | null>(null);
  const [due, setDue] = useState<WorkItem[] | null>(null);
  useEffect(() => { void load(); }, [load]);
  const refresh = useCallback(async () => {
    if (!features) return;
    setApprovals(null);
    setDue(null);
    const [a, d] = await Promise.all([loadApprovals(features, names), loadDue(features, names)]);
    setApprovals(a);
    setDue(d);
  }, [features, names]);
  useEffect(() => { void refresh(); }, [refresh]);

  const reload = <Button size="xs" variant="ghost" onClick={() => void refresh()} aria-label="Refresh" icon={<RefreshCw size={11} />} />;
  return (
    <div className="grid shrink-0 gap-2 lg:grid-cols-2">
      <Panel
        title="Approvals inbox"
        right={<span className="flex items-center gap-1"><Inbox size={12} className="text-text-tertiary" />{approvals && <Badge tone={approvals.length ? 'warning' : 'positive'}>{approvals.length}</Badge>}{reload}</span>}
        className="max-h-[70vh]"
      >
        {approvals ? <ItemList items={approvals} empty="Nothing waiting for approval." /> : <SkeletonRows rows={3} />}
      </Panel>
      <Panel
        title="Due soon (30 days) and overdue"
        right={<span className="flex items-center gap-1"><CalendarClock size={12} className="text-text-tertiary" />{due && <Badge tone={due.some((x) => x.overdue) ? 'negative' : 'neutral'}>{due.length}</Badge>}</span>}
        className="max-h-[70vh]"
      >
        {due ? <ItemList items={due} empty="Nothing due in the next 30 days." /> : <SkeletonRows rows={3} />}
      </Panel>
    </div>
  );
}
