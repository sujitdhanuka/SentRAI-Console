import { CheckCircle2, FilePlus2, FileText, Wrench } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { fieldClass as FIELD, labelClass as LABEL } from '../components/ui/form';
import { useConsoleUi } from '../stores/consoleUi';
import { governanceHref } from './governanceTabs';
import { useGovernanceFeatures } from '../stores/governanceFeatures';

const useToastCall = () => {
  const toast = useConsoleUi((s) => s.toast);
  return async (fn: () => Promise<any>, ok: string, after?: () => void) => {
    try {
      const r = await fn();
      toast(ok, 'positive');
      after?.();
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'negative');
      return null;
    }
  };
};

/* ------------------------------------------------------------- AIMS */

interface AimsType { type: string; label: string; isoClauses: string[]; required: string[]; peopleItem?: string }
interface AimsRecord { record_id: string; type: string; title: string; content: Record<string, any>; status: string; approved_by: string | null; approved_at: string | null; review_due_at: string | null; review_overdue: boolean; iso_clauses: string[] }
interface OrgControls { packs: Array<{ pack_id: string; version: string; clauses: Array<{ code: string; clause: string; name: string; passed: boolean; not_assessed: boolean; evidence: string; gap: string }> }> }

/** Starter content per type so the form shows the fields that record needs. */
const TEMPLATES: Record<string, Record<string, any>> = {
  SCOPE: { boundaries: '', ai_systems: '', exclusions: '', justification: '' },
  POLICY: { sections: { purpose_alignment: '', objectives_framework: '', requirements_commitment: '', continual_improvement: '', governance_structure: '', accountability: '', risk_appetite: '', operational_safeguards: '', auditability: '', consumer_protection: '', ai_disclosures: '', model_lifecycle: '', liability: '' } },
  CONTEXT: { internal_issues: '', external_issues: '', climate_change_relevant: false },
  INTERESTED_PARTY: { party: '', needs: '', requirements: '' },
  OBJECTIVE: { objective: '', measure: '', target: '', due_date: '' },
  MGMT_REVIEW: { review_date: new Date().toISOString().slice(0, 10), attendees: [], decisions: [], actions: [] },
  AUDIT_PROGRAMME: { period: '', audits: [{ area: '', planned_date: '', auditor: '', auditor_independent: true, objectivity_note: '' }] },
  RESOURCE: { description: '' },
  COMMUNICATION: { description: '' },
  CHANGE: { description: '' },
  COMPETENCE: { person_or_role: '', evidence: '', date: '' },
  AWARENESS: { person_or_role: '', evidence: '', date: '' },
};

