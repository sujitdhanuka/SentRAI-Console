import { History, Landmark, Save, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { fieldClass as FIELD, labelClass as LABEL } from '../components/ui/form';
import { useConsoleUi } from '../stores/consoleUi';
import { useGovernanceFeatures } from '../stores/governanceFeatures';
import { useSession } from '../stores/session';
import { ContextTab, ImpactTab, RiskRegisterTab } from './GovernanceRegister';
import { ActionsTab, AimsTab, DocumentsTab } from './GovernanceAims';
import { AssuranceTab, AuDtaTab, DatasetsTab, DecisionsTab, FairLendingTab, TrainingTab, ValidationTab, VendorsTab } from './GovernancePhase2';
import { DisclosuresTab, EnergyTab, EngagementTab, FederalTab, IncidentsExtTab, SecurityTab, SoaTab, TevvTab } from './GovernancePhase3';

/* ------------------------------------------------------------------ types */

type Tier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
const TIERS: Tier[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

interface Band { name: string; min: number; max: number }
interface SettingsDoc {
  scoringMatrix: '5x5' | '3x3';
  bands: Band[];
  gateMode: Record<Tier, 'OFF' | 'WARN' | 'BLOCK'>;
  primaryJurisdiction: string;
  enabledPacks: string[];
  peopleItems: Record<string, { mode: 'LIGHT_RECORD' | 'CUSTOMER'; owner?: string | null; note?: string | null }>;
  appetite: {
    ceilings: Record<string, number>;
    approvers: Record<string, string[]>;
    parameters: Record<string, any>;
    requiredAuditType: Record<Tier, 'INTERNAL' | 'THIRD_PARTY'>;
    boardApprovedAt?: string | null;
    reviewCycleMonths?: number | null;
  };
}
interface SettingsView {
  org_id: string;
  version: number;
  effective_from: string | null;
  is_default: boolean;
  can_edit: boolean;
  settings: SettingsDoc;
  floors: Array<{ name: string; value: any; packs: string[] }>;
  upcoming: Array<{ version: number; effective_from: string; reason: string; changed_by: string; changes: Change[] }>;
  catalog: {
    packs: Array<{ pack_id: string; name: string; baseline: boolean; region: string | null; version: string }>;
    jurisdictions: string[];
    risk_categories: string[];
    people_items: Record<string, { label: string; isoClause?: string }>;
    band_presets: Record<string, Band[]>;
    approver_options: string[];
    parameters?: Array<{ name: string; enforced: boolean; enforced_by: string[] }>;
  };
}
interface Change { field: string; from: any; to: any }
interface HistoryView { versions: Array<{ version: number; effective_from: string; changed_by: string; changed_by_role: string; reason: string; changes: Change[]; created_at: string }> }
interface Member { user_id: string; email: string; full_name: string; role: string }
interface Accountability {
  org_id: string;
  accountable_official: Member | null;
  governance_board: Array<{ user_id?: string | null; name: string; title?: string | null }>;
  history: Array<{ changed_at: string; changed_by: string; reason: string; from: any; to: any }>;
  can_edit: boolean;
  members: Member[];
}
interface OwnerRegister {
  models: Array<{ model_id: string; name: string; risk_level: string; lifecycle_stage: string; owner_team: string; owner: Member | null }>;
  unowned: number;
}

/** Parameters the window exposes, with the strictest-wins direction shown to the user. */
const PARAMS: Array<{ name: string; label: string; unit: string; step?: number }> = [
  { name: 'redTeamIntervalDays.HIGH', label: 'Red-team interval · HIGH/CRITICAL', unit: 'days' },
  { name: 'redTeamIntervalDays.MEDIUM', label: 'Red-team interval · MEDIUM', unit: 'days' },
  { name: 'redTeamIntervalDays.LOW', label: 'Red-team interval · LOW', unit: 'days' },
  { name: 'auditIntervalDays.HIGH', label: 'Audit interval · HIGH/CRITICAL', unit: 'days' },
  { name: 'bcpDrillIntervalDays', label: 'BCP drill interval', unit: 'days' },
  { name: 'driftRecencyDays', label: 'Max age of drift evaluation', unit: 'days' },
  { name: 'incidentReportHours', label: 'Incident reporting deadline', unit: 'hours' },
  { name: 'psiAlertThreshold', label: 'Drift alert (PSI)', unit: 'PSI', step: 0.01 },
  { name: 'fairnessRatioMin', label: 'Minimum fairness ratio', unit: 'ratio', step: 0.01 },
];

const fmt = (v: any) => (v === null || v === undefined ? '—' : Array.isArray(v) ? v.join(', ') || '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function ChangeList({ changes }: { changes: Change[] }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {changes.map((c) => (
        <li key={c.field} className="font-mono text-[9.5px] text-text-secondary">
          <span className="text-accent">{c.field}</span>: {fmt(c.from)} → <span className="text-text">{fmt(c.to)}</span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------- settings tab */

function SettingsTab() {
  const toast = useConsoleUi((s) => s.toast);
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<SettingsDoc | null>(null);
  const [reason, setReason] = useState('');
  const [effective, setEffective] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const v = await api<SettingsView>('/governance/settings');
      setView(v);
      setDraft(JSON.parse(JSON.stringify(v.settings)));
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => view && draft && JSON.stringify(view.settings) !== JSON.stringify(draft), [view, draft]);
  if (error) return <Panel title="Governance settings"><PanelError onRetry={load} /></Panel>;
  if (!view || !draft) return <Skeleton className="h-96 w-full" />;
  const ro = !view.can_edit;
  const set = (fn: (d: SettingsDoc) => void) => {
    const next: SettingsDoc = JSON.parse(JSON.stringify(draft));
    fn(next);
    setDraft(next);
  };
  const floorFor = (name: string) => view.floors.find((f) => f.name === name);

  const save = async () => {
    setSaving(true);
    setProblems([]);
    try {
      const res = await api<SettingsView & { saved_version: number }>('/governance/settings', {
        method: 'PUT',
        body: JSON.stringify({
          settings: draft,
          reason,
          ...(effective ? { effective_from: new Date(effective).toISOString() } : {}),
        }),
      });
      toast(`Saved as version ${res.saved_version}`, 'positive');
      setReason('');
      setEffective('');
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setProblems(msg.split(', '));
      toast('Settings not saved', 'negative');
    } finally {
      setSaving(false);
    }
  };

  const maxScore = draft.scoringMatrix === '3x3' ? 9 : 25;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[11px]">
        <Landmark size={13} className="text-accent" />
        <span className="text-text">
          {view.is_default ? 'Default settings (never changed)' : `Version ${view.version}, in force since ${new Date(view.effective_from!).toLocaleDateString()}`}
        </span>
        {ro && <Badge tone="neutral">read only · Owner or CISO can change</Badge>}
        {view.upcoming.map((u) => (
          <Badge key={u.version} tone="warning" title={u.reason}>
            v{u.version} from {new Date(u.effective_from).toLocaleDateString()}
          </Badge>
        ))}
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <Panel title="Risk scoring">
          <div className="space-y-2 p-3">
            <div>
              <label className={LABEL} htmlFor="matrix">Scoring matrix</label>
              <select
                id="matrix"
                className={FIELD}
                disabled={ro}
                value={draft.scoringMatrix}
                onChange={(e) =>
                  set((d) => {
                    d.scoringMatrix = e.target.value as '5x5' | '3x3';
                    d.bands = JSON.parse(JSON.stringify(view.catalog.band_presets[d.scoringMatrix]));
                    const names = d.bands.map((b) => b.name);
                    for (const k of Object.keys(d.appetite.approvers)) if (!names.includes(k)) delete d.appetite.approvers[k];
                    for (const n of names) d.appetite.approvers[n] ??= ['ACCOUNTABLE_OFFICIAL'];
                    for (const k of Object.keys(d.appetite.ceilings)) d.appetite.ceilings[k] = Math.min(d.appetite.ceilings[k], d.scoringMatrix === '3x3' ? 4 : 9);
                  })
                }
              >
                <option value="5x5">5 × 5, four bands</option>
                <option value="3x3">3 × 3, three bands</option>
              </select>
              <p className="mt-1 text-[10px] text-text-tertiary">Existing risks keep their scores and are flagged for re-scoring at their next review.</p>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-wider text-text-tertiary">
                  <th className="py-1">Band</th><th>From</th><th>To</th>
                </tr>
              </thead>
              <tbody>
                {draft.bands.map((b, i) => (
                  <tr key={b.name}>
                    <td className="py-0.5 font-mono">{b.name}</td>
                    {(['min', 'max'] as const).map((k) => (
                      <td key={k} className="pr-2">
                        <input
                          aria-label={`${b.name} ${k}`}
                          type="number"
                          min={1}
                          max={maxScore}
                          className={FIELD}
                          disabled={ro}
                          value={b[k]}
                          onChange={(e) => set((d) => { d.bands[i][k] = Number(e.target.value); })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Deploy gate for unaccepted residual risk">
          <div className="grid grid-cols-2 gap-2 p-3">
            {TIERS.map((t) => (
              <div key={t}>
                <label className={LABEL} htmlFor={`gate-${t}`}>{t} models</label>
                <select
                  id={`gate-${t}`}
                  className={FIELD}
                  disabled={ro}
                  value={draft.gateMode[t]}
                  onChange={(e) => set((d) => { d.gateMode[t] = e.target.value as any; })}
                >
                  <option value="OFF">Off</option>
                  <option value="WARN">Warn</option>
                  <option value="BLOCK">Block</option>
                </select>
              </div>
            ))}
            <p className="col-span-2 text-[10px] text-text-tertiary">
              Applies to the CI gate and lifecycle promotion when residual risk is above appetite and not accepted, or a required impact assessment is not final.
            </p>
          </div>
        </Panel>

        <Panel title="Framework packs and jurisdiction">
          <div className="space-y-2 p-3">
            <div>
              <label className={LABEL} htmlFor="juris">Primary jurisdiction</label>
              <select id="juris" className={FIELD} disabled={ro} value={draft.primaryJurisdiction}
                onChange={(e) => set((d) => { d.primaryJurisdiction = e.target.value; })}>
                {view.catalog.jurisdictions.map((j) => <option key={j} value={j}>{j === 'INTL' ? 'International' : j}</option>)}
              </select>
            </div>
            <ul className="space-y-1">
              {view.catalog.packs.map((p) => (
                <li key={p.pack_id} className="flex items-center gap-2 text-[11px]">
                  <input
                    id={`pack-${p.pack_id}`}
                    type="checkbox"
                    disabled={ro || p.baseline}
                    checked={p.baseline || draft.enabledPacks.includes(p.pack_id)}
                    onChange={(e) => set((d) => {
                      d.enabledPacks = e.target.checked ? [...d.enabledPacks, p.pack_id] : d.enabledPacks.filter((x) => x !== p.pack_id);
                      if (e.target.checked && p.pack_id === 'rbi-free-ai') {
                        d.appetite.requiredAuditType.HIGH = 'THIRD_PARTY';
                        d.appetite.requiredAuditType.CRITICAL = 'THIRD_PARTY';
                      }
                    })}
                  />
                  <label htmlFor={`pack-${p.pack_id}`} className="text-text">{p.name}</label>
                  <span className="font-mono text-[9px] text-text-tertiary">v{p.version}</span>
                  {p.baseline ? <Badge tone="accent">always on</Badge> : <Badge tone="neutral">{p.region}</Badge>}
                </li>
              ))}
            </ul>
            {view.floors.length > 0 && (
              <div className="rounded border border-border p-2">
                <div className={LABEL}>Pack floors in force</div>
                {view.floors.map((f) => (
                  <div key={f.name} className="font-mono text-[10px] text-text-secondary">
                    {f.name} = {fmt(f.value)} <span className="text-text-tertiary">set by {f.packs.join(', ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="People-side items">
          <div className="divide-y divide-border">
            {Object.entries(view.catalog.people_items).map(([key, meta]) => {
              const item = draft.peopleItems[key] ?? { mode: 'CUSTOMER' };
              return (
                <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-1.5">
                  <div className="text-[11px] text-text">
                    {meta.label}
                    {meta.isoClause && <span className="ml-1 font-mono text-[9px] text-text-tertiary">ISO {meta.isoClause}</span>}
                  </div>
                  <select
                    aria-label={`${meta.label} mode`}
                    className={`${FIELD} w-44`}
                    disabled={ro}
                    value={item.mode}
                    onChange={(e) => set((d) => { d.peopleItems[key] = { ...item, mode: e.target.value as any }; })}
                  >
                    <option value="LIGHT_RECORD">Light record in SentRAI</option>
                    <option value="CUSTOMER">Customer responsibility</option>
                  </select>
                  {item.mode === 'CUSTOMER' && (
                    <input
                      aria-label={`${meta.label} owner`}
                      className={`${FIELD} col-span-2`}
                      placeholder="Named owner and note (shown in reports)"
                      disabled={ro}
                      value={item.owner ?? ''}
                      onChange={(e) => set((d) => { d.peopleItems[key] = { ...item, owner: e.target.value }; })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Panel title="Risk appetite">
        <div className="grid gap-3 p-3 lg:grid-cols-3">
          <div>
            <div className={LABEL}>Residual ceiling per category (max score {maxScore})</div>
            <div className="grid grid-cols-2 gap-1">
              {view.catalog.risk_categories.map((c) => (
                <label key={c} className="flex items-center gap-1 text-[10px] text-text-secondary">
                  <span className="w-24 truncate">{c.replace('_', ' ').toLowerCase()}</span>
                  <input type="number" min={1} max={maxScore} className={FIELD} disabled={ro}
                    value={draft.appetite.ceilings[c] ?? ''}
                    onChange={(e) => set((d) => { d.appetite.ceilings[c] = Number(e.target.value); })} />
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className={LABEL}>Who may accept residual risk</div>
            {draft.bands.map((b) => (
              <div key={b.name} className="mb-1">
                <div className="font-mono text-[10px] text-text">{b.name}</div>
                <div className="flex flex-wrap gap-2">
                  {view.catalog.approver_options.map((o) => (
                    <label key={o} className="flex items-center gap-1 text-[10px] text-text-secondary">
                      <input type="checkbox" disabled={ro}
                        checked={(draft.appetite.approvers[b.name] ?? []).includes(o)}
                        onChange={(e) => set((d) => {
                          const cur = d.appetite.approvers[b.name] ?? [];
                          d.appetite.approvers[b.name] = e.target.checked ? [...cur, o] : cur.filter((x) => x !== o);
                        })} />
                      {o === 'ACCOUNTABLE_OFFICIAL' ? 'Accountable official' : o.toLowerCase()}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className={`${LABEL} mt-2`}>Required audit type</div>
            <div className="grid grid-cols-2 gap-1">
              {TIERS.map((t) => (
                <label key={t} className="text-[10px] text-text-secondary">
                  {t}
                  <select className={FIELD} disabled={ro} value={draft.appetite.requiredAuditType[t]}
                    onChange={(e) => set((d) => { d.appetite.requiredAuditType[t] = e.target.value as any; })}>
                    <option value="INTERNAL">Internal</option>
                    <option value="THIRD_PARTY">Third party</option>
                  </select>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className={LABEL}>Intervals and thresholds (blank = pack or platform default)</div>
            {PARAMS.map((p) => {
              const floor = floorFor(p.name);
              return (
                <label key={p.name} className="mb-1 block text-[10px] text-text-secondary">
                  {p.label} <span className="text-text-tertiary">({p.unit})</span>
                  {floor && <span className="ml-1 text-warning">floor {fmt(floor.value)} · {floor.packs.join(', ')}</span>}
                  {(() => {
                    const st = view.catalog.parameters?.find((c) => c.name === p.name);
                    if (!st) return null;
                    return st.enforced
                      ? <span className="ml-1 text-text-tertiary" title={st.enforced_by.join(', ')}>enforced</span>
                      : <span className="ml-1 text-warning" title="Saved and resolved strictest-wins, but no check reads this value yet">recorded, not yet enforced</span>;
                  })()}
                  <input type="number" step={p.step ?? 1} min={0} className={FIELD} disabled={ro}
                    value={draft.appetite.parameters[p.name] ?? ''}
                    onChange={(e) => set((d) => {
                      if (e.target.value === '') delete d.appetite.parameters[p.name];
                      else d.appetite.parameters[p.name] = Number(e.target.value);
                    })} />
                </label>
              );
            })}
            <label className="mb-1 block text-[10px] text-text-secondary">
              Board approval date
              <input type="date" className={FIELD} disabled={ro} value={(draft.appetite.boardApprovedAt ?? '').slice(0, 10)}
                onChange={(e) => set((d) => { d.appetite.boardApprovedAt = e.target.value || null; })} />
            </label>
            <label className="block text-[10px] text-text-secondary">
              Review cycle (months)
              <input type="number" min={1} className={FIELD} disabled={ro} value={draft.appetite.reviewCycleMonths ?? ''}
                onChange={(e) => set((d) => { d.appetite.reviewCycleMonths = e.target.value ? Number(e.target.value) : null; })} />
            </label>
          </div>
        </div>
      </Panel>

      {!ro && (
        <div className="sticky bottom-0 flex flex-wrap items-end gap-2 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
          <div className="min-w-[260px] flex-1">
            <label className={LABEL} htmlFor="reason">Reason for change (required, recorded in the audit ledger)</label>
            <input id="reason" className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Risk committee resolution 2026-14" />
          </div>
          <div>
            <label className={LABEL} htmlFor="eff">Effective from</label>
            <input id="eff" type="datetime-local" className={FIELD} value={effective} onChange={(e) => setEffective(e.target.value)} />
          </div>
          <Button variant="secondary" size="sm" disabled={!dirty} onClick={() => setDraft(JSON.parse(JSON.stringify(view.settings)))}>Discard</Button>
          <Button variant="primary" size="sm" disabled={!dirty || reason.trim().length < 5 || saving} onClick={save}>
            <Save size={12} /> {saving ? 'Saving…' : 'Save new version'}
          </Button>
          {problems.length > 0 && (
            <ul className="w-full text-[10.5px] text-negative" role="alert">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------- accountability tab */

function AccountabilityTab({ orgId }: { orgId: string }) {
  const toast = useConsoleUi((s) => s.toast);
  const [acc, setAcc] = useState<Accountability | null>(null);
  const [reg, setReg] = useState<OwnerRegister | null>(null);
  const [official, setOfficial] = useState('');
  const [board, setBoard] = useState<Accountability['governance_board']>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [a, r] = await Promise.all([
        api<Accountability>(`/organizations/${orgId}/accountability`),
        api<OwnerRegister>(`/organizations/${orgId}/owner-register`),
      ]);
      setAcc(a);
      setReg(r);
      setOfficial(a.accountable_official?.user_id ?? '');
      setBoard(a.governance_board);
    } catch {
      setError(true);
    }
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Panel title="Accountability"><PanelError onRetry={load} /></Panel>;
  if (!acc || !reg) return <Skeleton className="h-64 w-full" />;

  const save = async () => {
    try {
      await api(`/organizations/${orgId}/accountability`, {
        method: 'PATCH',
        body: JSON.stringify({ accountable_official_user_id: official || null, governance_board: board, reason }),
      });
      toast('Accountability updated', 'positive');
      setReason('');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'negative');
    }
  };
  const setOwner = async (modelId: string, ownerId: string) => {
    try {
      await api(`/inventory/models/${modelId}/owner`, { method: 'PATCH', body: JSON.stringify({ owner_user_id: ownerId || null }) });
      toast('Owner assigned', 'positive');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not assign owner', 'negative');
    }
  };

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <Panel title="Accountable official and governance board" right={<UserCheck size={13} className="text-accent" />}>
        <div className="space-y-2 p-3">
          <div>
            <label className={LABEL} htmlFor="official">Accountable official (Chief AI Officer)</label>
            <select id="official" className={FIELD} disabled={!acc.can_edit} value={official} onChange={(e) => setOfficial(e.target.value)}>
              <option value="">Not named</option>
              {acc.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name} · {m.email} ({m.role})</option>)}
            </select>
            <p className="mt-1 text-[10px] text-text-tertiary">Signs off HIGH and CRITICAL risk acceptances under the default risk appetite.</p>
          </div>
          <div>
            <div className={LABEL}>Governance board</div>
            {board.map((m, i) => (
              <div key={i} className="mb-1 flex gap-1">
                <input aria-label="Board member name" className={FIELD} disabled={!acc.can_edit} value={m.name}
                  onChange={(e) => setBoard(board.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input aria-label="Board member title" className={FIELD} disabled={!acc.can_edit} value={m.title ?? ''} placeholder="Title"
                  onChange={(e) => setBoard(board.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                {acc.can_edit && <Button variant="ghost" size="xs" onClick={() => setBoard(board.filter((_, j) => j !== i))}>Remove</Button>}
              </div>
            ))}
            {acc.can_edit && <Button variant="secondary" size="xs" onClick={() => setBoard([...board, { name: '', title: '' }])}>Add member</Button>}
          </div>
          {acc.can_edit && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className={LABEL} htmlFor="acc-reason">Reason (required)</label>
                <input id="acc-reason" className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <Button variant="primary" size="sm" disabled={reason.trim().length < 5} onClick={save}>Save</Button>
            </div>
          )}
          {acc.history.length > 0 && (
            <div className="border-t border-border pt-2">
              <div className={LABEL}>History</div>
              {acc.history.slice(0, 6).map((h, i) => (
                <div key={i} className="text-[10px] text-text-secondary">
                  {new Date(h.changed_at).toLocaleString()} · {h.changed_by} · {h.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Owner register" right={<Badge tone={reg.unowned ? 'warning' : 'positive'}>{reg.unowned} without a named owner</Badge>}>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-wider text-text-tertiary">
              <th className="px-3 py-1">Model</th><th>Risk</th><th>Team</th><th className="pr-3">Named owner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {reg.models.map((m) => (
              <tr key={m.model_id}>
                <td className="px-3 py-1 text-text">{m.name}</td>
                <td><Badge tone={m.risk_level === 'HIGH' || m.risk_level === 'CRITICAL' ? 'negative' : 'neutral'}>{m.risk_level}</Badge></td>
                <td className="text-text-secondary">{m.owner_team || '—'}</td>
                <td className="pr-3">
                  <select aria-label={`Owner of ${m.name}`} className={FIELD} disabled={!acc.can_edit}
                    value={m.owner?.user_id ?? ''} onChange={(e) => setOwner(m.model_id, e.target.value)}>
                    <option value="">Unassigned</option>
                    {acc.members.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------- history tab */

function HistoryTab() {
  const [hist, setHist] = useState<HistoryView | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try {
      setHist(await api<HistoryView>('/governance/settings/history'));
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <Panel title="Change history"><PanelError onRetry={load} /></Panel>;
  if (!hist) return <Skeleton className="h-64 w-full" />;
  return (
    <Panel title="Settings change history" right={<History size={13} className="text-text-tertiary" />}>
      {hist.versions.length === 0 ? (
        <p className="p-3 text-[11px] text-text-secondary">No changes yet: the organisation is on the default settings.</p>
      ) : (
        <ol className="divide-y divide-border">
          {hist.versions.map((v) => (
            <li key={v.version} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Badge tone="accent">v{v.version}</Badge>
                <span className="text-text">{v.reason}</span>
                <span className="ml-auto font-mono text-[9.5px] text-text-tertiary">
                  {v.changed_by} ({v.changed_by_role}) · effective {new Date(v.effective_from).toLocaleString()}
                </span>
              </div>
              <ChangeList changes={v.changes} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- page */

type Tab = { id: string; label: string; flag: string };
const TABS: Tab[] = [
  { id: 'risks', label: 'Risk register', flag: 'riskRegister' },
  { id: 'impact', label: 'Impact assessments', flag: 'impactAssessment' },
  { id: 'context', label: 'Context profiles', flag: 'contextProfile' },
  { id: 'aims', label: 'AIMS workspace', flag: 'aims' },
  { id: 'actions', label: 'Corrective actions', flag: 'correctiveActions' },
  { id: 'documents', label: 'Documents', flag: 'documentControl' },
  { id: 'settings', label: 'Settings & risk appetite', flag: 'governanceSettings' },
  { id: 'accountability', label: 'Accountability', flag: 'accountability' },
  { id: 'history', label: 'Change history', flag: 'governanceSettings' },
  { id: 'au', label: 'Australia (DTA)', flag: 'auPack' },
  { id: 'decisions', label: 'Decisions & appeals', flag: 'usKit' },
  { id: 'validation', label: 'Model validation', flag: 'modelValidation' },
  { id: 'fairLending', label: 'Fair lending', flag: 'fairLending' },
  { id: 'vendors', label: 'Vendors & AI BOM', flag: 'vendors' },
  { id: 'training', label: 'Training', flag: 'training' },
  { id: 'datasets', label: 'Data register', flag: 'dataRegister' },
  { id: 'assurance', label: 'Red team & audit', flag: 'redTeamAuditRules' },
  { id: 'soa', label: 'Statement of Applicability', flag: 'soa' },
  { id: 'disclosures', label: 'Disclosures', flag: 'disclosures' },
  { id: 'incidentExt', label: 'Incident sign-off & ITSM', flag: 'incidentExtensions' },
  { id: 'tevv', label: 'TEVV & retirement', flag: 'tevv' },
  { id: 'energy', label: 'Energy', flag: 'energy' },
  { id: 'security', label: 'AI security', flag: 'aiSecurity' },
  { id: 'engagement', label: 'Engagement records', flag: 'orgRecords' },
  { id: 'federal', label: 'External AI & export', flag: 'federalVendor' },
];

export function Governance() {
  const features = useGovernanceFeatures((s) => s.features);
  const load = useGovernanceFeatures((s) => s.load);
  const user = useSession((s) => s.user);
  const activeProjectId = useSession((s) => s.activeProjectId);
  const activeOrgId = useSession((s) => s.activeOrgId);
  const setActiveOrg = useSession((s) => s.setActiveOrg);
  const [tab, setTab] = useState('');
  const [scopeOrgName, setScopeOrgName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    void load();
  }, [load]);

  // A global OWNER/ADMIN (no organization of their own) works in the
  // organization of the selected project scope.
  const isGlobal = !user?.tenant_id && (user?.role === 'ADMIN' || user?.role === 'OWNER');
  useEffect(() => {
    if (!isGlobal || !activeProjectId) {
      setScopeOrgName(null);
      return;
    }
    let cancelled = false;
    setResolving(true);
    api<{ tenant_id?: string | null; tenant_name?: string | null }>(`/projects/${activeProjectId}`)
      .then((p) => {
        if (cancelled) return;
        if ((p.tenant_id ?? null) !== activeOrgId) setActiveOrg(p.tenant_id ?? null);
        setScopeOrgName(p.tenant_name ?? null);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setResolving(false));
    return () => {
      cancelled = true;
    };
  }, [isGlobal, activeProjectId, activeOrgId, setActiveOrg]);

  const tabs = TABS.filter((t) => features?.[t.flag]);
  const orgId = user?.tenant_id ?? (isGlobal && activeProjectId ? activeOrgId : null);
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? 'settings';

  return (
    <AppShell title="Governance">
      {isGlobal && orgId && (
        <div className="shrink-0 border-b border-border bg-accent-soft px-3 py-1 text-[10.5px] text-accent">
          Working in {scopeOrgName ?? 'the scoped organization'}'s governance, from the selected project scope.
        </div>
      )}
      <div className="flex min-w-0 shrink-0 flex-wrap gap-x-1 border-b border-border px-2 pt-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-t px-3 py-1.5 text-[11px] ${active === t.id ? 'border border-b-0 border-border bg-surface text-text' : 'text-text-secondary hover:text-text'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <main key={orgId ?? 'none'} className="min-h-0 flex-1 overflow-y-auto p-2">
        {!features || resolving ? (
          <Skeleton className="h-64 w-full" />
        ) : !features.governanceSettings ? (
          <Panel title="Governance"><p className="p-3 text-[11px] text-text-secondary">Governance settings are not switched on for this deployment.</p></Panel>
        ) : !orgId ? (
          <Panel title="Governance">
            <div className="space-y-2 p-3 text-[11px] text-text-secondary">
              <p>Governance is kept per organization.</p>
              {isGlobal && activeProjectId ? (
                <p>The selected project is not in an organization. Assign it to one, or pick a project that belongs to one on the <a href="#/projects" className="text-accent underline">Projects</a> page.</p>
              ) : isGlobal ? (
                <p>
                  Your account works across organizations. Pick a project on the <a href="#/projects" className="text-accent underline">Projects</a> page to set the scope, and governance opens for that project's organization.
                </p>
              ) : (user?.role === 'ADMIN' || user?.role === 'OWNER') ? (
                <p>
                  Open <a href="#/users" className="text-accent underline">Users</a>, choose Edit on your account (or another user), pick the organization, then sign out and back in.
                </p>
              ) : (
                <p>Ask an administrator to assign your account to an organization.</p>
              )}
            </div>
          </Panel>
        ) : active === 'risks' ? (
          <RiskRegisterTab />
        ) : active === 'impact' ? (
          <ImpactTab />
        ) : active === 'context' ? (
          <ContextTab />
        ) : active === 'aims' ? (
          <AimsTab />
        ) : active === 'actions' ? (
          <ActionsTab />
        ) : active === 'documents' ? (
          <DocumentsTab />
        ) : active === 'settings' ? (
          <SettingsTab />
        ) : active === 'accountability' ? (
          <AccountabilityTab orgId={orgId} />
        ) : active === 'au' ? (
          <AuDtaTab />
        ) : active === 'decisions' ? (
          <DecisionsTab />
        ) : active === 'validation' ? (
          <ValidationTab />
        ) : active === 'fairLending' ? (
          <FairLendingTab />
        ) : active === 'vendors' ? (
          <VendorsTab />
        ) : active === 'training' ? (
          <TrainingTab />
        ) : active === 'datasets' ? (
          <DatasetsTab />
        ) : active === 'assurance' ? (
          <AssuranceTab />
        ) : active === 'soa' ? (
          <SoaTab />
        ) : active === 'disclosures' ? (
          <DisclosuresTab />
        ) : active === 'incidentExt' ? (
          <IncidentsExtTab />
        ) : active === 'tevv' ? (
          <TevvTab />
        ) : active === 'energy' ? (
          <EnergyTab />
        ) : active === 'security' ? (
          <SecurityTab />
        ) : active === 'engagement' ? (
          <EngagementTab />
        ) : active === 'federal' ? (
          <FederalTab />
        ) : (
          <HistoryTab />
        )}
      </main>
    </AppShell>
  );
}
