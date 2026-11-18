import { Activity, ClipboardCheck, ShieldCheck, ShieldOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api/client';
import { useModels } from '../api/models';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';

interface DriftReport {
  report_id?: string;
  model_id: string;
  computed_at: string;
  psi_score: number;
  wasserstein_distance: number;
  accuracy_delta: number;
  status: string;
}

interface BcpStatus {
  model_id: string;
  fallback_active?: boolean;
  active?: boolean;
  configured?: boolean;
  activated_at?: string | null;
}

interface BcpDrill {
  drill_id: string;
  conducted_at: string;
  scenario: string;
  result: string;
  findings: string | null;
  conducted_by: string;
}

interface DrillHistory {
  model_id: string;
  risk_level: string;
  drill_last_conducted: string | null;
  drill_interval_days: number;
  drill_status: 'NONE' | 'CURRENT' | 'DUE_SOON' | 'OVERDUE';
  drill_required?: boolean;
  latest_drill_result?: string | null;
  next_drill_due: string | null;
  drills: BcpDrill[];
}

const DRILL_TONE: Record<DrillHistory['drill_status'], BadgeTone> = {
  CURRENT: 'positive',
  DUE_SOON: 'warning',
  OVERDUE: 'negative',
  NONE: 'negative',
};
const RESULT_TONE = (r: string): BadgeTone => (r === 'PASSED' ? 'positive' : r === 'FAILED' ? 'negative' : 'warning');
const INPUT = 'rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text focus:border-accent';

/** A date-only input parses as UTC midnight, which shows as the day before west
 *  of UTC. Read it as local noon instead (or now, for today, so the server's
 *  no-future-dates rule never trips before midday). */
function drillDateToIso(day: string): string | undefined {
  if (!day) return undefined;
  const picked = new Date(`${day}T12:00:00`);
  return picked.getTime() > Date.now() ? new Date().toISOString() : picked.toISOString();
}

/** NOMINAL is the only healthy state; everything else is a real signal. */
const STATUS_TONE = (s: string): BadgeTone =>
  s === 'NOMINAL' ? 'positive' : s === 'WARNING' ? 'warning' : 'negative';

const TH = 'sticky top-0 z-10 border-b border-border bg-surface px-2 py-1.5 text-left text-[9px] font-medium uppercase tracking-widest text-text-tertiary';
const TD = 'px-2 py-1.5 font-mono text-[10.5px]';

export function Monitoring() {
  const toast = useConsoleUi((s) => s.toast);
  const { models, loading: modelsLoading } = useModels();
  const [modelId, setModelId] = useState('');
  const [history, setHistory] = useState<DriftReport[]>([]);
  const [bcp, setBcp] = useState<BcpStatus | null>(null);
  // null = drill tracking is not enabled on this server (the route answers 404).
  const [drills, setDrills] = useState<DrillHistory | null>(null);
  const [drillForm, setDrillForm] = useState<{ scenario: string; result: string; findings: string; conducted_at: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!modelId && models.length) setModelId(models[0].model_id);
  }, [models, modelId]);

  const load = useCallback(async () => {
    if (!modelId) return;
    setLoading(true);
    setError(null);
    try {
      const [h, b, d] = await Promise.all([
        api<DriftReport[]>(`/monitoring/drift/${modelId}/history`),
        api<BcpStatus>(`/monitoring/bcp/${modelId}/status`).catch(() => null),
        // 404 means drill tracking is not enabled on this server: hide the panel.
        // Any other failure is a real error and is surfaced, not hidden.
        api<DrillHistory>(`/monitoring/bcp/${modelId}/drills`).catch((e) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }),
      ]);
      setHistory(Array.isArray(h) ? h : []);
      setBcp(b);
      setDrills(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load drift history');
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const evaluate = async () => {
    try {
      // Evaluates the score windows already on the server; the console never
      // handles raw inference scores.
      await api(`/monitoring/drift/${modelId}/evaluate`, { method: 'POST' });
      toast('Drift evaluation run', 'positive');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Evaluation failed — push score windows first', 'negative');
    }
  };

  const recordDrill = async () => {
    if (!drillForm) return;
    try {
      await api(`/monitoring/bcp/${modelId}/drills`, {
        method: 'POST',
        body: JSON.stringify({
          scenario: drillForm.scenario,
          result: drillForm.result,
          findings: drillForm.findings || undefined,
          conducted_at: drillDateToIso(drillForm.conducted_at),
        }),
      });
      toast('Drill recorded', 'positive');
      setDrillForm(null);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 403 ? 'Only Owner, CISO or Admin can record drills' : e instanceof Error ? e.message : 'Could not record drill';
      toast(msg, 'negative');
    }
  };

  const bcpActive = Boolean(bcp?.fallback_active ?? bcp?.active);
  const latest = history[0];

  return (
    <AppShell
      title="Drift Monitoring"
      actions={
        <>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            aria-label="Model"
            className="max-w-[220px] rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text focus:border-accent"
          >
            {modelsLoading && <option>Loading…</option>}
            {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
          </select>
          <button onClick={evaluate} disabled={!modelId} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-50">
            <Activity size={13} /> Evaluate now
          </button>
        </>
      }
    >
      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">
        <div className="bg-surface px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Latest status</div>
          <div className="mt-0.5">{latest ? <Badge tone={STATUS_TONE(latest.status)}>{latest.status}</Badge> : <span className="font-mono text-[11px] text-text-tertiary">no data</span>}</div>
        </div>
        <div className="bg-surface px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">PSI</div>
          <div className={`font-mono text-base leading-tight ${latest && latest.psi_score >= 0.2 ? 'text-negative' : latest && latest.psi_score >= 0.1 ? 'text-warning' : 'text-text'}`}>
            {latest ? latest.psi_score.toFixed(3) : '—'}
          </div>
          <div className="font-mono text-[8.5px] text-text-tertiary">warn 0.10 · alert 0.20</div>
        </div>
        <div className="bg-surface px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Accuracy delta</div>
          <div className={`font-mono text-base leading-tight ${latest && latest.accuracy_delta <= -0.05 ? 'text-negative' : 'text-text'}`}>
            {latest ? latest.accuracy_delta.toFixed(3) : '—'}
          </div>
          <div className="font-mono text-[8.5px] text-text-tertiary">alert at -0.05</div>
        </div>
        <div className="bg-surface px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Business continuity</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {bcpActive
              ? <><ShieldCheck size={13} className="text-warning" /><span className="font-mono text-[10.5px] text-warning">fallback active</span></>
              : <><ShieldOff size={13} className="text-text-tertiary" /><span className="font-mono text-[10.5px] text-text-tertiary">not active</span></>}
          </div>
        </div>
      </div>

      <main className={`min-h-0 flex-1 overflow-hidden p-2 ${drills ? 'grid grid-rows-2 gap-2' : ''}`}>
        <Panel title="Drift history" className={drills ? 'min-h-0' : 'h-full'}>
          {error ? (
            <PanelError onRetry={load} />
          ) : loading ? (
            <SkeletonRows rows={6} />
          ) : !history.length ? (
            <p className="p-3 text-[11px] leading-relaxed text-text-secondary">
              No drift reports for this model yet. Push live score windows to{' '}
              <code className="font-mono text-accent">/monitoring/scores/{'{model_id}'}</code>, then run an evaluation —
              the hourly cron also evaluates automatically.
            </p>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className={TH}>Computed</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>PSI</th>
                  <th className={TH}>Wasserstein</th>
                  <th className={TH}>Accuracy Δ</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r, i) => (
                  <tr key={r.report_id ?? i} className="border-b border-border hover:bg-surface-hover">
                    <td className={`${TD} text-text-secondary`}>{new Date(r.computed_at).toLocaleString()}</td>
                    <td className="px-2 py-1.5"><Badge tone={STATUS_TONE(r.status)}>{r.status}</Badge></td>
                    <td className={`${TD} ${r.psi_score >= 0.2 ? 'text-negative' : r.psi_score >= 0.1 ? 'text-warning' : 'text-text'}`}>{r.psi_score.toFixed(4)}</td>
                    <td className={TD}>{r.wasserstein_distance.toFixed(4)}</td>
                    <td className={`${TD} ${r.accuracy_delta <= -0.05 ? 'text-negative' : 'text-text'}`}>{r.accuracy_delta.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        {drills && (
          <Panel
            title="BCP drills"
            className="min-h-0"
            right={
              <div className="flex items-center gap-2">
                <Badge tone={drills.drill_required === false ? 'neutral' : DRILL_TONE[drills.drill_status]}>
                  {drills.drill_required === false && drills.drill_status === 'NONE' ? 'NOT REQUIRED' : drills.drill_status.replace('_', ' ')}
                </Badge>
                {drills.latest_drill_result === 'FAILED' && <Badge tone="negative">LAST DRILL FAILED</Badge>}
                <span className="font-mono text-[9px] text-text-tertiary">
                  {drills.next_drill_due ? `next due ${new Date(drills.next_drill_due).toLocaleDateString()}` : 'no passed drill on record'} · every {drills.drill_interval_days}d
                </span>
                <button
                  onClick={() => setDrillForm(drillForm ? null : { scenario: '', result: 'PASSED', findings: '', conducted_at: '' })}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10.5px] text-text-secondary hover:bg-surface-hover"
                >
                  <ClipboardCheck size={12} /> Record drill
                </button>
              </div>
            }
          >
            {drillForm && (
              <div className="flex flex-wrap items-end gap-2 border-b border-border p-2">
                <input aria-label="Scenario" placeholder="Scenario, e.g. model endpoint outage; fall back to rules engine" value={drillForm.scenario}
                  onChange={(e) => setDrillForm({ ...drillForm, scenario: e.target.value })} className={`${INPUT} min-w-[240px] flex-1`} />
                <select aria-label="Result" value={drillForm.result} onChange={(e) => setDrillForm({ ...drillForm, result: e.target.value })} className={INPUT}>
                  <option value="PASSED">Passed</option>
                  <option value="PASSED_WITH_FINDINGS">Passed with findings</option>
                  <option value="FAILED">Failed</option>
                </select>
                <input aria-label="Conducted on" type="date" max={new Date().toLocaleDateString('en-CA')} value={drillForm.conducted_at}
                  onChange={(e) => setDrillForm({ ...drillForm, conducted_at: e.target.value })} className={INPUT} />
                <input aria-label="Findings" placeholder="Findings (optional)" value={drillForm.findings}
                  onChange={(e) => setDrillForm({ ...drillForm, findings: e.target.value })} className={`${INPUT} min-w-[180px] flex-1`} />
                <button onClick={recordDrill} disabled={drillForm.scenario.trim().length < 3}
                  className="rounded-md bg-accent px-2.5 py-1 text-[11px] text-white disabled:opacity-50">Save</button>
              </div>
            )}
            {!drills.drills.length ? (
              <p className="p-3 text-[11px] leading-relaxed text-text-secondary">
                No BCP drills recorded for this model.{' '}
                {drills.drill_required
                  ? 'HIGH and CRITICAL risk models need a passed drill within the interval (RBI FREE-AI Rec 21).'
                  : 'Drills are required for HIGH risk models and recommended for others.'}
              </p>
            ) : (
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th className={TH}>Conducted</th>
                    <th className={TH}>Result</th>
                    <th className={TH}>Scenario</th>
                    <th className={TH}>Findings</th>
                    <th className={TH}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {drills.drills.map((d) => (
                    <tr key={d.drill_id} className="border-b border-border hover:bg-surface-hover">
                      <td className={`${TD} text-text-secondary`}>{new Date(d.conducted_at).toLocaleDateString()}</td>
                      <td className="px-2 py-1.5"><Badge tone={RESULT_TONE(d.result)}>{d.result.replace(/_/g, ' ')}</Badge></td>
                      <td className="px-2 py-1.5 text-[11px] text-text">{d.scenario}</td>
                      <td className="px-2 py-1.5 text-[11px] text-text-secondary">{d.findings ?? '—'}</td>
                      <td className={`${TD} text-text-tertiary`}>{d.conducted_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        )}
      </main>
    </AppShell>
  );
}
