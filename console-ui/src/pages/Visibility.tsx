import { Flag, Radar, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { useModels } from '../api/models';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';
import { useSession } from '../stores/session';

interface ActionEvent {
  event_id: string; model_id: string; session_id: string | null; type: string;
  tool: string | null; outcome: string; flagged: boolean; actor: string; occurred_at: string;
}
interface Summary {
  total_events: number; flagged_tool_calls: number; events_last_24h: number;
  by_type: Record<string, number>; active_sessions: number; models_reporting: number;
  recent: ActionEvent[]; recent_flagged: ActionEvent[];
}
interface TimelineRow { ts: string; source: string; type: string; summary: string; flagged?: boolean; actor?: string }
interface Timeline { model_id: string; model_name: string; sentrai_model_id: string; count: number; timeline: TimelineRow[] }

const SOURCE_TONE: Record<string, BadgeTone> = {
  ledger: 'accent', action: 'neutral', gate: 'warning', incident: 'negative', drift: 'warning',
};
const toolLabel = (id: string | null) =>
  !id ? '' : id.startsWith('tool:') ? id.slice(5) : id.replace(/^capability:/, '').replace(/[._]/g, ' ');

/**
 * Pillar 3 — Visibility. What the AI is actually doing at runtime: the action
 * telemetry deployed agents emit (tagged with their SENTRAI_MODEL_ID), and a
 * cross-ledger timeline that stitches governance, gate, incident, drift and
 * runtime records into one view per model. A tool call outside the permitted
 * set is flagged the moment it lands — static tool authorization, at runtime.
 */
export function Visibility() {
  const toast = useConsoleUi((s) => s.toast);
  const { models } = useModels();
  const role = useSession((s) => s.user?.role ?? 'VIEWER');
  const canEmit = ['ADMIN', 'CISO', 'OWNER'].includes(role);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [modelId, setModelId] = useState('');
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSummary = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      setSummary(await api<Summary>('/telemetry/summary'));
      setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Failed to load telemetry');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { if (!modelId && models.length) setModelId(models[0].model_id); }, [models, modelId]);

  const loadTimeline = useCallback(async (id: string) => {
    if (!id) return;
    try {
      setTimeline(await api<Timeline>(`/telemetry/models/${id}/timeline`));
    } catch {
      setTimeline(null);
    }
  }, []);

  useEffect(() => { if (modelId) void loadTimeline(modelId); }, [modelId, loadTimeline]);

  const emitSample = async () => {
    if (!modelId) return;
    setBusy(true);
    const session = `demo-${Date.now().toString(36)}`;
    try {
      await api('/telemetry/events', {
        method: 'POST',
        body: JSON.stringify({
          events: [
            { sentrai_model_id: modelId, type: 'tool_call', tool: 'capability:network', session_id: session, outcome: 'success', detail: { target: 'api.vendor.example' } },
            { sentrai_model_id: modelId, type: 'decision', session_id: session, detail: { summary: 'approved tier-1 request within policy' } },
            { sentrai_model_id: modelId, type: 'tool_call', tool: 'capability:shell', session_id: session, detail: { cmd: 'df -h' } },
            { sentrai_model_id: modelId, type: 'handoff', session_id: session, detail: { to: 'human_reviewer' } },
          ],
        }),
      });
      toast('Sample runtime events ingested', 'positive');
      await Promise.all([loadSummary(true), loadTimeline(modelId)]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ingest failed', 'negative');
    } finally { setBusy(false); }
  };

  return (
    <AppShell
      title="Visibility"
      actions={
        <>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="Model"
            className="max-w-[180px] rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text focus:border-accent">
            {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
          </select>
          {canEmit && <Button variant="secondary" size="sm" onClick={emitSample} disabled={busy || !modelId} icon={<Zap size={12} />}>Emit sample (demo)</Button>}
        </>
      }
    >
      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-5">
        <Kpi label="Runtime events" value={summary?.total_events ?? 0} />
        <Kpi label="Flagged tool calls" value={summary?.flagged_tool_calls ?? 0} tone={(summary?.flagged_tool_calls ?? 0) > 0 ? 'negative' : 'ok'} sub="outside permitted set" />
        <Kpi label="Last 24h" value={summary?.events_last_24h ?? 0} tone="accent" />
        <Kpi label="Active sessions" value={summary?.active_sessions ?? 0} />
        <Kpi label="Models reporting" value={summary?.models_reporting ?? 0} />
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-3">
        <Panel title={`Cross-ledger timeline${timeline ? ` · ${timeline.model_name}` : ''}`} className="lg:col-span-2">
          {error ? (
            <PanelError onRetry={() => loadSummary()} />
          ) : loading ? (
            <SkeletonRows rows={8} />
          ) : !timeline || timeline.timeline.length === 0 ? (
            <Empty text={canEmit ? 'No records yet for this model. Pick a model with activity, or click “Emit sample (demo)” to see runtime events flow into the timeline.' : 'No records yet for this model.'} />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                <span className="font-mono text-[9px] text-text-tertiary">SENTRAI_MODEL_ID</span>
                <code className="font-mono text-[9.5px] text-accent">{timeline.sentrai_model_id}</code>
                <span className="ml-auto font-mono text-[9px] text-text-tertiary">{timeline.count} records</span>
              </div>
              <ul className="divide-y divide-border">
                {timeline.timeline.map((r, i) => (
                  <li key={i} className={`flex items-start gap-2 px-3 py-1.5 ${r.flagged ? 'bg-negative-soft' : ''}`}>
                    <Badge tone={SOURCE_TONE[r.source] ?? 'neutral'}>{r.source}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] font-medium text-text">{r.type}</span>
                        {r.flagged && <span className="flex items-center gap-0.5 font-mono text-[9px] text-negative"><Flag size={9} /> flagged</span>}
                      </div>
                      <p className="truncate text-[10.5px] text-text-secondary">{r.summary}</p>
                    </div>
                    <span className="shrink-0 font-mono text-[9px] text-text-tertiary">{new Date(r.ts).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="Runtime events (org)">
          {loading ? (
            <SkeletonRows rows={6} />
          ) : !summary || summary.recent.length === 0 ? (
            <Empty text="No runtime action telemetry ingested yet. Deployed agents POST to /telemetry/events tagged with their SENTRAI_MODEL_ID." />
          ) : (
            <div className="flex flex-col">
              {summary.recent_flagged.length > 0 && (
                <div className="border-b border-border bg-negative-soft px-3 py-1.5">
                  <div className="font-mono text-[9px] font-medium uppercase tracking-wider text-negative">Unauthorized tool calls</div>
                  {summary.recent_flagged.slice(0, 4).map((e) => (
                    <div key={e.event_id} className="mt-0.5 font-mono text-[9.5px] text-negative">{toolLabel(e.tool)} · {new Date(e.occurred_at).toLocaleTimeString()}</div>
                  ))}
                </div>
              )}
              <ul className="divide-y divide-border">
                {summary.recent.map((e) => (
                  <li key={e.event_id} className={`px-3 py-1.5 ${e.flagged ? 'bg-negative-soft' : ''}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={e.flagged ? 'negative' : e.type === 'tool_call' ? 'accent' : 'neutral'}>{e.type}</Badge>
                      {e.tool && <span className="font-mono text-[9.5px] text-text-secondary">{toolLabel(e.tool)}</span>}
                      <span className={`ml-auto font-mono text-[9px] ${e.outcome === 'unauthorized_tool' ? 'text-negative' : 'text-text-tertiary'}`}>{e.outcome}</span>
                    </div>
                    <p className="mt-0.5 font-mono text-[8.5px] text-text-tertiary">{new Date(e.occurred_at).toLocaleString()}{e.session_id ? ` · ${e.session_id}` : ''}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </main>
    </AppShell>
  );
}

function Kpi({ label, value, tone, sub }: { label: string; value: number; tone?: 'ok' | 'negative' | 'accent'; sub?: string }) {
  const cls = tone === 'negative' ? 'text-negative' : tone === 'accent' ? 'text-accent' : tone === 'ok' ? 'text-positive' : 'text-text';
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">{label}</div>
      <div className={`font-mono text-base leading-tight ${cls}`}>{value}</div>
      {sub && <div className="font-mono text-[8.5px] text-text-tertiary">{sub}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div>
        <Radar size={20} className="mx-auto mb-2 text-text-tertiary" />
        <p className="max-w-[54ch] text-[11px] text-text-secondary">{text}</p>
      </div>
    </div>
  );
}
