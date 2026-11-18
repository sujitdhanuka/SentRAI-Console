import { Check, KeyRound, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';
import { useGovernanceFeatures } from '../stores/governanceFeatures';
import { useSession } from '../stores/session';

interface User {
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  organization_id: string | null;
  organization_name: string | null;
}

interface Org {
  organization_id: string;
  name: string;
}

interface EditDraft {
  full_name: string;
  role: string;
  organization_id: string;
}

const ROLE_TONE: Record<string, BadgeTone> = {
  ADMIN: 'negative', OWNER: 'accent', CISO: 'warning', APPROVER: 'neutral',
  REVIEWER: 'accent', AUDITOR: 'accent', VIEWER: 'neutral',
};

/** An OWNER administers their own org but can never mint an ADMIN — the role
 *  ceiling is enforced server-side; the UI simply doesn't offer it. */
const ALL_ROLES = ['ADMIN', 'OWNER', 'CISO', 'APPROVER', 'REVIEWER', 'AUDITOR', 'VIEWER'];

import { fieldClass as FIELD } from '../components/ui/form';
import { labelClass as LABEL } from '../components/ui/form';

export function Users() {
  const toast = useConsoleUi((s) => s.toast);
  const me = useSession((s) => s.user);
  const isGlobalAdmin = me?.role === 'ADMIN' && !me?.tenant_id;
  // A user with no organization (a global ADMIN, or an OWNER set up without
  // one) manages every organization and may place users in any of them.
  const isGlobal = !me?.tenant_id;
  const assignable = isGlobalAdmin ? ALL_ROLES : ALL_ROLES.filter((r) => r !== 'ADMIN');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ full_name: '', role: '', organization_id: '' });

  const [rows, setRows] = useState<User[]>([]);
  // E2.6: training compliance per user, shown only while the training flag is on.
  const features = useGovernanceFeatures((s) => s.features);
  const loadFeatures = useGovernanceFeatures((s) => s.load);
  const [training, setTraining] = useState<Record<string, { compliant: boolean; overdue: number; expiring: number }>>({});
  useEffect(() => {
    void loadFeatures();
  }, [loadFeatures]);
  useEffect(() => {
    if (!features?.training) return;
    api<{ users: Record<string, { compliant: boolean; overdue: number; expiring: number }> }>('/governance/training/user-status')
      .then((r) => setTraining(r.users ?? {}))
      .catch(() => setTraining({}));
  }, [features?.training, rows.length]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'VIEWER', organization_id: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [users, orgList] = await Promise.all([
        api<User[]>('/users'),
        api<Org[]>('/users/organizations').catch(() => [] as Org[]),
      ]);
      setRows(users);
      setOrgs(orgList);
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

  const startEdit = (u: User) => {
    setEditing(u.user_id);
    setDraft({ full_name: u.full_name, role: u.role, organization_id: u.organization_id ?? '' });
  };

  const saveEdit = async (u: User) => {
    const body: Record<string, unknown> = {};
    if (draft.full_name.trim() && draft.full_name.trim() !== u.full_name) body.full_name = draft.full_name.trim();
    if (draft.role !== u.role) body.role = draft.role;
    if (isGlobal && draft.organization_id !== (u.organization_id ?? '')) body.organization_id = draft.organization_id || null;
    if (Object.keys(body).length === 0) {
      setEditing(null);
      return;
    }
    try {
      await api(`/users/${u.user_id}`, { method: 'PATCH', body: JSON.stringify(body) });
      const self = u.email === me?.email;
      toast(
        self && 'organization_id' in body ? 'Organization changed. Sign out and back in to apply it.' : 'User updated',
        'positive',
      );
      setEditing(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'negative');
    }
  };

  const orgSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select className={FIELD} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">No organization (global)</option>
      {orgs.map((o) => <option key={o.organization_id} value={o.organization_id}>{o.name}</option>)}
    </select>
  );

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
        <Button variant="primary" size="sm" onClick={() => setOpen((v) => !v)} icon={<Plus size={13} />}>Add user</Button>
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
            <div className="mt-2 max-w-sm">
              <label className={LABEL}>Organization</label>
              {isGlobal ? (
                orgSelect(form.organization_id, (v) => setForm({ ...form, organization_id: v }), 'Organization')
              ) : (
                <input className={FIELD} disabled value={orgs[0]?.name ?? 'Your organization'} aria-label="Organization" />
              )}
              {isGlobal && !form.organization_id && (
                <p className="mt-1 text-[10px] text-text-tertiary">Governance needs an organization. Leave this blank only for platform-wide users.</p>
              )}
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" size="sm" icon={<UserPlus size={12} />}>Create user</Button>
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
                  <th className={TH}>Organization</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) =>
                  editing === u.user_id ? (
                    <tr key={u.user_id} className="border-b border-border bg-surface-hover">
                      <td className="px-2 py-1.5">
                        <input className={FIELD} value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} aria-label={`Full name for ${u.email}`} />
                        <div className="mt-0.5 font-mono text-[9.5px] text-text-tertiary">{u.email}</div>
                      </td>
                      <td className="px-2 py-1.5">
                        <select className={FIELD} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} aria-label={`Role for ${u.email}`}>
                          {[...new Set([u.role, ...assignable])].map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        {isGlobal ? (
                          orgSelect(draft.organization_id, (v) => setDraft({ ...draft, organization_id: v }), `Organization for ${u.email}`)
                        ) : (
                          <span className="text-text-secondary">{u.organization_name ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge tone={u.is_active ? 'positive' : 'neutral'}>{u.is_active ? 'active' : 'disabled'}</Badge>
                        {training[u.user_id] && (
                          <span className="ml-1">
                            <Badge tone={training[u.user_id].compliant ? (training[u.user_id].expiring ? 'warning' : 'positive') : 'negative'} title="Mandatory AI training">
                              {training[u.user_id].compliant ? (training[u.user_id].expiring ? 'training expiring' : 'trained') : `${training[u.user_id].overdue} training due`}
                            </Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="flex flex-wrap gap-1.5">
                          <Button variant="primary" size="sm" onClick={() => saveEdit(u)} icon={<Check size={11} />}>Save</Button>
                          <Button variant="secondary" size="sm" onClick={() => setEditing(null)} icon={<X size={11} />}>Cancel</Button>
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr key={u.user_id} className="border-b border-border hover:bg-surface-hover">
                      <td className="px-2 py-1.5">
                        <div className="text-[11px] font-medium text-text">{u.full_name}</div>
                        <div className="font-mono text-[9.5px] text-text-tertiary">{u.email}</div>
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge tone={ROLE_TONE[u.role] ?? 'neutral'}>{u.role}</Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        {u.organization_name ? (
                          <span className="text-text-secondary">{u.organization_name}</span>
                        ) : (
                          <span className="font-mono text-[9.5px] text-text-tertiary">none (global)</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge tone={u.is_active ? 'positive' : 'neutral'}>{u.is_active ? 'active' : 'disabled'}</Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="flex flex-wrap gap-1.5">
                          <button onClick={() => startEdit(u)} className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover">
                            <Pencil size={10} /> Edit
                          </button>
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
                  ),
                )}
              </tbody>
            </table>
          )}
        </Panel>
        {!isGlobalAdmin && (
          <p className="mt-1.5 px-1 text-[10px] text-text-tertiary">
            {isGlobal ? 'You administer users in every organization.' : 'You administer users within your own organization.'} Minting global ADMINs is reserved for platform admins.
          </p>
        )}
      </main>
    </AppShell>
  );
}
