import { CheckCircle2, ClipboardCheck, Flag, Plus, Rocket, Stamp, XCircle } from 'lucide-react';
import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { useModels } from '../api/models';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { fieldClass as FIELD, labelClass as LABEL } from '../components/ui/form';
import { useConsoleUi } from '../stores/consoleUi';
import { routeParam } from '../stores/route';
import { useSession } from '../stores/session';
import { ApprovalsInbox } from '../components/console/ApprovalsInbox';

interface DecisionRec {
  actor: string; role: string; decision: 'APPROVE' | 'REJECT'; note: string | null; decidedAt: string;
}
interface Approval {
  approval_id: string; model_id: string; model_name: string; risk_level: string;
  target_stage: string; status: string; required_approvals: number; approvals_recorded: number;
  requested_by: string; requested_by_role: string; request_note: string | null;
  decisions: DecisionRec[]; created_at: string; resolved_at: string | null;
}
interface Campaign {
  campaign_id: string; title: string; risk_filter: string | null; cadence_days: number; status: string;
  total_items: number; attested: number; flagged: number; pending: number;
  opened_by: string; note: string | null; due_at: string; created_at: string; closed_at: string | null;
}
interface AttItem {
  item_id: string; campaign_id: string; model_id: string; model_name: string; risk_level: string;
  status: string; attested_by: string | null; attested_by_role: string | null; note: string | null;
  due_at: string; attested_at: string | null; is_overdue: boolean;
}

type ToastFn = (message: string, tone?: 'info' | 'positive' | 'negative') => void;

const RISK_TONE = (r: string): BadgeTone => (r === 'HIGH' ? 'negative' : r === 'MEDIUM' ? 'warning' : 'accent');
const APPROVAL_TONE: Record<string, BadgeTone> = {
  PENDING: 'warning', APPROVED: 'positive', REJECTED: 'negative', WITHDRAWN: 'neutral',
};
const ITEM_TONE: Record<string, BadgeTone> = { PENDING: 'warning', ATTESTED: 'positive', FLAGGED: 'negative' };
const DECIDER_ROLES = ['APPROVER', 'CISO', 'ADMIN'];
const ATTESTER_ROLES = ['OWNER', 'REVIEWER', 'APPROVER', 'CISO', 'ADMIN'];
const CAMPAIGN_ADMIN_ROLES = ['OWNER', 'APPROVER', 'CISO', 'ADMIN'];

/**
 * Pillar 1 — Alignment. Two governance workflows that keep every AI system doing
 * what the institution sanctioned: review-board sign-off before a MEDIUM/HIGH
 * model can go live, and periodic attestation campaigns that re-certify the
 * active inventory. Both write to the model ledger, so the record is permanent.
 */
