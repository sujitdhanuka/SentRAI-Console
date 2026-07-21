import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { AiProviders } from '../components/console/AiProviders';
import { AppShell } from '../components/console/AppShell';
import { PromptVault } from '../components/console/PromptVault';
import { Panel } from '../components/ui/Panel';
import { useSession } from '../stores/session';

interface Usage {
  total_calls: number;
  ok_calls: number;
  failed_calls: number;
  tokens_in: number;
  tokens_out: number;
  avg_latency_ms: number | null;
  by_use_case: Record<string, number>;
}

interface Org { organization_id?: string; id?: string; name: string }

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">{label}</div>
      <div className={`font-mono text-base leading-tight ${tone ?? 'text-text'}`}>{value}</div>
      <div className="font-mono text-[8.5px] text-text-tertiary">{sub}</div>
    </div>
  );
}

export function AiSettings() {
  const user = useSession((s) => s.user);
  // A global admin (ADMIN with no org of their own) configures AI per-org, so
  // they must pick a target organization first.
  const needsOrgPicker = user?.role === 'ADMIN' && !user?.tenant_id;
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);

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

  const loadUsage = useCallback(() => {
    if (!ready) return;
    const qs = scope ? `?organization_id=${encodeURIComponent(scope)}` : '';
    api<Usage>(`/ai/usage${qs}`).then(setUsage).catch(() => setUsage(null));
  }, [scope, ready]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  const byUseCase = Object.entries(usage?.by_use_case ?? {})
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ');

  return (
    <AppShell
      title="AI Settings"
      actions={
        needsOrgPicker ? (
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
        ) : undefined
      }
    >
      {usage && usage.total_calls > 0 && (
        <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">
          <Stat label="AI calls" value={String(usage.total_calls)} sub={byUseCase || 'across use cases'} />
          <Stat
            label="Failed"
            value={String(usage.failed_calls)}
            sub={`${usage.ok_calls} succeeded`}
            tone={usage.failed_calls > 0 ? 'text-negative' : 'text-positive'}
          />
          <Stat label="Tokens" value={`${usage.tokens_in.toLocaleString()} / ${usage.tokens_out.toLocaleString()}`} sub="in / out" />
          <Stat label="Avg latency" value={usage.avg_latency_ms == null ? '—' : `${usage.avg_latency_ms} ms`} sub="successful calls" />
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-2">
        {!ready ? (
          <Panel title="AI Settings">
            <p className="p-3 text-[11px] text-text-secondary">
              You are a global admin — pick an organization above to configure its AI providers and prompts.
            </p>
          </Panel>
        ) : (
          <div className="flex flex-col gap-2">
            <AiProviders orgId={scope} onChanged={loadUsage} />
            <PromptVault orgId={scope} />
          </div>
        )}
      </main>
    </AppShell>
  );
}