export function AimsTab() {
  const features = useGovernanceFeatures((s) => s.features);
  const call = useToastCall();
  const [types, setTypes] = useState<AimsType[]>([]);
  const [records, setRecords] = useState<AimsRecord[]>([]);
  const [ctl, setCtl] = useState<OrgControls | null>(null);
  const [type, setType] = useState('SCOPE');
  const [editing, setEditing] = useState<{ id?: string; title: string; json: string } | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [t, r, c] = await Promise.all([
        api<{ types: AimsType[] }>('/governance/aims/types'),
        api<{ records: AimsRecord[] }>('/governance/aims/records'),
        api<OrgControls>('/governance/aims/controls'),
      ]);
      setTypes(t.types);
      setRecords(r.records);
      setCtl(c);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <Panel title="AIMS workspace"><PanelError onRetry={load} /></Panel>;
  if (!ctl) return <Skeleton className="h-96 w-full" />;
  const ofType = records.filter((r) => r.type === type);
  const t = types.find((x) => x.type === type);

  const startNew = async () => {
    let content = TEMPLATES[type] ?? {};
    if (type === 'MGMT_REVIEW') {
      const inputs = await api<{ inputs: Record<string, any> }>('/governance/aims/mgmt-review/inputs').catch(() => null);
      content = { ...content, inputs: inputs?.inputs ?? {} };
    }
    setEditing({ title: t?.label ?? type, json: JSON.stringify(content, null, 2) });
  };
  const save = async () => {
    if (!editing) return;
    let content: any;
    try { content = JSON.parse(editing.json); } catch { return call(async () => { throw new Error('Content is not valid JSON'); }, ''); }
    await call(
      () => (editing.id
        ? api(`/governance/aims/records/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ title: editing.title, content }) })
        : api(`/governance/aims/${type}`, { method: 'POST', body: JSON.stringify({ title: editing.title, content }) })),
      'Saved as draft',
      () => { setEditing(null); void load(); },
    );
  };

  return (
    <div className="grid gap-2 lg:grid-cols-[220px_1fr_360px]">
      <Panel title="Records">
        <ul className="py-1">
          {types.map((x) => {
            const list = records.filter((r) => r.type === x.type);
            const approved = list.filter((r) => r.status === 'APPROVED').length;
            const overdue = list.some((r) => r.review_overdue);
            return (
              <li key={x.type}>
                <button onClick={() => { setType(x.type); setEditing(null); }} className={`flex w-full items-center justify-between px-3 py-1 text-left text-[11px] ${type === x.type ? 'bg-surface-hover text-text' : 'text-text-secondary hover:bg-surface-hover'}`}>
                  <span>{x.label}</span>
                  <Badge tone={overdue ? 'negative' : approved ? 'positive' : 'neutral'}>{approved}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title={t?.label ?? type} right={<span className="font-mono text-[9px] text-text-tertiary">ISO {t?.isoClauses.join(', ')}</span>}>
        <div className="space-y-2 p-3">
          {(type === 'COMPETENCE' || type === 'AWARENESS') && features?.training && (
            <p className="rounded border border-border bg-bg-elevated px-2 py-1 text-[10.5px] text-text-secondary">
              Course completions and policy acknowledgements are kept in <a className="text-accent hover:underline" href={governanceHref('training')}>Training</a>. Record here only evidence Training does not hold (for example an external certification).
            </p>
          )}
          {ofType.map((r) => (
            <div key={r.record_id} className="rounded border border-border p-2">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-medium text-text">{r.title}</span>
                <Badge tone={r.status === 'APPROVED' ? (r.review_overdue ? 'negative' : 'positive') : 'neutral'}>{r.review_overdue ? 'review overdue' : r.status}</Badge>
                {r.approved_by && <span className="text-[10px] text-text-tertiary">approved by {r.approved_by}{r.review_due_at ? `, review ${new Date(r.review_due_at).toLocaleDateString()}` : ''}</span>}
                <span className="ml-auto flex gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setEditing({ id: r.record_id, title: r.title, json: JSON.stringify(r.content, null, 2) })}>Edit</Button>
                  {r.status === 'DRAFT' && (
                    <Button size="xs" variant="secondary" onClick={() => call(() => api(`/governance/aims/records/${r.record_id}/approve`, { method: 'POST' }), 'Approved', load)}>
                      <CheckCircle2 size={10} /> Approve
                    </Button>
                  )}
                </span>
              </div>
            </div>
          ))}
          {!ofType.length && !editing && <p className="text-[11px] text-text-secondary">No {t?.label.toLowerCase()} yet.</p>}
          {editing ? (
            <div className="rounded border border-border-strong p-2">
              <label className={LABEL} htmlFor="aims-title">Title</label>
              <input id="aims-title" className={FIELD} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              <label className={`${LABEL} mt-2`} htmlFor="aims-content">Content (required: {t?.required.join(', ') || 'see fields'})</label>
              <textarea id="aims-content" rows={14} className={`${FIELD} font-mono`} value={editing.json} onChange={(e) => setEditing({ ...editing, json: e.target.value })} />
              <div className="mt-1 flex gap-1">
                <Button size="sm" variant="primary" onClick={save}>Save draft</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={startNew}><FilePlus2 size={12} /> New {t?.label.toLowerCase()}</Button>
          )}
        </div>
      </Panel>
      <Panel title="Organisation controls" right={<Button size="xs" variant="ghost" onClick={() => call(() => api('/governance/aims/controls/evaluate', { method: 'POST' }), 'Results recorded', load)}>Record</Button>}>
        <div className="divide-y divide-border">
          {ctl.packs.map((p) => (
            <div key={p.pack_id} className="px-3 py-2">
              <div className={LABEL}>{p.pack_id} v{p.version}</div>
              {p.clauses.map((c) => (
                <div key={`${c.code}-${c.name}`} className="flex items-start gap-2 py-0.5 text-[10.5px]">
                  <Badge tone={c.not_assessed ? 'warning' : c.passed ? 'positive' : 'negative'}>{c.not_assessed ? 'n/a' : c.passed ? 'pass' : 'gap'}</Badge>
                  <div>
                    <div className="text-text"><span className="font-mono text-accent">{c.clause}</span> {c.name}</div>
                    <div className="text-text-tertiary">{c.evidence}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------- corrective actions */

interface CA { read_only?: boolean; treatment?: string; action_id: string; source: string; source_id: string | null; model_id: string | null; nonconformity: string; root_cause: string | null; action: string; due_at: string | null; status: string; overdue: boolean; effectiveness_review: string | null; effective: boolean | null }

export function ActionsTab() {
  const call = useToastCall();
  const [list, setList] = useState<{ actions: CA[]; summary: { open: number; overdue: number; risk_treatments_open?: number; risk_treatments_overdue?: number } } | null>(null);
  const [filter, setFilter] = useState('open');
  const [form, setForm] = useState({ nonconformity: '', action: '', due_at: '' });
  const [closing, setClosing] = useState<{ id: string; root_cause: string; effectiveness_review: string; effective: boolean } | null>(null);
  const load = useCallback(async () => {
    const q = filter === 'open' ? '?status=OPEN,IN_PROGRESS,AWAITING_EFFECTIVENESS' : filter === 'overdue' ? '?overdue=true' : '';
    setList(await api(`/governance/actions${q}`));
  }, [filter]);
  useEffect(() => { void load().catch(() => setList({ actions: [], summary: { open: 0, overdue: 0 } })); }, [load]);
  if (!list) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <select aria-label="Filter" className={`${FIELD} w-40`} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Open</option><option value="overdue">Overdue</option><option value="all">All</option>
        </select>
        <Badge tone="neutral">{list.summary.open} open</Badge>
        <Badge tone={list.summary.overdue ? 'negative' : 'positive'}>{list.summary.overdue} overdue</Badge>
        {list.summary.risk_treatments_open !== undefined && (
          <Badge tone={list.summary.risk_treatments_overdue ? 'negative' : 'neutral'} title="Treatment actions from the risk register, listed here so every action owed is in one queue">
            {list.summary.risk_treatments_open} risk treatments open{list.summary.risk_treatments_overdue ? `, ${list.summary.risk_treatments_overdue} overdue` : ''}
          </Badge>
        )}
      </div>
      <Panel title="Actions: corrective (ISO 10.2) and risk treatments" right={<Wrench size={13} className="text-text-tertiary" />}>
        <ul className="divide-y divide-border">
          {list.actions.map((a) => (
            <li key={a.action_id} className={`px-3 py-2 ${a.overdue ? 'bg-negative-soft' : ''}`}>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge tone="neutral">{a.source === 'RISK' ? `risk · ${(a.treatment ?? '').toLowerCase()}` : a.source.replace('_', ' ')}</Badge>
                <Badge tone={a.status === 'CLOSED' ? 'positive' : a.overdue ? 'negative' : 'warning'}>{a.overdue ? 'overdue' : a.status.replace(/_/g, ' ')}</Badge>
                <span className="text-text">{a.action}</span>
                {a.due_at && <span className="text-[10px] text-text-tertiary">due {new Date(a.due_at).toLocaleDateString()}</span>}
                {a.read_only ? (
                  <a className="ml-auto text-[10.5px] text-accent hover:underline" href={governanceHref('risks', a.model_id, a.source_id ? { risk: a.source_id } : undefined)}>Open in risk register</a>
                ) : !['CLOSED', 'CANCELLED'].includes(a.status) && (
                  <Button className="ml-auto" size="xs" variant="secondary" onClick={() => setClosing({ id: a.action_id, root_cause: a.root_cause ?? '', effectiveness_review: '', effective: true })}>Close…</Button>
                )}
              </div>
              <p className="mt-0.5 text-[10.5px] text-text-secondary">{a.nonconformity}</p>
              {a.effectiveness_review && <p className="text-[10px] text-text-tertiary">Effectiveness: {a.effectiveness_review}</p>}
              {closing?.id === a.action_id && (
                <div className="mt-1 grid gap-1">
                  <input aria-label="Root cause" className={FIELD} placeholder="Root cause" value={closing.root_cause} onChange={(e) => setClosing({ ...closing, root_cause: e.target.value })} />
                  <input aria-label="Effectiveness review" className={FIELD} placeholder="Effectiveness review: did it stop recurrence?" value={closing.effectiveness_review} onChange={(e) => setClosing({ ...closing, effectiveness_review: e.target.value })} />
                  <label className="flex items-center gap-1 text-[10.5px] text-text-secondary"><input type="checkbox" checked={closing.effective} onChange={(e) => setClosing({ ...closing, effective: e.target.checked })} /> Effective</label>
                  <div className="flex gap-1">
                    <Button size="xs" variant="primary" onClick={() => call(() => api(`/governance/actions/${a.action_id}/close`, { method: 'POST', body: JSON.stringify(closing) }), closing.effective ? 'Closed' : 'Kept open: not effective', () => { setClosing(null); void load(); })}>Submit</Button>
                    <Button size="xs" variant="ghost" onClick={() => setClosing(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {!list.actions.length && <li className="px-3 py-3 text-[11px] text-text-secondary">Nothing here.</li>}
        </ul>
        <div className="flex flex-wrap gap-1 border-t border-border p-2">
          <input aria-label="Nonconformity" className={`${FIELD} flex-1`} placeholder="Nonconformity (organisation-level)" value={form.nonconformity} onChange={(e) => setForm({ ...form, nonconformity: e.target.value })} />
          <input aria-label="Action" className={`${FIELD} flex-1`} placeholder="Corrective action" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} />
          <input aria-label="Due" type="date" className={`${FIELD} w-36`} value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
          <Button size="xs" variant="secondary" disabled={form.nonconformity.trim().length < 5 || form.action.trim().length < 3}
            onClick={() => call(() => api('/governance/actions', { method: 'POST', body: JSON.stringify({ source: 'OTHER', ...form, due_at: form.due_at || undefined }) }), 'Action raised', () => { setForm({ nonconformity: '', action: '', due_at: '' }); void load(); })}>
            Raise
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------- documents */

interface Doc { document_id: string; series_id: string; doc_type: string; title: string; version: number; hash: string; uri: string; status: string; approved_by: string | null; review_due_at: string | null; review_overdue: boolean; versions?: Doc[] }

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function DocumentsTab() {
  const call = useToastCall();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  const [form, setForm] = useState({ doc_type: 'POLICY', title: '', uri: '', hash: '', review_due_at: '' });
  const load = useCallback(async () => setDocs((await api<{ documents: Doc[] }>('/governance/documents')).documents), []);
  useEffect(() => { void load().catch(() => setDocs([])); }, [load]);
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setForm((x) => ({ ...x, title: x.title || f.name }));
    const h = await sha256(await f.text());
    setForm((x) => ({ ...x, hash: h }));
  };
  if (!docs) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="grid gap-2 lg:grid-cols-[1fr_380px]">
      <Panel title="Controlled documents (ISO 7.5)" right={<FileText size={13} className="text-text-tertiary" />}>
        <table className="w-full text-[11px]">
          <thead><tr className="text-left text-[9px] uppercase tracking-wider text-text-tertiary"><th className="px-3 py-1">Document</th><th>Type</th><th>Version</th><th>Status</th><th className="pr-3">Review</th></tr></thead>
          <tbody className="divide-y divide-border">
            {docs.map((d) => (
              <tr key={d.document_id} className="cursor-pointer hover:bg-surface-hover" onClick={async () => setOpen(await api<Doc>(`/governance/documents/${d.document_id}`))}>
                <td className="px-3 py-1 text-text">{d.title}</td>
                <td><Badge tone="neutral">{d.doc_type}</Badge></td>
                <td className="font-mono">v{d.version}</td>
                <td><Badge tone={d.status === 'APPROVED' ? 'positive' : 'warning'}>{d.status}</Badge></td>
                <td className={`pr-3 ${d.review_overdue ? 'text-negative' : 'text-text-secondary'}`}>{d.review_due_at ? new Date(d.review_due_at).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {!docs.length && <tr><td colSpan={5} className="px-3 py-3 text-text-secondary">No controlled documents yet.</td></tr>}
          </tbody>
        </table>
        <div className="grid gap-1 border-t border-border p-2 md:grid-cols-2">
          <select aria-label="Document type" className={FIELD} value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })}>
            {['POLICY', 'PROCEDURE', 'EVIDENCE', 'RECORD', 'REPORT', 'OTHER'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <input aria-label="Document title" className={FIELD} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input aria-label="Document location" className={FIELD} placeholder="Where the controlled copy lives (URL or path)" value={form.uri} onChange={(e) => setForm({ ...form, uri: e.target.value })} />
          <label className="text-[10px] text-text-secondary">Hash from a local file (never uploaded)
            <input aria-label="File to hash" type="file" className="block text-[10px]" onChange={(e) => void pickFile(e.target.files?.[0])} />
          </label>
          <input aria-label="SHA-256" className={`${FIELD} font-mono md:col-span-2`} placeholder="SHA-256" value={form.hash} onChange={(e) => setForm({ ...form, hash: e.target.value })} />
          <Button size="sm" variant="secondary" disabled={!form.title || !form.uri || form.hash.length !== 64}
            onClick={() => call(() => api('/governance/documents', { method: 'POST', body: JSON.stringify({ ...form, review_due_at: form.review_due_at || undefined }) }), 'Document registered as a draft', () => { setForm({ doc_type: 'POLICY', title: '', uri: '', hash: '', review_due_at: '' }); void load(); })}>
            Register document
          </Button>
        </div>
      </Panel>
      {open && (
        <Panel title={open.title}>
          <div className="space-y-2 p-3 text-[11px]">
            <div className="break-all font-mono text-[9.5px] text-text-tertiary">{open.uri}</div>
            {(open.versions ?? []).map((v) => (
              <div key={v.document_id} className="flex items-center gap-2">
                <span className="font-mono">v{v.version}</span>
                <Badge tone={v.status === 'APPROVED' ? 'positive' : v.status === 'DRAFT' ? 'warning' : 'neutral'}>{v.status}</Badge>
                <span className="truncate font-mono text-[9px] text-text-tertiary" title={v.hash}>{v.hash.slice(0, 16)}…</span>
                {v.status === 'DRAFT' && (
                  <Button className="ml-auto" size="xs" variant="primary" onClick={() => call(() => api(`/governance/documents/${v.document_id}/approve`, { method: 'POST', body: '{}' }), 'Approved', async () => { await load(); setOpen(await api<Doc>(`/governance/documents/${v.document_id}`)); })}>Approve</Button>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
