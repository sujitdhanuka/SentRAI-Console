import { AlertTriangle, Plus, Siren } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { useModels } from '../api/models';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';
import { useSession } from '../stores/session';

interface Incident {
  incident_id: string;
  model_id: string;
  model_name: string;
  re_name: string;
  category: string;
  severity: string;
  status: string;
  description: string;
  reporting_deadline: string;
  is_overdue: boolean;
  regulator_notified: boolean;
  system_suspended: boolean;
  repeat_incident: boolean;
  created_at: string;
}

const SEV_TONE: Record<string, BadgeTone> = {
  P1_CRITICAL: 'negative', P2_HIGH: 'negative', P3_MEDIUM: 'warning', P4_LOW: 'accent',
};
const STATUS_TONE: Record<string, BadgeTone> = {
  REPORTED: 'negative', UNDER_INVESTIGATION: 'warning',
  REMEDIATION_IN_PROGRESS: 'accent', RESOLVED: 'positive', CLOSED: 'positive',
};

const SEVERITIES = ['P1_CRITICAL', 'P2_HIGH', 'P3_MEDIUM', 'P4_LOW'];
const STATUSES = ['REPORTED', 'UNDER_INVESTIGATION', 'REMEDIATION_IN_PROGRESS', 'RESOLVED', 'CLOSED'];
/** Anything short of RESOLVED still carries a live regulatory obligation. */
const IS_LIVE = (s: string) => s !== 'RESOLVED' && s !== 'CLOSED';
const CATEGORIES = [
  'BIAS_DISCRIMINATION', 'MODEL_DRIFT', 'DATA_PRIVACY_BREACH', 'EXPLAINABILITY_FAILURE',
  'ADVERSARIAL_ATTACK', 'UNINTENDED_AUTONOMOUS_ACTION', 'SYSTEM_UNAVAILABILITY', 'CONSUMER_HARM', 'OTHER',
];
const MIN_DESC = 50;
const MIN_ACTION = 20;

/** Containment/aggravating flags the RBI narrative depends on. */
const FLAGS = [
  ['autonomous_system_involved', 'Autonomous system involved'],
  ['system_suspended', 'System suspended'],
  ['fallback_activated', 'Fallback activated'],
  ['repeat_incident', 'Repeat incident'],
] as const;
type FlagKey = (typeof FLAGS)[number][0];

