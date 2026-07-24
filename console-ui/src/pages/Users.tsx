import { KeyRound, Plus, Trash2, UserPlus } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';
import { useSession } from '../stores/session';

interface User {
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  tenant_id?: string | null;
}

const ROLE_TONE: Record<string, BadgeTone> = {
  ADMIN: 'negative', OWNER: 'accent', CISO: 'warning', APPROVER: 'neutral',
  REVIEWER: 'accent', AUDITOR: 'accent', VIEWER: 'neutral',
};

/** An OWNER administers their own org but can never mint an ADMIN — the role
 *  ceiling is enforced server-side; the UI simply doesn't offer it. */
const ALL_ROLES = ['ADMIN', 'OWNER', 'CISO', 'APPROVER', 'REVIEWER', 'AUDITOR', 'VIEWER'];

const FIELD = 'w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text placeholder:text-text-tertiary focus:border-accent';
const LABEL = 'mb-1 block text-[9px] font-medium uppercase tracking-widest text-text-tertiary';

export function Users() {
  const toast = useConsoleUi((s) => s.toast);
  const me = useSession((s) => s.user);
  const isGlobalAdmin = me?.role === 'ADMIN' && !me?.tenant_id;
  const assignable = isGlobalAdmin ? ALL_ROLES : ALL_ROLES.filter((r) => r !== 'ADMIN');

  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'VIEWER', organization_id: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<User[]>('/users'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body: Record<string, unknown> = { ...form };
      if (!form.organization_id) delete body.organization_id;
      await api('/users', { method: 'POST', body: JSON.stringify(body) });
      toast('User created', 'positive');
      setOpen(false);
      setForm({ email: '', full_name: '', password: '', role: 'VIEWER', organization_id: '' });
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Create failed', 'negative');
    }
  };

  const patch = async (u: User, body: Record<string, unknown>, msg: string) => {
    try {
      await api(`/users/${u.user_id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast(msg);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'negative');
    }
  };

  const resetPassword = async (u: User) => {
    const pw = window.prompt(`New password for ${u.email} (min 8 chars):`);
    if (!pw) return;
    try {
      await api(`/users/${u.user_id}/reset-password`, { method: 'PATCH', body: JSON.stringify({ new_password: pw }) });
      toast('Password reset', 'positive');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Reset failed', 'negative');
    }
  };

  const remove = async (u: User) => {
    if (!window.confirm(`Permanently remove ${u.email}?`)) return;
    try {
      await api(`/users/${u.user_id}`, { method: 'DELETE' });
      toast('User removed');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'negative');
    }
  };

  const TH = 'sticky top-0 z-10 border-b border-border bg-surface px-2 py-1.5 text-left text-[9px] font-medium uppercase tracking-widest text-text-tertiary';

  return (
    <AppShell
      title="Users"
      actions={
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90">
          <Plus size={13} /> Add user
        </button>
      }
    >
      <main className="flex min-h-0 flex-1 flex-col p-2">
        {open && (
          <form onSubmit={add} className="mb-2 rounded-md border border-border bg-surface p-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div><label className={LABEL}>Email</label><input className={FIELD} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><label className={LABEL}>Full name</label><input className={FIELD} required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><label className={LABEL}>Password</label><input className={FIELD} type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
              <div>
                <label className={LABEL}>Role</label>
                <select className={FIELD} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {assignable.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            {isGlobalAdmin && (
              <div className="mt-2 max-w-sm">
                <label className={LABEL}>Organization id (optional)</label>
                <input className={FIELD} value={form.organization_id} onChange={(e) => setForm({ ...form, organization_id: e.target.value })} placeholder="leave blank for a global user" />
              </div>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover">Cancel</button>
              <button type="submit" className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90">
                <UserPlus size={12} /> Create user
              </button>
            </div>
          </form>
        )}

        <Panel title="Console users" className="flex-1" right={<Badge tone="neutral">{rows.length}</Badge>}>
          {error ? (
            <PanelError onRetry={load} />
          ) : loading ? (
            <SkeletonRows rows={6} />
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className={TH}>User</th>
                  <th className={TH}>Role</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.user_id} className="border-b border-border hover:bg-surface-hover">
                    <td className="px-2 py-1.5">
                      <div className="text-[11px] font-medium text-text">{u.full_name}</div>
                      <div className="font-mono text-[9.5px] text-text-tertiary">{u.email}</div>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={u.role}
                        onChange={(e) => patch(u, { role: e.target.value }, `Role set to ${e.target.value}`)}
                        aria-label={`Role for ${u.email}`}
                        className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[9.5px] text-text-secondary"
                      >
                        {[...new Set([u.role, ...assignable])].map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <span className="ml-1.5"><Badge tone={ROLE_TONE[u.role] ?? 'neutral'}>{u.role}</Badge></span>
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge tone={u.is_active ? 'positive' : 'neutral'}>{u.is_active ? 'active' : 'disabled'}</Badge>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="flex flex-wrap gap-1.5">
                        <button onClick={() => patch(u, { is_active: !u.is_active }, u.is_active ? 'User disabled' : 'User enabled')} className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover">
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button onClick={() => resetPassword(u)} className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover">
                          <KeyRound size={10} /> Password
                        </button>
                        <button onClick={() => remove(u)} aria-label={`Remove ${u.email}`} className="rounded-md border border-border px-1.5 py-0.5 text-text-tertiary hover:bg-surface-hover hover:text-negative">
                          <Trash2 size={10} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        {!isGlobalAdmin && (
          <p className="mt-1.5 px-1 text-[10px] text-text-tertiary">
            You administer users within your own organization. Minting global ADMINs is reserved for platform admins.
          </p>
        )}
      </main>
    </AppShell>
  );
}
