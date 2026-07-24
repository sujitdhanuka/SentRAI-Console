import { FileDown, ShieldAlert, ShieldCheck, PenLine } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api, apiBlobUrl } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Panel, PanelError } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';
import { useSession } from '../stores/session';

interface PortfolioReport {
  generated_at: string;
  scope: { project_id: string | null; model_count: number };
  summary: {
    total_models: number;
    fully_compliant: number;
    compliance_rate: number;
    high_risk_models: number;
    open_blocking_gaps: number;
    headline: string;
  };
  risk_tiers: Record<string, number>;
  frameworks: Array<{
    id: string; name: string; models_assessed: number; models_passing: number;
    pass_rate: number; open_gaps: number; readiness: string;
  }>;
  top_gaps: Array<{ framework: string; control: string; count: number; statement: string }>;
  ci_gate: {
    events_recorded: number;
    gate_readiness_score: number | null;
    active_blocked_gates: number;
    shadow_ai_assets: number;
  };
}

/** The backend's `readiness` is a full sentence; the chip needs a short label,
 *  so derive it from the pass rate and keep the sentence as body copy. */
const readinessChip = (passRate: number): { label: string; tone: BadgeTone } => {
  if (passRate >= 1) return { label: 'ready', tone: 'positive' };
  if (passRate >= 0.5) return { label: 'partial', tone: 'warning' };
  return { label: 'not ready', tone: 'negative' };
};

const TIER_TONE: Record<string, BadgeTone> = {
  LOW: 'positive', MINIMAL: 'positive', MEDIUM: 'warning', LIMITED: 'warning',
  HIGH: 'negative', CRITICAL: 'negative', PROHIBITED: 'negative',
};

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">{label}</div>
      <div className={`font-mono text-base leading-tight ${tone ?? 'text-text'}`}>{value}</div>
      <div className="font-mono text-[8.5px] text-text-tertiary">{sub}</div>
    </div>
  );
}

