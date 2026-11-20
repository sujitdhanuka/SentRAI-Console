import { GitCommitHorizontal, RefreshCw, ShieldOff, Terminal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { CiSetupModal } from '../components/console/CiSetupModal';
import { GateEventDetail } from '../components/console/GateEventDetail';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';
import { useSession } from '../stores/session';

export interface GateGap {
  model_name: string;
  severity: string;
  file_location: string;
  missing: string[];
  reason: string;
  shadow: boolean;
  evidence?: Array<{ line: number; snippet: string; category: string }>;
}

export interface GateEvent {
  gate_event_id: string;
  project_id: string;
  project_name: string | null;
  commit_sha: string | null;
  pr_number: string | null;
  pipeline_run_id: string | null;
  /** The ORIGINAL pipeline decision — never rewritten. */
  verdict: 'pass' | 'fail';
  /** What the gate means today (an override makes a failed gate effectively pass). */
  effective_verdict: 'pass' | 'fail';
  overridden: boolean;
  overridden_by: string | null;
  override_reason: string | null;
  overridden_at: string | null;
  models_detected: number;
  blocking_violations: GateGap[];
  triggered_by: string;
  occurred_at: string;
}

const TH = 'sticky top-0 z-10 border-b border-border bg-surface px-2 py-1.5 text-left text-[9px] font-medium uppercase tracking-widest text-text-tertiary';
const TD = 'px-2 py-1.5 align-middle';

const timeAgo = (iso: string): string => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Verdict badge that never hides an override: a failed gate stays visibly
 *  failed, with the sign-off shown as an additive fact. */
function VerdictBadge({ ev }: { ev: GateEvent }) {
  if (ev.overridden) {
    return (
      <Badge tone="accent" title={`Original verdict: FAIL — signed off by ${ev.overridden_by ?? 'an auditor'}`}>
        overridden
      </Badge>
    );
  }
  return <Badge tone={ev.verdict === 'pass' ? 'positive' : 'negative'}>{ev.verdict}</Badge>;
}

const OVERRIDE_ROLES = ['ADMIN', 'CISO', 'APPROVER'];
const TOKEN_ROLES = ['ADMIN', 'CISO', 'OWNER'];

export function CiLedger() {
  const toast = useConsoleUi((s) => s.toast);
  const role = useSession((s) => s.user?.role ?? 'VIEWER');
  const activeProjectId = useSession((s) => s.activeProjectId);
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [filter, setFilter] = useState<'all' | 'pass' | 'fail'>('all');
  const [selected, setSelected] = useState<GateEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('verdict', filter);
      if (activeProjectId) params.set('project_id', activeProjectId);
      const qs = params.toString();
      const rows = await api<GateEvent[]>(`/ci/events${qs ? `?${qs}` : ''}`);
      setEvents(rows);
      setSelected((prev) => rows.find((r) => r.gate_event_id === prev?.gate_event_id) ?? rows[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load gate ledger');
    } finally {
      setLoading(false);
    }
  }, [filter, activeProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const override = async (ev: GateEvent, reason: string) => {
    try {
      await api(`/ci/events/${ev.gate_event_id}/override`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      toast('Override recorded — the original FAIL verdict is preserved', 'positive');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Override failed', 'negative');
    }
  };

  const blocked = events.filter((e) => e.effective_verdict === 'fail').length;

  return (
    <AppShell
      title="CI Gate Ledger"
      actions={
        <>
          <div className="hidden overflow-hidden rounded-md border border-border md:flex" role="group" aria-label="Verdict filter">
            {(['all', 'fail', 'pass'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`px-2 py-1 font-mono text-[10px] uppercase transition-colors ${
                  filter === f ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:bg-surface-hover'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button onClick={() => void load()} title="Refresh" aria-label="Refresh" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-hover">
            <RefreshCw size={13} />
          </button>
          <Button variant="primary" size="sm" onClick={() => setSetupOpen(true)} icon={<Terminal size={13} />}>
            Set up CI
          </Button>
        </>
      }
    >
      <div className="grid shrink-0 grid-cols-3 gap-px border-b border-border bg-border">
        <div className="bg-surface px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Gate events</div>
          <div className="font-mono text-base leading-tight">{events.length}</div>
          <div className="font-mono text-[8.5px] text-text-tertiary">append-only ledger</div>
        </div>
        <div className="bg-surface px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Blocking now</div>
          <div className={`font-mono text-base leading-tight ${blocked ? 'text-negative' : 'text-positive'}`}>{blocked}</div>
          <div className="font-mono text-[8.5px] text-text-tertiary">failed, not overridden</div>
        </div>
        <div className="bg-surface px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Overridden</div>
          <div className="font-mono text-base leading-tight text-accent">{events.filter((e) => e.overridden).length}</div>
          <div className="font-mono text-[8.5px] text-text-tertiary">auditor sign-offs</div>
        </div>
      </div>

      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2 lg:flex-row">
        <Panel title="Deployment gate events" className="flex-1">
          {error ? (
            <PanelError onRetry={load} />
          ) : loading ? (
            <SkeletonRows rows={8} />
          ) : !events.length ? (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div>
                <ShieldOff size={20} className="mx-auto mb-2 text-text-tertiary" />
                <p className="text-[11px] text-text-secondary">
                  No gate events yet — wire the CI gate into a pipeline to start recording decisions.
                </p>
                <div className="mt-3">
                  <Button variant="primary" size="sm" onClick={() => setSetupOpen(true)} icon={<Terminal size={13} />}>
                    Set up CI scanning
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className={TH}>Verdict</th>
                  <th className={TH}>Commit</th>
                  <th className={TH}>Project</th>
                  <th className={TH}>Models</th>
                  <th className={TH}>Blocking</th>
                  <th className={TH}>When</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const isSel = ev.gate_event_id === selected?.gate_event_id;
                  return (
                    <tr
                      key={ev.gate_event_id}
                      tabIndex={0}
                      onClick={() => setSelected(ev)}
                      onKeyDown={(e) => e.key === 'Enter' && setSelected(ev)}
                      className={`cursor-pointer border-b border-border transition-colors ${isSel ? 'bg-accent-soft' : 'hover:bg-surface-hover'}`}
                    >
                      <td className={`${TD} ${isSel ? 'border-l-2 border-l-accent' : 'border-l-2 border-l-transparent'}`}>
                        <VerdictBadge ev={ev} />
                      </td>
                      <td className={TD}>
                        <span className="flex items-center gap-1 font-mono text-[10px] text-text-secondary">
                          <GitCommitHorizontal size={11} className="text-text-tertiary" />
                          {ev.commit_sha ? ev.commit_sha.slice(0, 7) : '—'}
                        </span>
                        {ev.pr_number && <div className="font-mono text-[8.5px] text-text-tertiary">PR #{ev.pr_number}</div>}
                      </td>
                      <td className={`${TD} text-[10.5px] text-text-secondary`}>{ev.project_name ?? ev.project_id.slice(0, 8)}</td>
                      <td className={`${TD} font-mono text-[10px]`}>{ev.models_detected}</td>
                      <td className={TD}>
                        <span className={`font-mono text-[10px] ${ev.blocking_violations.length ? 'text-negative' : 'text-positive'}`}>
                          {ev.blocking_violations.length}
                        </span>
                      </td>
                      <td className={`${TD} font-mono text-[9.5px] text-text-tertiary`} title={new Date(ev.occurred_at).toLocaleString()}>
                        {timeAgo(ev.occurred_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <div className="flex w-full shrink-0 flex-col lg:w-[380px]">
          <GateEventDetail
            event={selected}
            canOverride={OVERRIDE_ROLES.includes(role)}
            onOverride={override}
          />
        </div>
      </main>

      <CiSetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        canMint={TOKEN_ROLES.includes(role)}
        defaultProjectId={activeProjectId}
      />
    </AppShell>
  );
}