export function Alignment() {
  const toast = useConsoleUi((s) => s.toast);
  // #/alignment?tab=approvals (a workflow step) opens that tab.
  const [tab, setTab] = useState<'inbox' | 'approvals' | 'attestations'>(() => {
    const t = routeParam('tab');
    return t === 'approvals' || t === 'attestations' ? t : 'inbox';
  });
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `silent` refreshes (after an action) skip the skeleton so an expanded
  // campaign or in-progress form keeps its place — only the first load spins.
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const [a, c] = await Promise.all([
        api<Approval[]>('/alignment/approvals'),
        api<Campaign[]>('/alignment/attestations'),
      ]);
      setApprovals(Array.isArray(a) ? a : []);
      setCampaigns(Array.isArray(c) ? c : []);
      setError(null);
    } catch (e) {
      if (!opts?.silent) setError(e instanceof Error ? e.message : 'Failed to load alignment data');
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load({ silent: true }), [load]);

  useEffect(() => { void load(); }, [load]);

  const pendingApprovals = approvals.filter((a) => a.status === 'PENDING').length;
  const readyToPromote = approvals.filter((a) => a.status === 'APPROVED').length;
  const openCampaigns = campaigns.filter((c) => c.status === 'OPEN').length;
  const overdueCampaigns = campaigns.filter((c) => c.status === 'OPEN' && c.pending > 0 && new Date(c.due_at).getTime() < Date.now()).length;
  const flaggedModels = campaigns.reduce((n, c) => n + c.flagged, 0);

  const TabBtn = ({ id, label }: { id: 'inbox' | 'approvals' | 'attestations'; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={`rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
        tab === id ? 'bg-accent text-white' : 'border border-border text-text-secondary hover:bg-surface-hover'
      }`}
    >
      {label}
    </button>
  );

  return (
    <AppShell
      title="Alignment"
      actions={<><TabBtn id="inbox" label="Inbox & due soon" /><TabBtn id="approvals" label="Deployment approvals" /><TabBtn id="attestations" label="Attestations" /></>}
    >
      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-5">
        <Kpi label="Pending approvals" value={pendingApprovals} tone={pendingApprovals ? 'warning' : 'ok'} />
        <Kpi label="Ready to promote" value={readyToPromote} tone={readyToPromote ? 'accent' : 'muted'} />
        <Kpi label="Open campaigns" value={openCampaigns} tone={openCampaigns ? 'accent' : 'muted'} />
        <Kpi label="Overdue campaigns" value={overdueCampaigns} tone={overdueCampaigns ? 'negative' : 'ok'} sub="past due date" />
        <Kpi label="Flagged models" value={flaggedModels} tone={flaggedModels ? 'negative' : 'ok'} />
      </div>

      <main className="flex min-h-0 flex-1 flex-col p-2">
        {error ? (
          <Panel title="Alignment" className="flex-1"><PanelError onRetry={load} /></Panel>
        ) : loading ? (
          <Panel title="Alignment" className="flex-1"><SkeletonRows rows={6} /></Panel>
        ) : tab === 'inbox' ? (
          <div className="min-h-0 flex-1 overflow-y-auto"><ApprovalsInbox /></div>
        ) : tab === 'approvals' ? (
          <ApprovalsPanel approvals={approvals} reload={refresh} toast={toast} />
        ) : (
          <AttestationsPanel campaigns={campaigns} reload={refresh} toast={toast} />
        )}
      </main>
    </AppShell>
  );
}

function Kpi({ label, value, tone, sub }: { label: string; value: number; tone: 'ok' | 'warning' | 'negative' | 'accent' | 'muted'; sub?: string }) {
  const cls = tone === 'negative' ? 'text-negative' : tone === 'warning' ? 'text-warning' : tone === 'accent' ? 'text-accent' : tone === 'ok' ? 'text-positive' : 'text-text';
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">{label}</div>
      <div className={`font-mono text-base leading-tight ${cls}`}>{value}</div>
      {sub && <div className="font-mono text-[8.5px] text-text-tertiary">{sub}</div>}
    </div>
  );
}

// ─── Approvals ──────────────────────────────────────────────────────────────

