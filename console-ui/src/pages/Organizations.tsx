import { Building2, Plus } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';

interface Org {
  organization_id?: string;
  id?: string;
  name: string;
  description?: string;
  plan?: string;
  created_at?: string;
}

const PLANS = ['COMMUNITY', 'GROWTH', 'ENTERPRISE'];
const PLAN_TONE: Record<string, BadgeTone> = { COMMUNITY: 'neutral', GROWTH: 'accent', ENTERPRISE: 'positive' };

const FIELD = 'w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text placeholder:text-text-tertiary focus:border-accent';

export function Organizations() {
  const toast = useConsoleUi((s) => s.toast);
  const [rows, setRows] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<Org[]>('/organizations/'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/organizations/', { method: 'POST', body: JSON.stringify(form) });
      toast('Organization created', 'positive');
      setOpen(false);
      setForm({ name: '', description: '' });
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Create failed', 'negative');
    }
  };

  const setPlan = async (org: Org, plan: string) => {
    const id = org.organization_id ?? org.id ?? '';
    try {
      await api(`/organizations/${id}/plan`, { method: 'PATCH', body: JSON.stringify({ plan }) });
      toast(`${org.name} moved to ${plan}`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Plan update failed', 'negative');
    }
  };

  return (
    <AppShell
      title="Organizations"
      actions={
        <Button variant="primary" size="sm" onClick={() => setOpen((v) => !v)} icon={<Plus size={13} />}>New organization</Button>
      }
    >
      <main className="flex min-h-0 flex-1 flex-col p-2">
        <p className="mb-2 max-w-[80ch] px-1 text-[11px] leading-relaxed text-text-secondary">
          Each organization is a tenant: its projects, models, gate ledger, AI providers, prompts, and
          users are fully isolated from every other organization.
        </p>

        {open && (
          <form onSubmit={create} className="mb-2 max-w-lg rounded-md border border-border bg-surface p-3">
            <input className={`${FIELD} mb-2`} required placeholder="Organization name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={FIELD} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" size="sm">Create</Button>
            </div>
          </form>
        )}

        <Panel title="Tenants" className="flex-1" right={<Badge tone="neutral">{rows.length}</Badge>}>
          {error ? (
            <PanelError onRetry={load} />
          ) : loading ? (
            <SkeletonRows rows={4} />
          ) : !rows.length ? (
            <p className="p-3 text-[11px] text-text-secondary">No organizations yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((o) => {
                const id = o.organization_id ?? o.id ?? '';
                return (
                  <li key={id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <Building2 size={13} className="text-text-tertiary" />
                    <span className="text-[11.5px] font-medium text-text">{o.name}</span>
                    {o.description && <span className="text-[10.5px] text-text-secondary">· {o.description}</span>}
                    <span className="font-mono text-[9px] text-text-tertiary">{id.slice(0, 8)}</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      <Badge tone={PLAN_TONE[o.plan ?? 'COMMUNITY'] ?? 'neutral'}>{o.plan ?? 'COMMUNITY'}</Badge>
                      <select
                        value={o.plan ?? 'COMMUNITY'}
                        onChange={(e) => setPlan(o, e.target.value)}
                        aria-label={`Plan for ${o.name}`}
                        className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[9.5px] text-text-secondary"
                      >
                        {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <p className="mt-1.5 px-1 text-[10px] text-text-tertiary">
          Plan limits are soft — crossing one warns and notifies, but never blocks registration or compliance features.
        </p>
      </main>
    </AppShell>
  );
}