import { fieldClass as FIELD } from '../components/ui/form';
import { labelClass as LABEL } from '../components/ui/form';
const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function Incidents() {
  const toast = useConsoleUi((s) => s.toast);
  const activeProjectId = useSession((s) => s.activeProjectId);
  const { models } = useModels();
  const [rows, setRows] = useState<Incident[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    model_id: '', re_name: '', functional_area: '', incident_category: 'CONSUMER_HARM',
    severity: 'P3_MEDIUM', description: '', immediate_action_taken: '',
    observed_at: nowLocal(), detected_at: nowLocal(),
    autonomous_system_involved: false, system_suspended: false,
    fallback_activated: false, repeat_incident: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status_filter', statusFilter);
      if (activeProjectId) params.set('project_id', activeProjectId);
      const qs = params.toString();
      const res = await api<Incident[]>(`/compliance/incident${qs ? `?${qs}` : ''}`);
      setRows(Array.isArray(res) ? res : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, activeProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!form.model_id && models.length) setForm((f) => ({ ...f, model_id: models[0].model_id }));
  }, [models, form.model_id]);

  const selected = models.find((m) => m.model_id === form.model_id);

  const report = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      // The regulator-facing DTO needs the full incident context, not just a
      // title — model identity, category, risk tier, and both timestamps.
      await api('/compliance/incident/report', {
        method: 'POST',
        body: JSON.stringify({
          model_id: selected.model_id,
          model_name: selected.name,
          re_name: form.re_name,
          functional_area: form.functional_area || 'unspecified',
          incident_category: form.incident_category,
          severity: form.severity,
          description: form.description,
          immediate_action_taken: form.immediate_action_taken,
          observed_at: new Date(form.observed_at).toISOString(),
          detected_at: new Date(form.detected_at).toISOString(),
          model_risk_level: selected.risk_level,
          autonomous_system_involved: form.autonomous_system_involved,
          system_suspended: form.system_suspended,
          fallback_activated: form.fallback_activated,
          repeat_incident: form.repeat_incident,
        }),
      });
      toast('Incident reported — the regulatory clock starts now', 'positive');
      setOpen(false);
      setForm((f) => ({ ...f, description: '', immediate_action_taken: '', re_name: f.re_name }));
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Report failed', 'negative');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (inc: Incident, status: string) => {
    try {
      await api(`/compliance/incident/${inc.incident_id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast(`Incident marked ${status}`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'negative');
    }
  };

  const overdueCount = rows.filter((r) => r.is_overdue && IS_LIVE(r.status)).length;
  const descNeed = Math.max(0, MIN_DESC - form.description.trim().length);
  const actionNeed = Math.max(0, MIN_ACTION - form.immediate_action_taken.trim().length);
  const descShort = descNeed > 0;
  const actionShort = actionNeed > 0;

  // The submit button is gated on the regulatory minimums; when it is disabled
  // the reason must be spelled out next to it, not implied by counter colors.
  const blockers = [
    descShort && `${descNeed} more character${descNeed === 1 ? '' : 's'} in the description`,
    actionShort && `${actionNeed} more in the immediate action`,
  ].filter(Boolean).join(' and ');

  return (
    <AppShell
      title="Incidents"
      actions={
        <>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status filter"
            className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text focus:border-accent">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button variant="primary" size="sm" onClick={() => setOpen((v) => !v)} icon={<Plus size={13} />}>Report</Button>
        </>
      }
    >
      <div className="grid shrink-0 grid-cols-3 gap-px border-b border-border bg-border">
        <div className="bg-surface px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Incidents</div>
          <div className="font-mono text-base leading-tight">{rows.length}</div>
        </div>
        <div className="bg-surface px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Unresolved</div>
          <div className={`font-mono text-base leading-tight ${rows.some((r) => IS_LIVE(r.status)) ? 'text-negative' : 'text-positive'}`}>
            {rows.filter((r) => IS_LIVE(r.status)).length}
          </div>
        </div>
        <div className="bg-surface px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Reporting overdue</div>
          <div className={`font-mono text-base leading-tight ${overdueCount ? 'text-negative' : 'text-positive'}`}>{overdueCount}</div>
          <div className="font-mono text-[8.5px] text-text-tertiary">past regulatory deadline</div>
        </div>
      </div>

      <main className="flex min-h-0 flex-1 flex-col p-2">
        {open && (
          <form onSubmit={report} className="mb-2 rounded-md border border-border bg-surface p-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className={LABEL}>Model</label>
                <select className={FIELD} value={form.model_id} onChange={(e) => setForm({ ...form, model_id: e.target.value })}>
                  {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Regulated entity</label>
                <input className={FIELD} required value={form.re_name} onChange={(e) => setForm({ ...form, re_name: e.target.value })} placeholder="e.g. Acme Bank Ltd" />
              </div>
              <div>
                <label className={LABEL}>Functional area</label>
                <input className={FIELD} value={form.functional_area} onChange={(e) => setForm({ ...form, functional_area: e.target.value })} placeholder="e.g. credit_underwriting" />
              </div>
              <div>
                <label className={LABEL}>Category</label>
                <select className={FIELD} value={form.incident_category} onChange={(e) => setForm({ ...form, incident_category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Severity</label>
                <select className={FIELD} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Risk tier (from model)</label>
                <input className={`${FIELD} opacity-70`} readOnly value={selected?.risk_level ?? '—'} />
              </div>
              <div>
                <label className={LABEL}>Observed at</label>
                <input type="datetime-local" className={`${FIELD} font-mono`} required value={form.observed_at} onChange={(e) => setForm({ ...form, observed_at: e.target.value })} />
              </div>
              <div>
                <label className={LABEL}>Detected at</label>
                <input type="datetime-local" className={`${FIELD} font-mono`} required value={form.detected_at} onChange={(e) => setForm({ ...form, detected_at: e.target.value })} />
              </div>
            </div>
            <div className="mt-2">
              <label className={LABEL}>
                Description <span className={descShort ? 'text-warning' : 'text-positive'}>({form.description.trim().length}/{MIN_DESC} min)</span>
              </label>
              <textarea rows={3} className={FIELD} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What happened, who was affected, and what has been done so far — regulators require a substantive account." />
            </div>
            <div className="mt-2">
              <label className={LABEL}>
                Immediate action taken <span className={actionShort ? 'text-warning' : 'text-positive'}>({form.immediate_action_taken.trim().length}/{MIN_ACTION} min)</span>
              </label>
              <textarea rows={2} className={FIELD} required value={form.immediate_action_taken}
                onChange={(e) => setForm({ ...form, immediate_action_taken: e.target.value })}
                placeholder="Containment steps already performed — e.g. inference paused, manual review queue enabled, affected customers contacted." />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {FLAGS.map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-[10.5px] text-text-secondary">
                  <input type="checkbox" checked={form[key as FlagKey]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} className="accent-accent" />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              {blockers && (
                <p className="mr-auto max-w-[60ch] text-[10.5px] text-warning">
                  Regulators require a substantive account — add {blockers} to submit.
                </p>
              )}
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={busy || descShort || actionShort}
                title={blockers ? `Add ${blockers} to submit` : undefined}
              >
                {busy ? 'Reporting…' : 'Report incident'}
              </Button>
            </div>
          </form>
        )}

        <Panel title="Reported incidents" className="flex-1">
          {error ? (
            <PanelError onRetry={load} />
          ) : loading ? (
            <SkeletonRows rows={6} />
          ) : !rows.length ? (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div>
                <Siren size={20} className="mx-auto mb-2 text-text-tertiary" />
                <p className="text-[11px] text-text-secondary">No incidents reported.</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((i) => (
                <li key={i.incident_id} className={`px-3 py-2 ${i.is_overdue && IS_LIVE(i.status) ? 'bg-negative-soft' : ''}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={SEV_TONE[i.severity] ?? 'neutral'}>{i.severity}</Badge>
                    <Badge tone={STATUS_TONE[i.status] ?? 'neutral'}>{i.status}</Badge>
                    <Badge tone="neutral">{i.category?.replace(/_/g, ' ')}</Badge>
                    <span className="text-[11.5px] font-medium text-text">{i.model_name}</span>
                    <span className="font-mono text-[9px] text-text-tertiary">· {i.re_name}</span>
                    {i.repeat_incident && <Badge tone="warning">repeat</Badge>}
                    {i.system_suspended && <Badge tone="negative">system suspended</Badge>}
                    {i.is_overdue && IS_LIVE(i.status) && (
                      <span className="flex items-center gap-1 font-mono text-[9px] font-medium text-negative">
                        <AlertTriangle size={10} /> REPORTING OVERDUE
                      </span>
                    )}
                    <select
                      value={i.status}
                      onChange={(e) => setStatus(i, e.target.value)}
                      aria-label={`Status for ${i.incident_id}`}
                      className="ml-auto rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[9.5px] text-text-secondary"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <p className="mt-1 max-w-[95ch] text-[10.5px] text-text-secondary">{i.description}</p>
                  <p className="mt-0.5 font-mono text-[9px] text-text-tertiary">
                    deadline {new Date(i.reporting_deadline).toLocaleString()}
                    {i.regulator_notified ? ' · regulator notified' : ' · regulator not yet notified'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </main>
    </AppShell>
  );
}