export function ComplianceRollup() {
  const toast = useConsoleUi((s) => s.toast);
  const activeProjectId = useSession((s) => s.activeProjectId);
  const [report, setReport] = useState<PortfolioReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<{ narrative: string; narrative_source: string } | null>(null);
  const [drafting, setDrafting] = useState(false);

  const draftNarrative = async () => {
    setDrafting(true);
    try {
      const qs = activeProjectId ? `?project_id=${encodeURIComponent(activeProjectId)}` : '';
      const res = await api<{ narrative: string; narrative_source: string; ai_enabled: boolean }>(
        `/compliance/exec-narrative${qs}`,
        { method: 'POST' },
      );
      setNarrative(res);
      toast(res.ai_enabled ? 'Narrative drafted by AI' : 'Narrative drafted locally', 'positive');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not draft narrative', 'negative');
    } finally {
      setDrafting(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = activeProjectId ? `?project_id=${encodeURIComponent(activeProjectId)}` : '';
      setReport(await api<PortfolioReport>(`/compliance/portfolio${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rollup');
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportPdf = async () => {
    try {
      const qs = activeProjectId ? `?project_id=${encodeURIComponent(activeProjectId)}` : '';
      window.open(await apiBlobUrl(`/compliance/portfolio/export-pdf${qs}`), '_blank');
      toast('Readiness report generated', 'positive');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'PDF export failed', 'negative');
    }
  };

  const s = report?.summary;
  const ci = report?.ci_gate;

  return (
    <AppShell
      title="Compliance Rollup"
      actions={
        <>
          <a
            href="/coverage"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:bg-surface-hover"
            title="What each framework verdict actually covers"
          >
            Coverage disclosure
          </a>
          <button
            onClick={exportPdf}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:bg-surface-hover"
          >
            <FileDown size={13} /> Readiness PDF
          </button>
        </>
      }
    >
      {loading ? (
        <div className="grid shrink-0 grid-cols-3 gap-px border-b border-border bg-border lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="bg-surface p-2.5"><Skeleton className="mb-1.5 h-2.5 w-16" /><Skeleton className="h-4 w-12" /></div>
          ))}
        </div>
      ) : s ? (
        <div className="grid shrink-0 grid-cols-3 gap-px border-b border-border bg-border lg:grid-cols-5">
          <Stat label="Models in scope" value={String(s.total_models)} sub={activeProjectId ? 'active project' : 'all projects'} />
          <Stat label="Fully compliant" value={`${Math.round(s.compliance_rate * 100)}%`} sub={`${s.fully_compliant}/${s.total_models} across 4 frameworks`} tone={s.compliance_rate >= 1 ? 'text-positive' : s.compliance_rate > 0 ? 'text-warning' : 'text-negative'} />
          <Stat label="Open blocking gaps" value={String(s.open_blocking_gaps)} sub="must close before sign-off" tone={s.open_blocking_gaps > 0 ? 'text-negative' : 'text-positive'} />
          <Stat label="High-risk models" value={String(s.high_risk_models)} sub="HIGH / CRITICAL tier" tone={s.high_risk_models > 0 ? 'text-warning' : 'text-positive'} />
          <Stat label="Blocked gates" value={String(ci?.active_blocked_gates ?? 0)} sub={`${ci?.shadow_ai_assets ?? 0} shadow AI asset(s)`} tone={(ci?.active_blocked_gates ?? 0) > 0 ? 'text-negative' : 'text-positive'} />
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-y-auto p-2">
        {error ? (
          <Panel title="Portfolio"><PanelError onRetry={load} /></Panel>
        ) : loading ? (
          <div className="grid gap-2 lg:grid-cols-2"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>
        ) : report ? (
          <div className="flex flex-col gap-2">
            <div className="rounded-md border border-border bg-surface px-3 py-2.5">
              <div className="mb-1 flex items-center gap-2">
                {s!.compliance_rate >= 1 ? <ShieldCheck size={14} className="text-positive" /> : <ShieldAlert size={14} className="text-warning" />}
                <h2 className="font-heading text-[11px] font-medium uppercase tracking-wider text-text-secondary">Executive summary</h2>
                <span className="ml-auto font-mono text-[9px] text-text-tertiary">
                  generated {new Date(report.generated_at).toLocaleString()}
                </span>
              </div>
              <p className="text-[12px] leading-relaxed text-text">{s!.headline}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(report.risk_tiers).map(([tier, n]) => (
                  <Badge key={tier} tone={TIER_TONE[tier] ?? 'neutral'}>{tier} · {n}</Badge>
                ))}
              </div>

              {/* The board-facing paragraph: longer-form prose drafted from the
                  same numbers shown above, so the two can be checked against
                  each other before it leaves the building. */}
              <div className="mt-3 border-t border-border pt-2">
                <div className="mb-1 flex items-center gap-1.5">
                  <PenLine size={11} className="text-accent" />
                  <span className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">
                    Board narrative
                  </span>
                  {narrative && (
                    <Badge tone={narrative.narrative_source === 'ai' ? 'accent' : 'warning'}>
                      {narrative.narrative_source === 'ai' ? 'AI draft' : 'auto draft'}
                    </Badge>
                  )}
                  <button
                    onClick={draftNarrative}
                    disabled={drafting}
                    className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                  >
                    <PenLine size={9} /> {drafting ? 'Drafting…' : narrative ? 'Re-draft' : 'Draft narrative'}
                  </button>
                </div>
                {narrative ? (
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-text-secondary">
                    {narrative.narrative}
                  </p>
                ) : (
                  <p className="text-[10.5px] italic text-text-tertiary">
                    Not drafted yet — generates a board-ready paragraph from the figures above.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-2 lg:grid-cols-2">
              <Panel title="Framework readiness">
                <div className="divide-y divide-border">
                  {report.frameworks.map((f) => (
                    <div key={f.id} className="px-3 py-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[11.5px] font-medium text-text">{f.name}</span>
                        <Badge tone={readinessChip(f.pass_rate).tone}>{readinessChip(f.pass_rate).label}</Badge>
                      </div>
                      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] text-text-secondary">
                        <span>{f.models_passing}/{f.models_assessed} passing</span>
                        <span className="text-text-tertiary">·</span>
                        <span className={f.open_gaps > 0 ? 'text-negative' : 'text-positive'}>{f.open_gaps} gap(s)</span>
                        <span className="ml-auto tabular-nums">{Math.round(f.pass_rate * 100)}%</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-surface-hover">
                        <div
                          className={`h-full ${f.pass_rate >= 1 ? 'bg-positive' : f.pass_rate > 0 ? 'bg-warning' : 'bg-negative'}`}
                          style={{ width: `${Math.max(2, Math.round(f.pass_rate * 100))}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{f.readiness}</p>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel
                title="Most common gaps"
                right={<Badge tone={report.top_gaps.length ? 'negative' : 'positive'}>{report.top_gaps.length}</Badge>}
              >
                {report.top_gaps.length ? (
                  <ol className="divide-y divide-border">
                    {report.top_gaps.map((g, i) => (
                      <li key={`${g.framework}-${g.control}-${i}`} className="px-3 py-2">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="font-mono text-[8.5px] uppercase tracking-wider text-text-tertiary">{g.framework}</span>
                          <span className="font-mono text-[8.5px] text-accent">{g.control}</span>
                          <Badge tone="negative">{g.count} model(s)</Badge>
                        </div>
                        <p className="text-[11px] leading-relaxed text-text-secondary">{g.statement}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="p-3 text-[11px] text-text-secondary">No blocking gaps across the portfolio. 🎉</p>
                )}
              </Panel>
            </div>

            <Panel title="Pre-deployment gate (shift-left)">
              <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-4">
                <Stat label="Gate events" value={String(ci!.events_recorded)} sub="recorded in the ledger" />
                <Stat
                  label="Gate readiness"
                  value={ci!.gate_readiness_score == null ? '—' : `${Math.round(ci!.gate_readiness_score * 100)}%`}
                  sub="effective pass ratio"
                  tone={ci!.gate_readiness_score == null ? undefined : ci!.gate_readiness_score >= 0.9 ? 'text-positive' : 'text-warning'}
                />
                <Stat label="Active blocks" value={String(ci!.active_blocked_gates)} sub="failed, not overridden" tone={ci!.active_blocked_gates > 0 ? 'text-negative' : 'text-positive'} />
                <Stat label="Shadow AI" value={String(ci!.shadow_ai_assets)} sub="ungoverned assets blocked" tone={ci!.shadow_ai_assets > 0 ? 'text-negative' : 'text-positive'} />
              </div>
            </Panel>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
