import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Badge } from '../components/ui/Badge';
import { FigurePlate, PLATE } from '../components/ui/FigurePlate';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useSession } from '../stores/session';

interface Breakdown {
  name: string;
  calls: number;
  ok_calls: number;
  failed_calls: number;
  tokens_in: number;
  tokens_out: number;
  total_tokens: number;
  avg_latency_ms: number | null;
}

interface Usage {
  organization_id: string | null;
  window_days: number;
  total_calls: number;
  ok_calls: number;
  failed_calls: number;
  success_rate: number | null;
  tokens_in: number;
  tokens_out: number;
  total_tokens: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  daily: Array<{ date: string; calls: number; failed: number; tokens: number }>;
  use_cases: Breakdown[];
  models: Breakdown[];
  providers: Breakdown[];
  actors: Breakdown[];
  recent_failures: Array<{ use_case: string; provider: string; model: string; actor: string; at: string }>;
  recent: Array<{
    use_case: string; provider: string; model: string; status: string;
    tokens_in: number | null; tokens_out: number | null; latency_ms: number; actor: string; at: string;
  }>;
}

const WINDOWS = [7, 30, 90];
const num = (n: number) => n.toLocaleString();

/** Compact bar list — a chart library would be overkill for four breakdowns. */
function BarList({ rows, empty }: { rows: Breakdown[]; empty: string }) {
  if (!rows.length) return <p className="p-3 text-[11px] text-text-secondary">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.calls), 1);
  return (
    <ul className="divide-y divide-border">
      {rows.slice(0, 8).map((r) => (
        <li key={r.name} className="px-3 py-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-mono text-[10.5px] text-text" title={r.name}>{r.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-text-secondary">
              {num(r.calls)} call{r.calls === 1 ? '' : 's'}
              {r.failed_calls > 0 && <span className="text-negative"> · {r.failed_calls} failed</span>}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-elevated">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.calls / max) * 100}%` }} />
          </div>
          <div className="mt-0.5 font-mono text-[9px] text-text-tertiary">
            {num(r.total_tokens)} tokens
            {r.avg_latency_ms !== null && ` · ${num(r.avg_latency_ms)} ms avg`}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Daily call volume as a column chart, drawn in the plate palette (it lives
 *  inside a blueprint FigurePlate). Cyan line-work for calls, fail red stacked
 *  on top so a bad day is unmistakable. */
function DailyChart({ daily }: { daily: Usage['daily'] }) {
  const max = Math.max(...daily.map((d) => d.calls), 1);
  return (
    <div>
      <div className="flex h-[76px] items-end gap-[2px]">
        {daily.map((d) => (
          <div
            key={d.date}
            className="group relative flex-1"
            title={`${d.date}: ${d.calls} calls, ${d.failed} failed, ${num(d.tokens)} tokens`}
          >
            <div className="w-full" style={{ height: `${(d.failed / max) * 76}px`, background: '#E06B5D' }} />
            <div className="w-full" style={{ height: `${((d.calls - d.failed) / max) * 76}px`, background: PLATE.line }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[9px]" style={{ color: PLATE.dim }}>
        <span>{daily[0]?.date}</span>
        <span style={{ color: PLATE.line }}>peak {num(max)}/day</span>
        <span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  );
}

interface Org { organization_id?: string; id?: string; name: string }

export function AiUsage() {
  const user = useSession((s) => s.user);
  // Usage is metered per organization, so a global admin (ADMIN with no org of
  // their own) has to name the org they want to see — same rule as AI Settings.
  const needsOrgPicker = user?.role === 'ADMIN' && !user?.tenant_id;
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!needsOrgPicker) return;
    api<Org[]>('/organizations/')
      .then((o) => {
        setOrgs(o);
        setOrgId((cur) => cur || o[0]?.organization_id || o[0]?.id || '');
      })
      .catch(() => undefined);
  }, [needsOrgPicker]);

  const scope = needsOrgPicker ? orgId : '';
  const ready = !needsOrgPicker || Boolean(orgId);

  const load = useCallback(async () => {
    if (!ready) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const org = scope ? `&organization_id=${encodeURIComponent(scope)}` : '';
      setUsage(await api<Usage>(`/ai/usage?days=${days}${org}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load AI usage');
    } finally {
      setLoading(false);
    }
  }, [days, scope, ready]);

  useEffect(() => {
    void load();
  }, [load]);

  const KPI = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="bg-surface px-3 py-2">
      <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">{label}</div>
      <div className={`font-mono text-base leading-tight ${tone ?? ''}`}>{value}</div>
      {sub && <div className="font-mono text-[8.5px] text-text-tertiary">{sub}</div>}
    </div>
  );

  return (
    <AppShell
      title="LLM Usage"
      actions={
        <>
          {needsOrgPicker && (
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              aria-label="Organization"
              className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text focus:border-accent"
            >
              <option value="">— select organization —</option>
              {orgs.map((o) => {
                const id = o.organization_id ?? o.id ?? '';
                return <option key={id} value={id}>{o.name}</option>;
              })}
            </select>
          )}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Time window"
            className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text focus:border-accent"
          >
            {WINDOWS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </>
      }
    >
      {!ready ? (
        <main className="flex-1 p-2">
          <Panel title="LLM usage">
            <p className="p-3 text-[11px] text-text-secondary">
              Pick an organization to see its LLM usage — calls are metered per tenant.
            </p>
          </Panel>
        </main>
      ) : error ? (
        <main className="flex-1 p-2"><Panel title="LLM usage"><PanelError onRetry={load} /></Panel></main>
      ) : loading || !usage ? (
        <main className="flex-1 p-2"><Panel title="LLM usage"><SkeletonRows rows={8} /></Panel></main>
      ) : (
        <>
          <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-5">
            <KPI label="Calls" value={num(usage.total_calls)} sub={`last ${usage.window_days} days`} />
            <KPI
              label="Success rate"
              value={usage.success_rate === null ? '—' : `${Math.round(usage.success_rate * 100)}%`}
              sub={`${num(usage.failed_calls)} failed`}
              tone={usage.success_rate !== null && usage.success_rate < 0.9 ? 'text-negative' : 'text-positive'}
            />
            <KPI label="Tokens" value={num(usage.total_tokens)} sub={`${num(usage.tokens_in)} in · ${num(usage.tokens_out)} out`} />
            <KPI label="Avg latency" value={usage.avg_latency_ms === null ? '—' : `${num(usage.avg_latency_ms)} ms`} />
            <KPI label="P95 latency" value={usage.p95_latency_ms === null ? '—' : `${num(usage.p95_latency_ms)} ms`} />
          </div>

          <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            {!usage.total_calls && (
              <p className="rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-text-secondary">
                No LLM calls metered in this window. Only calls that actually reach a configured provider
                are counted — generations that fell back to the local heuristic cost no tokens and are not
                recorded here. Configure a provider in AI Settings to start metering.
              </p>
            )}

            <div className="shrink-0">
              <FigurePlate
                fig="7.1"
                title="Daily call volume"
                fields={[
                  { label: 'WINDOW', value: `${usage.window_days}d` },
                  { label: 'PEAK', value: `${num(Math.max(...usage.daily.map((d) => d.calls), 1))}/day` },
                  { label: 'REF', value: 'P3' },
                ]}
                caption="Metered LLM calls per day. Failures stack on top in fail red; only calls that reached a configured provider are counted."
              >
                <DailyChart daily={usage.daily} />
              </FigurePlate>
            </div>

            <div className="grid shrink-0 gap-2 lg:grid-cols-2">
              <Panel title="By use case" className="shrink-0"><BarList rows={usage.use_cases} empty="No calls yet." /></Panel>
              <Panel title="By model" className="shrink-0"><BarList rows={usage.models} empty="No calls yet." /></Panel>
              <Panel title="By provider" className="shrink-0"><BarList rows={usage.providers} empty="No providers used yet." /></Panel>
              <Panel title="By actor" className="shrink-0"><BarList rows={usage.actors} empty="No actors yet." /></Panel>
            </div>

            {usage.recent_failures.length > 0 && (
              <Panel
                title="Recent failures"
                className="shrink-0"
                right={<Badge tone="negative">{usage.failed_calls}</Badge>}
              >
                <ul className="divide-y divide-border">
                  {usage.recent_failures.map((f, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                      <AlertTriangle size={11} className="text-negative" />
                      <span className="font-mono text-[10.5px] text-text">{f.use_case}</span>
                      <span className="font-mono text-[9.5px] text-text-secondary">{f.provider}</span>
                      <span className="font-mono text-[9px] text-text-tertiary">{f.actor}</span>
                      <span className="ml-auto font-mono text-[9px] text-text-tertiary">
                        {new Date(f.at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel title="Recent calls" className="shrink-0">
              {!usage.recent.length ? (
                <p className="p-3 text-[11px] text-text-secondary">Nothing yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[10.5px]">
                    <thead>
                      <tr>
                        {['When', 'Use case', 'Model', 'Status', 'Tokens', 'Latency', 'Actor'].map((h) => (
                          <th key={h} className="border-b border-border bg-surface px-2 py-1.5 text-left text-[9px] font-medium uppercase tracking-widest text-text-tertiary">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {usage.recent.map((r, i) => (
                        <tr key={i} className="border-b border-border hover:bg-surface-hover">
                          <td className="whitespace-nowrap px-2 py-1 font-mono text-text-tertiary">{new Date(r.at).toLocaleString()}</td>
                          <td className="px-2 py-1 font-mono">{r.use_case}</td>
                          <td className="max-w-[220px] truncate px-2 py-1 font-mono text-text-secondary" title={r.model}>{r.model}</td>
                          <td className="px-2 py-1">
                            <Badge tone={r.status === 'ok' ? 'positive' : 'negative'}>{r.status}</Badge>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 font-mono text-text-secondary">
                            {r.tokens_in ?? 0} / {r.tokens_out ?? 0}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 font-mono text-text-secondary">{num(r.latency_ms)} ms</td>
                          <td className="max-w-[180px] truncate px-2 py-1 font-mono text-text-tertiary" title={r.actor}>{r.actor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </main>
        </>
      )}
    </AppShell>
  );
}
