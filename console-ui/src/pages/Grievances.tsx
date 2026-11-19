import { AlertTriangle, Megaphone, Plus } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { useModels } from '../api/models';
import { AppShell } from '../components/console/AppShell';
import { RaiseAction } from '../components/console/RaiseAction';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { fieldClass as FIELD, labelClass as LABEL } from '../components/ui/form';
import { useConsoleUi } from '../stores/consoleUi';
import { useGovernanceFeatures } from '../stores/governanceFeatures';
import { GrievanceDecision } from './GovernancePhase2';
import { routeParam } from '../stores/route';

interface Grievance {
  grievance_id: string; model_id: string; subject: string; description: string;
  category: string; severity: string; channel: string; status: string;
  resolution_notes: string | null; sla_due_at: string; is_overdue: boolean;
  created_at: string; acknowledged_at: string | null; resolved_at: string | null;
}
interface Summary { total: number; open: number; overdue: number; resolved: number }

const STATUS_TONE: Record<string, BadgeTone> = {
  RECEIVED: 'negative', ACKNOWLEDGED: 'warning', INVESTIGATING: 'accent',
  RESOLVED: 'positive', REJECTED: 'neutral', CLOSED: 'neutral',
};
const SEV_TONE: Record<string, BadgeTone> = { HIGH: 'negative', MEDIUM: 'warning', LOW: 'accent' };
const STATUSES = ['RECEIVED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'REJECTED', 'CLOSED'];
const CATEGORIES = ['unfair_outcome', 'privacy', 'inaccuracy', 'no_explanation', 'discrimination', 'other'];
const TERMINAL = new Set(['RESOLVED', 'REJECTED', 'CLOSED']);
const IS_LIVE = (s: string) => !TERMINAL.has(s);

/**
 * Pillar 5 — Societal. The consumer grievance workflow: a first-class record
 * with a state machine (received → acknowledged → investigating → resolved) and
 * an SLA deadline, so the people an AI system affects have a real, tracked path
 * to redress. Every transition is written to the model ledger.
 */
export function Grievances() {
  const toast = useConsoleUi((s) => s.toast);
  const { models } = useModels();
  // E2.2: decision actions appear only while the US kit flag is on.
  const features = useGovernanceFeatures((s) => s.features);
  const loadFeatures = useGovernanceFeatures((s) => s.load);
  useEffect(() => {
    void loadFeatures();
  }, [loadFeatures]);
  const [rows, setRows] = useState<Grievance[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Opened from Model Inventory's "Grievance" button: start with the form open on that model.
  const [open, setOpen] = useState(() => routeParam('file') === '1');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ model_id: routeParam('model') ?? '', subject: '', description: '', category: 'unfair_outcome', severity: 'MEDIUM' });

  const load = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const [list, sum] = await Promise.all([
        api<Grievance[]>(`/grievances${qs}`),
        api<Summary>('/grievances/summary'),
      ]);
      setRows(Array.isArray(list) ? list : []);
      setSummary(sum);
      setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Failed to load grievances');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (models.length && (!form.model_id || !models.some((m) => m.model_id === form.model_id))) setForm((f) => ({ ...f, model_id: models[0].model_id }));
  }, [models, form.model_id]);

  const file = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.model_id) return;
    setBusy(true);
    try {
      await api('/grievances', { method: 'POST', body: JSON.stringify(form) });
      toast('Grievance filed — the SLA clock starts now', 'positive');
      setOpen(false);
      setForm((f) => ({ ...f, subject: '', description: '' }));
      await load(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Filing failed', 'negative');
    } finally { setBusy(false); }
  };

  const setStatus = async (g: Grievance, status: string) => {
    try {
      await api(`/grievances/${g.grievance_id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast(`Grievance marked ${status}`);
      await load(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'negative');
    }
  };

  const modelName = (id: string) => models.find((m) => m.model_id === id)?.name ?? id.slice(0, 8);
  const descNeed = Math.max(0, 10 - form.description.trim().length);

  return (
    <AppShell
      title="Grievances"
      actions={
        <>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status filter"
            className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text focus:border-accent">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button variant="primary" size="sm" onClick={() => setOpen((v) => !v)} icon={<Plus size={13} />}>File</Button>
        </>
      }
    >
      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <Kpi label="Grievances" value={summary?.total ?? 0} />
        <Kpi label="Open" value={summary?.open ?? 0} tone={(summary?.open ?? 0) ? 'warning' : 'ok'} />
        <Kpi label="SLA overdue" value={summary?.overdue ?? 0} tone={(summary?.overdue ?? 0) ? 'negative' : 'ok'} sub="past deadline" />
        <Kpi label="Resolved" value={summary?.resolved ?? 0} tone="ok" />
      </div>

      <main className="flex min-h-0 flex-1 flex-col p-2">
        {open && (
          <form onSubmit={file} className="mb-2 rounded-md border border-border bg-surface p-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className={LABEL}>Model</label>
                <select className={FIELD} value={form.model_id} onChange={(e) => setForm({ ...form, model_id: e.target.value })}>
                  {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Category</label>
                <select className={FIELD} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Severity (sets SLA)</label>
                <select className={FIELD} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                  <option value="HIGH">HIGH · 7-day SLA</option>
                  <option value="MEDIUM">MEDIUM · 15-day SLA</option>
                  <option value="LOW">LOW · 30-day SLA</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Subject</label>
                <input className={FIELD} required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Loan declined without explanation" />
              </div>
            </div>
            <div className="mt-2">
              <label className={LABEL}>What happened <span className={descNeed ? 'text-warning' : 'text-positive'}>({form.description.trim().length}/10 min)</span></label>
              <textarea rows={3} className={FIELD} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="The consumer's account of how the AI system's decision affected them." />
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" size="sm" disabled={busy || descNeed > 0 || !form.subject.trim()}>{busy ? 'Filing…' : 'File grievance'}</Button>
            </div>
          </form>
        )}

        <Panel title="Grievances" className="flex-1">
          {error ? (
            <PanelError onRetry={() => load()} />
          ) : loading ? (
            <SkeletonRows rows={6} />
          ) : !rows.length ? (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div>
                <Megaphone size={20} className="mx-auto mb-2 text-text-tertiary" />
                <p className="text-[11px] text-text-secondary">No grievances filed. Consumers can also file publicly from a model's transparency card.</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((g) => (
                <li key={g.grievance_id} className={`px-3 py-2 ${g.is_overdue ? 'bg-negative-soft' : ''}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={STATUS_TONE[g.status] ?? 'neutral'}>{g.status}</Badge>
                    <Badge tone={SEV_TONE[g.severity] ?? 'neutral'}>{g.severity}</Badge>
                    <Badge tone="neutral">{g.category?.replace(/_/g, ' ')}</Badge>
                    <span className="text-[11.5px] font-medium text-text">{g.subject}</span>
                    <span className="font-mono text-[9px] text-text-tertiary">· {modelName(g.model_id)}</span>
                    {g.is_overdue && (
                      <span className="flex items-center gap-1 font-mono text-[9px] font-medium text-negative">
                        <AlertTriangle size={10} /> SLA OVERDUE
                      </span>
                    )}
                    <select
                      value={g.status}
                      onChange={(e) => setStatus(g, e.target.value)}
                      aria-label={`Status for ${g.grievance_id}`}
                      className="ml-auto rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[9.5px] text-text-secondary"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <p className="mt-1 max-w-[95ch] text-[10.5px] text-text-secondary">{g.description}</p>
                  <p className="mt-0.5 font-mono text-[9px] text-text-tertiary">
                    filed {new Date(g.created_at).toLocaleString()} · {IS_LIVE(g.status) ? `SLA due ${new Date(g.sla_due_at).toLocaleDateString()}` : g.resolved_at ? `closed ${new Date(g.resolved_at).toLocaleDateString()}` : ''}
                    {g.resolution_notes ? ` · “${g.resolution_notes}”` : ''}
                  </p>
                  <RaiseAction source="GRIEVANCE" sourceId={g.grievance_id} defaultNonconformity={`Grievance: ${g.subject}. ${g.description}`} />
                  {features?.usKit && <GrievanceDecision grievanceId={g.grievance_id} status={g.status} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </main>
    </AppShell>
  );
}

function Kpi({ label, value, tone, sub }: { label: string; value: number; tone?: 'ok' | 'warning' | 'negative'; sub?: string }) {
  const cls = tone === 'negative' ? 'text-negative' : tone === 'warning' ? 'text-warning' : tone === 'ok' ? 'text-positive' : 'text-text';
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">{label}</div>
      <div className={`font-mono text-base leading-tight ${cls}`}>{value}</div>
      {sub && <div className="font-mono text-[8.5px] text-text-tertiary">{sub}</div>}
    </div>
  );
}
