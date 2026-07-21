import { RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';

interface AuditEvent {
  id?: string;
  actor?: string;
  method?: string;
  path?: string;
  status_code?: number;
  occurred_at?: string;
  payload?: unknown;
}

const METHOD_TONE: Record<string, BadgeTone> = {
  POST: 'positive', PATCH: 'warning', PUT: 'warning', DELETE: 'negative', GET: 'neutral',
};

const TH = 'sticky top-0 z-10 border-b border-border bg-surface px-2 py-1.5 text-left text-[9px] font-medium uppercase tracking-widest text-text-tertiary';
const TD = 'px-2 py-1.5 align-top';

export function AuditTrail() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actor, setActor] = useState('');
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '200' });
      if (actor.trim()) qs.set('actor', actor.trim());
      if (path.trim()) qs.set('path', path.trim());
      const rows = await api<AuditEvent[]>(`/audit/events?${qs}`);
      setEvents(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit events');
    } finally {
      setLoading(false);
    }
  }, [actor, path]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell
      title="Audit Trail"
      actions={
        <button onClick={() => void load()} title="Refresh" aria-label="Refresh" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-hover">
          <RefreshCw size={13} />
        </button>
      }
    >
      <main className="flex min-h-0 flex-1 flex-col p-2">
        <Panel
          title="Mutating API actions"
          className="flex-1"
          right={<Badge tone="neutral">{events.length}</Badge>}
        >
          <div className="sticky top-0 z-20 flex flex-wrap gap-2 border-b border-border bg-surface p-2">
            <span className="flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2">
              <Search size={11} className="text-text-tertiary" />
              <input
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                placeholder="filter by actor"
                className="w-40 bg-transparent py-1 text-[11px] text-text placeholder:text-text-tertiary focus:outline-none"
              />
            </span>
            <span className="flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2">
              <Search size={11} className="text-text-tertiary" />
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="filter by path"
                className="w-48 bg-transparent py-1 text-[11px] text-text placeholder:text-text-tertiary focus:outline-none"
              />
            </span>
            <span className="ml-auto self-center font-mono text-[9px] text-text-tertiary">
              PII-masked · append-only
            </span>
          </div>

          {error ? (
            <PanelError onRetry={load} />
          ) : loading ? (
            <SkeletonRows rows={10} />
          ) : !events.length ? (
            <p className="p-3 text-[11px] text-text-secondary">No audit events match this filter.</p>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className={TH}>When</th>
                  <th className={TH}>Actor</th>
                  <th className={TH}>Action</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => {
                  const key = e.id ?? String(i);
                  const ok = (e.status_code ?? 200) < 400;
                  return (
                    <>
                      <tr
                        key={key}
                        onClick={() => setExpanded(expanded === key ? null : key)}
                        className="cursor-pointer border-b border-border hover:bg-surface-hover"
                      >
                        <td className={`${TD} font-mono text-[9.5px] text-text-tertiary`}>
                          {e.occurred_at ? new Date(e.occurred_at).toLocaleString() : '—'}
                        </td>
                        <td className={`${TD} text-[10.5px] text-text-secondary`}>{e.actor ?? 'system'}</td>
                        <td className={TD}>
                          <span className="flex items-center gap-1.5">
                            <Badge tone={METHOD_TONE[e.method ?? 'GET'] ?? 'neutral'}>{e.method ?? '—'}</Badge>
                            <code className="font-mono text-[10px] text-text">{e.path ?? '—'}</code>
                          </span>
                        </td>
                        <td className={`${TD} font-mono text-[10px] ${ok ? 'text-positive' : 'text-negative'}`}>
                          {e.status_code ?? '—'}
                        </td>
                      </tr>
                      {expanded === key && e.payload != null && (
                        <tr key={`${key}-x`} className="border-b border-border">
                          <td colSpan={4} className="px-2 pb-2">
                            <pre className="max-h-52 overflow-auto rounded border border-border bg-bg-elevated p-2 font-mono text-[9.5px] text-text-secondary">
                              {JSON.stringify(e.payload, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </main>
    </AppShell>
  );
}