function ApprovalsPanel({ approvals, reload, toast }: { approvals: Approval[]; reload: () => Promise<void>; toast: ToastFn }) {
  const { models } = useModels();
  const user = useSession((s) => s.user);
  const role = user?.role ?? 'VIEWER';
  const email = user?.email ?? '';
  const canDecide = DECIDER_ROLES.includes(role);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modelId, setModelId] = useState('');
  const [stage, setStage] = useState('DEPLOYED');
  const [quorum, setQuorum] = useState(1);
  const [note, setNote] = useState('');
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});

  useEffect(() => { if (!modelId && models.length) setModelId(models[0].model_id); }, [models, modelId]);

  const request = async (e: FormEvent) => {
    e.preventDefault();
    if (!modelId) return;
    setBusy(true);
    try {
      await api('/alignment/approvals', {
        method: 'POST',
        body: JSON.stringify({ model_id: modelId, target_stage: stage, required_approvals: quorum, note: note.trim() || undefined }),
      });
      toast('Approval requested — the board can now sign off', 'positive');
      setOpen(false); setNote('');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Request failed', 'negative');
    } finally { setBusy(false); }
  };

  const decide = async (a: Approval, decision: 'APPROVE' | 'REJECT') => {
    try {
      await api(`/alignment/approvals/${a.approval_id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision, note: decisionNote[a.approval_id]?.trim() || undefined }),
      });
      toast(`Decision recorded: ${decision === 'APPROVE' ? 'approved' : 'rejected'}`, decision === 'APPROVE' ? 'positive' : 'negative');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Decision failed', 'negative');
    }
  };

  const withdraw = async (a: Approval) => {
    try {
      await api(`/alignment/approvals/${a.approval_id}/withdraw`, { method: 'POST' });
      toast('Request withdrawn');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Withdraw failed', 'negative');
    }
  };

  const promote = async (a: Approval) => {
    try {
      await api(`/inventory/models/${a.model_id}/lifecycle`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: a.target_stage, actor: email || 'dashboard_user' }),
      });
      toast(`${a.model_name} promoted to ${a.target_stage}`, 'positive');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Promotion failed', 'negative');
    }
  };

  return (
    <>
      {open && (
        <form onSubmit={request} className="mb-2 rounded-md border border-border bg-surface p-3">
          <div className="grid gap-2 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className={LABEL}>Model</label>
              <select className={FIELD} value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name} · {m.risk_level}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL}>Target stage</label>
              <select className={FIELD} value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="DEPLOYED">DEPLOYED</option>
                <option value="MONITORING">MONITORING</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Approvals needed</label>
              <input type="number" min={1} max={5} className={`${FIELD} font-mono`} value={quorum} onChange={(e) => setQuorum(Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
          </div>
          <div className="mt-2">
            <label className={LABEL}>Note to the board (optional)</label>
            <textarea rows={2} className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this model is ready for production — validation results, sign-offs obtained, residual risks accepted." />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !modelId}>{busy ? 'Requesting…' : 'Request sign-off'}</Button>
          </div>
        </form>
      )}

      <Panel
        title="Review-board approvals"
        className="flex-1"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <p className="max-w-[80ch] text-[10.5px] text-text-secondary">
            A MEDIUM/HIGH-risk model needs a recorded board sign-off before it goes live. The requester cannot approve their own request (separation of duties), and every decision is written to the model ledger.
          </p>
          <Button variant="primary" size="sm" onClick={() => setOpen((v) => !v)} icon={<Plus size={12} />}>Request</Button>
        </div>
        {!approvals.length ? (
          <Empty icon={<Stamp size={20} />} text="No approval requests yet. Request board sign-off for a model heading to production." />
        ) : (
          <ul className="divide-y divide-border">
            {approvals.map((a) => {
              const isRequester = a.requested_by === email;
              const showDecide = a.status === 'PENDING' && canDecide && !isRequester;
              const showWithdraw = a.status === 'PENDING' && (isRequester || role === 'ADMIN' || role === 'CISO');
              return (
                <li key={a.approval_id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={APPROVAL_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                    <Badge tone={RISK_TONE(a.risk_level)}>{a.risk_level}</Badge>
                    <span className="text-[11.5px] font-medium text-text">{a.model_name}</span>
                    <span className="font-mono text-[9px] text-text-tertiary">→ {a.target_stage}</span>
                    <span className="ml-auto font-mono text-[9px] text-text-tertiary">
                      {a.approvals_recorded}/{a.required_approvals} approvals
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[9px] text-text-tertiary">
                    requested by {a.requested_by} ({a.requested_by_role}) · {new Date(a.created_at).toLocaleString()}
                  </p>
                  {a.request_note && <p className="mt-1 max-w-[95ch] text-[10.5px] text-text-secondary">“{a.request_note}”</p>}

                  {a.decisions.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 border-l-2 border-border pl-2">
                      {a.decisions.map((d, i) => (
                        <li key={i} className="flex items-center gap-1.5 font-mono text-[9px]">
                          {d.decision === 'APPROVE'
                            ? <CheckCircle2 size={11} className="text-positive" />
                            : <XCircle size={11} className="text-negative" />}
                          <span className={d.decision === 'APPROVE' ? 'text-positive' : 'text-negative'}>{d.decision}</span>
                          <span className="text-text-tertiary">by {d.actor} ({d.role})</span>
                          {d.note && <span className="text-text-secondary">— {d.note}</span>}
                        </li>
                      ))}
                    </ul>
                  )}

                  {showDecide && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        className={`${FIELD} max-w-[42ch]`}
                        placeholder="Decision note (optional)"
                        value={decisionNote[a.approval_id] ?? ''}
                        onChange={(e) => setDecisionNote((p) => ({ ...p, [a.approval_id]: e.target.value }))}
                      />
                      <Button variant="primary" size="sm" onClick={() => decide(a, 'APPROVE')} icon={<CheckCircle2 size={12} />}>Approve</Button>
                      <Button variant="danger" size="sm" onClick={() => decide(a, 'REJECT')} icon={<XCircle size={12} />}>Reject</Button>
                    </div>
                  )}
                  {a.status === 'PENDING' && canDecide && isRequester && (
                    <p className="mt-1.5 font-mono text-[9px] text-warning">You raised this request — a different approver must decide it.</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {a.status === 'APPROVED' && (
                      <Button variant="primary" size="sm" onClick={() => promote(a)} icon={<Rocket size={12} />}>Promote to {a.target_stage}</Button>
                    )}
                    {showWithdraw && <Button variant="ghost" size="sm" onClick={() => withdraw(a)}>Withdraw</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}

// ─── Attestations ───────────────────────────────────────────────────────────

function AttestationsPanel({ campaigns, reload, toast }: { campaigns: Campaign[]; reload: () => Promise<void>; toast: ToastFn }) {
  const user = useSession((s) => s.user);
  const role = user?.role ?? 'VIEWER';
  const canOpen = CAMPAIGN_ADMIN_ROLES.includes(role);
  const canAttest = ATTESTER_ROLES.includes(role);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState(90);
  const [riskFilter, setRiskFilter] = useState('');
  const [note, setNote] = useState('');

  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<AttItem[]>([]);
  const [itemNote, setItemNote] = useState<Record<string, string>>({});

  const openCampaign = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/alignment/attestations', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), cadence_days: cadence, risk_filter: riskFilter || undefined, note: note.trim() || undefined }),
      });
      toast('Campaign opened — the active inventory is queued for attestation', 'positive');
      setOpen(false); setTitle(''); setNote('');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open campaign', 'negative');
    } finally { setBusy(false); }
  };

  const expand = async (c: Campaign) => {
    if (expanded === c.campaign_id) { setExpanded(null); return; }
    setExpanded(c.campaign_id);
    setItems([]);
    try {
      const detail = await api<Campaign & { items: AttItem[] }>(`/alignment/attestations/${c.campaign_id}`);
      setItems(detail.items ?? []);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load items', 'negative');
    }
  };

  const attest = async (item: AttItem, decision: 'ATTEST' | 'FLAG') => {
    try {
      await api(`/alignment/attestations/items/${item.item_id}/attest`, {
        method: 'POST',
        body: JSON.stringify({ decision, note: itemNote[item.item_id]?.trim() || undefined }),
      });
      toast(decision === 'ATTEST' ? 'Attested' : 'Flagged for review', decision === 'ATTEST' ? 'positive' : 'negative');
      setItems((prev) => prev.map((i) => i.item_id === item.item_id
        ? { ...i, status: decision === 'ATTEST' ? 'ATTESTED' : 'FLAGGED', attested_by: user?.email ?? null } : i));
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Attestation failed', 'negative');
    }
  };

  const closeCampaign = async (c: Campaign) => {
    try {
      await api(`/alignment/attestations/${c.campaign_id}/close`, { method: 'POST' });
      toast('Campaign closed');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Close failed', 'negative');
    }
  };

  return (
    <>
      {open && (
        <form onSubmit={openCampaign} className="mb-2 rounded-md border border-border bg-surface p-3">
          <div className="grid gap-2 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className={LABEL}>Campaign title</label>
              <input className={FIELD} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q3 2026 model re-certification" />
            </div>
            <div>
              <label className={LABEL}>Cadence (days)</label>
              <input type="number" min={1} max={365} className={`${FIELD} font-mono`} value={cadence} onChange={(e) => setCadence(Math.min(365, Math.max(1, Number(e.target.value) || 90)))} />
            </div>
            <div>
              <label className={LABEL}>Scope</label>
              <select className={FIELD} value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
                <option value="">All active models</option>
                <option value="MEDIUM">MEDIUM &amp; HIGH only</option>
                <option value="HIGH">HIGH only</option>
              </select>
            </div>
          </div>
          <div className="mt-2">
            <label className={LABEL}>Note (optional)</label>
            <input className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What owners should confirm this cycle." />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !title.trim()}>{busy ? 'Opening…' : 'Open campaign'}</Button>
          </div>
        </form>
      )}

      <Panel title="Attestation campaigns" className="flex-1">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <p className="max-w-[80ch] text-[10.5px] text-text-secondary">
            Periodic re-certification of the active inventory. Owners attest each model is still within its sanctioned scope, or flag it. Items left pending past the due date are escalated automatically.
          </p>
          {canOpen && <Button variant="primary" size="sm" onClick={() => setOpen((v) => !v)} icon={<Plus size={12} />}>Open campaign</Button>}
        </div>
        {!campaigns.length ? (
          <Empty icon={<ClipboardCheck size={20} />} text={canOpen ? 'No campaigns yet. Open one to re-certify the active inventory.' : 'No attestation campaigns yet.'} />
        ) : (
          <ul className="divide-y divide-border">
            {campaigns.map((c) => {
              const pct = c.total_items ? Math.round(((c.attested + c.flagged) / c.total_items) * 100) : 0;
              const overdue = c.status === 'OPEN' && c.pending > 0 && new Date(c.due_at).getTime() < Date.now();
              return (
                <li key={c.campaign_id} className="px-3 py-2">
                  <button onClick={() => expand(c)} className="flex w-full flex-wrap items-center gap-1.5 text-left">
                    <Badge tone={c.status === 'OPEN' ? 'accent' : 'neutral'}>{c.status}</Badge>
                    {c.risk_filter && <Badge tone={RISK_TONE(c.risk_filter)}>{c.risk_filter}+</Badge>}
                    <span className="text-[11.5px] font-medium text-text">{c.title}</span>
                    {c.flagged > 0 && <Badge tone="negative">{c.flagged} flagged</Badge>}
                    {overdue && <Badge tone="negative">overdue</Badge>}
                    <span className="ml-auto font-mono text-[9px] text-text-tertiary">
                      {c.attested + c.flagged}/{c.total_items} done · due {new Date(c.due_at).toLocaleDateString()}
                    </span>
                  </button>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-bg-elevated">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                  </div>

                  {expanded === c.campaign_id && (
                    <div className="mt-2 rounded-md border border-border bg-bg-elevated p-2">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[9px] text-text-tertiary">
                          opened by {c.opened_by} · every {c.cadence_days} days{c.note ? ` · ${c.note}` : ''}
                        </span>
                        {c.status === 'OPEN' && canOpen && (
                          <Button variant="ghost" size="xs" onClick={() => closeCampaign(c)}>Close campaign</Button>
                        )}
                      </div>
                      {!items.length ? (
                        <p className="px-1 py-2 text-[10.5px] text-text-secondary">Loading items…</p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {items.map((it) => (
                            <li key={it.item_id} className="py-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge tone={ITEM_TONE[it.status] ?? 'neutral'}>{it.status}</Badge>
                                <Badge tone={RISK_TONE(it.risk_level)}>{it.risk_level}</Badge>
                                <span className="text-[11px] text-text">{it.model_name}</span>
                                {it.is_overdue && <span className="font-mono text-[9px] text-negative">overdue</span>}
                                {it.attested_by && <span className="ml-auto font-mono text-[9px] text-text-tertiary">by {it.attested_by}</span>}
                              </div>
                              {it.note && <p className="mt-0.5 pl-1 text-[10px] text-text-secondary">“{it.note}”</p>}
                              {it.status === 'PENDING' && canAttest && (
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <input
                                    className={`${FIELD} max-w-[38ch]`}
                                    placeholder="Note (optional)"
                                    value={itemNote[it.item_id] ?? ''}
                                    onChange={(e) => setItemNote((p) => ({ ...p, [it.item_id]: e.target.value }))}
                                  />
                                  <Button variant="primary" size="xs" onClick={() => attest(it, 'ATTEST')} icon={<CheckCircle2 size={11} />}>Attest</Button>
                                  <Button variant="danger" size="xs" onClick={() => attest(it, 'FLAG')} icon={<Flag size={11} />}>Flag</Button>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div>
        <div className="mx-auto mb-2 flex justify-center text-text-tertiary">{icon}</div>
        <p className="max-w-[52ch] text-[11px] text-text-secondary">{text}</p>
      </div>
    </div>
  );
}
