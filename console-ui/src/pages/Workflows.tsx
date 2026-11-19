import { ArrowRight, Check, ChevronDown, ChevronRight, Globe2, Lock, RefreshCw, RotateCcw, TriangleAlert, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Panel, PanelError } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';
import { navigate, Route, routeParam } from '../stores/route';
import { useSession } from '../stores/session';

/**
 * Workflows (User Guide Part B, W0 to W12) as a checklist. Each step opens the
 * real form, and is done only when the records and the framework-pack checks
 * behind the compliance check, the deploy gate and the readiness report say so.
 */

type StepStatus = 'done' | 'in_progress' | 'todo' | 'blocked' | 'overdue' | 'shortcut' | 'action' | 'system';
interface StepLink { route: string; query?: Record<string, string> }
interface Step {
  id: string; step: string; title: string; who: string; where: string; why: string; done_when: string | null;
  status: StepStatus; counted: boolean; detail: string | null; gaps: string[]; controls: string[];
  waiting_on: Array<{ id: string; step: string; title: string; scope: 'org' | 'model' }>;
  recurring: boolean; last_done_at: string | null; next_due_at: string | null; packs: string[]; link: StepLink; from_stage?: string;
}
interface Stage {
  id: string; workflow: string; title: string; summary: string; phase: string; optional: boolean; lens: boolean;
  done: number; total: number; status: 'complete' | 'in_progress' | 'blocked' | 'overdue' | 'not_started' | 'nothing_open' | 'optional'; steps: Step[];
}
interface Jurisdiction {
  settings_available: boolean; primary: string | null; enabled_packs: string[]; version: number; is_default: boolean; can_edit: boolean;
  packs_in_force: string[]; catalog: Array<{ pack_id: string; name: string; baseline: boolean; region: string | null }>; jurisdictions: string[];
}
interface Blocker { message: string; step_id: string; scope: 'org' | 'model' }
interface WorkflowView {
  org_id: string | null; evaluated_at: string; jurisdiction: Jurisdiction | null; stages: Stage[]; done: number; total: number;
  blockers: Blocker[]; org_blockers?: Blocker[];
  next: { step_id: string; scope: 'org' | 'model'; step: string; title: string; who: string; reason: string; unblocks: number; link: StepLink } | null;
  model?: { id: string; name: string; risk_level: string; lifecycle_stage: string; model_type: string };
}
interface ModelRow { model_id: string; name: string; risk_level: string; lifecycle_stage: string; done: number; total: number; blockers: number; next: { step: string; title: string } | null }

/** Set while the user is on a form opened from a workflow step; AppShell shows "Back to workflow". */
export const WORKFLOW_BACK_KEY = 'sentrai_workflow_back';

const JURISDICTION_CHOICES: Array<{ id: string; label: string; packs: string[]; note: string }> = [
  { id: 'IN', label: 'India', packs: ['rbi-free-ai'], note: 'RBI FREE-AI: the 7 Sutras, board policy, grievance redress' },
  { id: 'EU', label: 'European Union', packs: ['eu-ai-act'], note: 'EU AI Act: risk classes, FRIA, logging, human oversight' },
  { id: 'AU', label: 'Australia', packs: ['au-dta'], note: 'DTA policy: use-case register, accountable official, DTA reporting' },
  { id: 'US', label: 'United States', packs: ['us-2026'], note: 'OMB memo, Colorado AI Act, adverse-action notices' },
  { id: 'INTL', label: 'Global only', packs: [], note: 'NIST AI RMF and ISO/IEC 42001 only, no regional pack' },
];
const JUR_LABEL: Record<string, string> = Object.fromEntries(JURISDICTION_CHOICES.map((j) => [j.id, j.label]));

const STATUS: Record<StepStatus, { label: string; tone: BadgeTone }> = {
  done: { label: 'Done', tone: 'positive' },
  in_progress: { label: 'In progress', tone: 'accent' },
  todo: { label: 'To do', tone: 'neutral' },
  blocked: { label: 'Blocked', tone: 'negative' },
  overdue: { label: 'Due again', tone: 'negative' },
  shortcut: { label: 'View', tone: 'neutral' },
  action: { label: 'Start', tone: 'neutral' },
  system: { label: 'Automatic', tone: 'neutral' },
};
const STAGE_STATUS: Record<Stage['status'], { label: string; tone: BadgeTone }> = {
  complete: { label: 'Complete', tone: 'positive' },
  in_progress: { label: 'In progress', tone: 'accent' },
  blocked: { label: 'Blocked', tone: 'negative' },
  overdue: { label: 'Review due', tone: 'negative' },
  not_started: { label: 'Not started', tone: 'neutral' },
  nothing_open: { label: 'Nothing open', tone: 'neutral' },
  optional: { label: 'Optional', tone: 'neutral' },
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

function Dot({ status }: { status: StepStatus }) {
  const base = 'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]';
  if (status === 'done') return <span className={`${base} border-positive bg-positive text-white`}><Check size={11} strokeWidth={3} /></span>;
  if (status === 'in_progress') return <span className={`${base} border-accent`}><span className="h-2 w-2 rounded-full bg-accent" /></span>;
  if (status === 'blocked') return <span className={`${base} border-negative text-negative`}><Lock size={9} strokeWidth={2.5} /></span>;
  if (status === 'overdue') return <span className={`${base} border-negative bg-negative text-white`}><RotateCcw size={9} strokeWidth={3} /></span>;
  if (status === 'shortcut' || status === 'action' || status === 'system') return <span className={`${base} border-dashed border-border-strong`} />;
  return <span className={`${base} border-border-strong`} />;
}

function Bar({ done, total, tone = 'accent' }: { done: number; total: number; tone?: 'accent' | 'positive' }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone === 'positive' || pct === 100 ? 'bg-positive' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Open the real form for a step, remembering how to come back. */
function openStep(link: StepLink, step: { id: string; step: string; title: string }, back: Record<string, string>) {
  try {
    sessionStorage.setItem(WORKFLOW_BACK_KEY, JSON.stringify({ query: { ...back, step: step.id }, label: `${step.step} ${step.title}` }));
  } catch { /* storage blocked: the rail still gets back */ }
  navigate(link.route as Route, link.query);
}

export function Workflows() {
  const toast = useConsoleUi((s) => s.toast);
  const user = useSession((s) => s.user);
  const activeProjectId = useSession((s) => s.activeProjectId);
  const activeOrgId = useSession((s) => s.activeOrgId);
  const setActiveOrg = useSession((s) => s.setActiveOrg);
  const isGlobal = !user?.tenant_id && (user?.role === 'ADMIN' || user?.role === 'OWNER');
  const orgId = user?.tenant_id ?? (isGlobal && activeProjectId ? activeOrgId : null);

  const [scope, setScope] = useState<'org' | 'model'>(() => (routeParam('scope') === 'model' ? 'model' : 'org'));
  const [modelId, setModelId] = useState<string>(() => routeParam('model') ?? '');
  const [focusStep, setFocusStep] = useState<string | null>(() => routeParam('step'));
  const [models, setModels] = useState<ModelRow[] | null>(null);
  const [view, setView] = useState<WorkflowView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [jurOpen, setJurOpen] = useState(false);

  // A global OWNER / ADMIN works in the organization of the selected project scope.
  useEffect(() => {
    if (!isGlobal || !activeProjectId) return;
    let cancelled = false;
    api<{ tenant_id?: string | null }>(`/projects/${activeProjectId}`)
      .then((p) => { if (!cancelled && (p.tenant_id ?? null) !== activeOrgId) setActiveOrg(p.tenant_id ?? null); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [isGlobal, activeProjectId, activeOrgId, setActiveOrg]);

  // Keep the choice in the URL so a step's "Back to workflow" returns here.
  useEffect(() => {
    const q = new URLSearchParams({ scope, ...(scope === 'model' && modelId ? { model: modelId } : {}) });
    window.history.replaceState(null, '', `#/workflows?${q.toString()}`);
  }, [scope, modelId]);

  const loadModels = useCallback(() => {
    if (!orgId) return;
    api<{ models: ModelRow[] }>('/governance/workflows/models')
      .then((r) => {
        setModels(r.models);
        setModelId((cur) => (cur && r.models.some((m) => m.model_id === cur) ? cur : r.models[0]?.model_id ?? ''));
      })
      .catch(() => setModels([]));
  }, [orgId]);

  const load = useCallback(() => {
    if (!orgId) { setLoading(false); return; }
    if (scope === 'model' && !modelId) { setView(null); setLoading(false); return; }
    setLoading(true);
    setError(false);
    api<WorkflowView>(scope === 'org' ? '/governance/workflows/org' : `/governance/workflows/models/${encodeURIComponent(modelId)}`)
      .then(setView)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [orgId, scope, modelId]);

  useEffect(loadModels, [loadModels, activeProjectId]);
  useEffect(load, [load, activeProjectId]);

  // Open the stage holding the step we came back to, else the one with the next best action.
  useEffect(() => {
    if (!view) return;
    const target = focusStep ?? view.next?.step_id ?? null;
    const st = target ? view.stages.find((s) => s.steps.some((x) => x.id === target && !x.from_stage)) : null;
    setOpen(new Set(st ? [st.id] : []));
    setExpanded(focusStep);
    if (focusStep) {
      setTimeout(() => document.getElementById(`wf-step-${focusStep}`)?.scrollIntoView({ block: 'center' }), 50);
      setFocusStep(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // First run: an Owner or CISO is asked for the jurisdiction until settings are saved.
  const jur = view?.jurisdiction ?? null;
  const dismissKey = `sentrai_wf_jurisdiction_asked_${orgId ?? ''}`;
  useEffect(() => {
    if (!jur?.settings_available || !jur.is_default || !jur.can_edit) return;
    let asked = false;
    try { asked = localStorage.getItem(dismissKey) === '1'; } catch { /* ignore */ }
    if (!asked) setJurOpen(true);
  }, [jur?.settings_available, jur?.is_default, jur?.can_edit, dismissKey]);
  const closeJur = () => {
    try { localStorage.setItem(dismissKey, '1'); } catch { /* ignore */ }
    setJurOpen(false);
  };

  const back = { scope, ...(scope === 'model' && modelId ? { model: modelId } : {}) };
  const go = (link: StepLink, s: { id: string; step: string; title: string }) => openStep(link, s, back);
  const jumpTo = (stepId: string, sc: 'org' | 'model') => {
    if (sc !== scope) { setScope(sc); setFocusStep(stepId); return; }
    const st = view?.stages.find((s) => s.steps.some((x) => x.id === stepId && !x.from_stage));
    if (st) setOpen((o) => new Set([...o, st.id]));
    setExpanded(stepId);
    setTimeout(() => document.getElementById(`wf-step-${stepId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  };

  const phases = useMemo(() => {
    const out: Array<{ phase: string; stages: Stage[] }> = [];
    for (const s of view?.stages ?? []) {
      const last = out[out.length - 1];
      if (last && last.phase === s.phase) last.stages.push(s);
      else out.push({ phase: s.phase, stages: [s] });
    }
    return out;
  }, [view]);

  const blockers = [...(view?.org_blockers ?? []), ...(view?.blockers ?? [])];
  const current = models?.find((m) => m.model_id === modelId);

  return (
    <AppShell
      title="Workflows"
      actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={11} />} onClick={() => { load(); loadModels(); }}>Refresh</Button>}
    >
      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5">
        <div className="mx-auto max-w-[1100px] space-y-3">
          {!orgId ? (
            <Panel title="Workflows">
              <div className="space-y-2 p-3 text-[11.5px] text-text-secondary">
                <p>Workflows are kept per organization.</p>
                {isGlobal ? (
                  <p>Your account works across organizations. Pick a project on the <a href="#/projects" className="text-accent underline">Projects</a> page to set the scope, and the workflow opens for that project's organization.</p>
                ) : (
                  <p>Ask an administrator to assign your account to an organization.</p>
                )}
              </div>
            </Panel>
          ) : (
            <>
              {/* Toolbar: scope, model, jurisdiction */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex overflow-hidden rounded-md border border-border-strong" role="tablist" aria-label="Workflow scope">
                  {(['org', 'model'] as const).map((s) => (
                    <button
                      key={s}
                      role="tab"
                      aria-selected={scope === s}
                      onClick={() => { setScope(s); setFocusStep(null); }}
                      className={`px-3 py-1.5 text-[11px] ${scope === s ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-hover'}`}
                    >
                      {s === 'org' ? 'Organisation' : 'Per model'}
                    </button>
                  ))}
                </div>
                {scope === 'model' && (
                  <select
                    aria-label="Model"
                    value={modelId}
                    onChange={(e) => { setModelId(e.target.value); setFocusStep(null); }}
                    className="h-[30px] min-w-0 max-w-full rounded-md border border-border-strong bg-surface px-2 text-[11.5px] text-text sm:w-auto"
                  >
                    {!models?.length && <option value="">{models ? 'No models in scope' : 'Loading models…'}</option>}
                    {models?.map((m) => (
                      <option key={m.model_id} value={m.model_id}>
                        {m.name} · {m.risk_level} · {m.done}/{m.total}{m.blockers ? ` · ${m.blockers} blocker${m.blockers === 1 ? '' : 's'}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                {jur && (
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <span className="flex items-center gap-1 text-[10.5px] text-text-tertiary"><Globe2 size={12} /> Jurisdiction</span>
                    <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text">
                      {jur.settings_available ? (jur.is_default ? 'Not chosen' : JUR_LABEL[jur.primary ?? ''] ?? jur.primary) : 'All frameworks'}
                    </span>
                    {jur.packs_in_force.map((p) => (
                      <Badge key={p} tone={jur.catalog.find((c) => c.pack_id === p)?.baseline ? 'neutral' : 'accent'} title={jur.catalog.find((c) => c.pack_id === p)?.name}>{p}</Badge>
                    ))}
                    {jur.settings_available && (jur.can_edit ? (
                      <Button size="xs" variant="secondary" onClick={() => setJurOpen(true)}>Change</Button>
                    ) : (
                      <Button size="xs" variant="ghost" onClick={() => navigate('governance', { tab: 'settings' })}>View settings</Button>
                    ))}
                  </div>
                )}
              </div>

              {jur?.settings_available && jur.is_default && !jur.can_edit && (
                <div className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-[11.5px] text-text">
                  The jurisdiction has not been chosen, so only the NIST and ISO baseline applies. Ask your Owner or CISO to choose it in Governance › Setup.
                </div>
              )}

              {loading && !view ? (
                <Skeleton className="h-72 w-full" />
              ) : error ? (
                <Panel title="Workflows"><PanelError onRetry={load} /></Panel>
              ) : scope === 'model' && !modelId ? (
                <Panel title="Per model">
                  <p className="p-3 text-[11.5px] text-text-secondary">No models in this scope yet. Start with W1 in the Organisation view: create a project, attach code and import what the scan finds.</p>
                </Panel>
              ) : view ? (
                <>
                  {/* Summary */}
                  <section className="rounded-md border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="font-heading text-[14px] font-semibold text-text">
                        {scope === 'org' ? 'Organisation workflow' : view.model?.name ?? current?.name}
                      </h2>
                      {view.model && <span className="font-mono text-[10px] text-text-tertiary">{view.model.risk_level} · {view.model.lifecycle_stage} · {view.model.model_type}</span>}
                      <span className="ml-auto font-mono text-[11px] text-text-secondary">{view.done} of {view.total} steps done</span>
                    </div>
                    <div className="mt-2"><Bar done={view.done} total={view.total} /></div>
                    <p className="mt-2 text-[10.5px] text-text-tertiary">
                      {scope === 'org' ? 'Set-up, project onboarding, periodic review and disclosure for the whole organisation.' : 'Every stage of this model, from onboarding to retirement.'}{' '}
                      A step is done only when the records and the framework checks behind it pass. Nothing here is ticked by hand.
                    </p>
                  </section>

                  {/* Next best action */}
                  {view.next ? (
                    <section className="flex flex-wrap items-center gap-3 rounded-md border border-accent bg-accent-soft px-3 py-2.5">
                      <Zap size={16} className="shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[9.5px] uppercase tracking-wider text-accent">Next best action</div>
                        <div className="text-[12.5px] font-medium text-text">
                          <span className="mr-1.5 font-mono text-[10.5px] text-text-tertiary">{view.next.step}</span>{view.next.title}
                        </div>
                        <div className="text-[10.5px] text-text-secondary">
                          {view.next.who} · {view.next.reason}{view.next.unblocks ? ` Unblocks ${view.next.unblocks} more step${view.next.unblocks === 1 ? '' : 's'}.` : ''}
                        </div>
                      </div>
                      <Button variant="primary" size="sm" icon={<ArrowRight size={12} />} onClick={() => go(view.next!.link, { id: view.next!.step_id, step: view.next!.step, title: view.next!.title })}>
                        Open
                      </Button>
                    </section>
                  ) : view.total > 0 && view.done === view.total ? (
                    <section className="flex items-center gap-2 rounded-md border border-positive bg-positive-soft px-3 py-2.5 text-[12px] text-text">
                      <Check size={15} className="text-positive" /> Every step in this workflow is complete. Recurring steps come back here when they fall due.
                    </section>
                  ) : null}

                  {/* Blockers */}
                  {blockers.length > 0 && (
                    <section className="rounded-md border border-negative bg-negative-soft px-3 py-2">
                      <div className="mb-1 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider text-negative">
                        <TriangleAlert size={12} /> {blockers.length} blocker{blockers.length === 1 ? '' : 's'}
                      </div>
                      <ul className="space-y-1">
                        {blockers.map((b) => (
                          <li key={`${b.scope}:${b.step_id}`}>
                            <button onClick={() => jumpTo(b.step_id, b.scope)} className="text-left text-[11.5px] text-text hover:underline">
                              {b.message}{b.scope !== scope && <span className="ml-1 text-text-tertiary">(organisation step)</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-tertiary">
                    {(['done', 'in_progress', 'todo', 'blocked', 'overdue', 'shortcut'] as StepStatus[]).map((s) => (
                      <span key={s} className="flex items-center gap-1"><Dot status={s} />{s === 'shortcut' ? 'View, start or automatic (not counted)' : STATUS[s].label}</span>
                    ))}
                  </div>

                  {/* Stages */}
                  {phases.map((p) => (
                    <div key={p.phase} className="space-y-1.5">
                      <div className="flex items-center gap-2 pl-0.5 pt-1 font-mono text-[10px] uppercase tracking-wider text-text-tertiary">
                        {p.phase}<span className="h-px flex-1 bg-border" />
                      </div>
                      {p.stages.map((st) => {
                        const isOpen = open.has(st.id);
                        const ss = STAGE_STATUS[st.status];
                        return (
                          <section key={st.id} className="overflow-hidden rounded-md border border-border bg-surface">
                            <button
                              onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(st.id)) n.delete(st.id); else n.add(st.id); return n; })}
                              aria-expanded={isOpen}
                              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-left hover:bg-surface-hover"
                            >
                              {isOpen ? <ChevronDown size={14} className="text-text-tertiary" /> : <ChevronRight size={14} className="text-text-tertiary" />}
                              <span className="rounded border border-accent px-1 font-mono text-[9.5px] font-semibold text-accent">{st.workflow}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[12.5px] font-medium text-text">{st.title}</span>
                                <span className="block text-[10.5px] text-text-tertiary">{st.summary}</span>
                              </span>
                              <span className="flex basis-full items-center gap-2 pl-7 sm:basis-auto sm:pl-0">
                                {st.total > 0 && <span className="w-20 shrink-0"><Bar done={st.done} total={st.total} /></span>}
                                {st.total > 0 && <span className="font-mono text-[10px] text-text-secondary">{st.done}/{st.total}</span>}
                                <Badge tone={ss.tone}>{ss.label}</Badge>
                              </span>
                            </button>
                            {isOpen && (
                              <div className="border-t border-border">
                                {st.steps.length === 0 && (
                                  <p className="px-4 py-3 text-[11px] text-text-secondary">
                                    {st.id === 'm-w8' ? 'No open incident or grievance on this model. The steps appear when one is reported.' : 'Nothing in this stage applies with the packs and features in force.'}
                                  </p>
                                )}
                                {st.id === 'm-w8' && st.steps.length > 0 && st.steps.every((s) => !s.counted) && (
                                  <p className="border-b border-border px-4 py-2 text-[10.5px] text-text-tertiary">No open incident or grievance. The handling steps appear when one is reported.</p>
                                )}
                                {st.steps.map((s) => (
                                  <StepRow
                                    key={`${s.from_stage ?? ''}${s.id}`}
                                    s={s}
                                    expanded={expanded === s.id && !s.from_stage}
                                    onToggle={() => setExpanded((e) => (e === s.id ? null : s.id))}
                                    onOpen={() => go(s.link, s)}
                                    onJump={(id, sc) => jumpTo(id, sc)}
                                  />
                                ))}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  ))}
                  <p className="pb-2 text-right font-mono text-[9.5px] text-text-tertiary">Checked {new Date(view.evaluated_at).toLocaleString()}</p>
                </>
              ) : null}
            </>
          )}
        </div>
      </main>
      {jur && jurOpen && (
        <JurisdictionModal
          jur={jur}
          onClose={closeJur}
          onSaved={(label) => {
            closeJur();
            toast(`Jurisdiction set to ${label}. The workflow now follows its packs.`, 'positive');
            load();
            loadModels();
          }}
        />
      )}
    </AppShell>
  );
}

function StepRow({ s, expanded, onToggle, onOpen, onJump }: {
  s: Step; expanded: boolean; onToggle: () => void; onOpen: () => void; onJump: (id: string, scope: 'org' | 'model') => void;
}) {
  const st = STATUS[s.status];
  const uncounted = !s.counted;
  return (
    <div id={s.from_stage ? undefined : `wf-step-${s.id}`} className={`border-b border-border last:border-b-0 ${expanded ? 'bg-bg' : ''}`}>
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1 px-3 py-2 sm:flex-nowrap sm:pl-9">
        <button onClick={onToggle} className="mt-0.5" aria-label={`${st.label}: ${s.title}`}><Dot status={s.status} /></button>
        <button onClick={onToggle} className="min-w-0 flex-1 basis-[calc(100%-30px)] text-left sm:basis-auto" aria-expanded={expanded}>
          <span className={`block text-[12px] ${uncounted ? 'text-text-secondary' : 'font-medium text-text'}`}>
            <span className="mr-1.5 font-mono text-[10px] font-normal text-text-tertiary">{s.step}</span>
            {s.title}
            {s.from_stage && <span className="ml-1.5 font-mono text-[9.5px] text-text-tertiary">from {s.from_stage}</span>}
          </span>
          <span className="block text-[10.5px] text-text-tertiary">{s.who} · {s.where}</span>
          {s.detail && <span className={`block font-mono text-[10px] ${s.status === 'overdue' || s.status === 'blocked' ? 'text-negative' : 'text-text-secondary'}`}>{s.detail}</span>}
          {s.status === 'blocked' && s.waiting_on.length > 0 && (
            <span className="block text-[10.5px] text-negative">Waiting on {s.waiting_on.map((w) => `${w.step} ${w.title}`).join('; ')}</span>
          )}
        </button>
        <span className="ml-[28px] flex shrink-0 items-center gap-1.5 sm:ml-0">
          {s.recurring && s.next_due_at && <span className="hidden font-mono text-[9.5px] text-text-tertiary sm:inline">due {day(s.next_due_at)}</span>}
          <Badge tone={st.tone}>{st.label}</Badge>
          <Button size="xs" variant={s.status === 'done' || uncounted ? 'ghost' : 'secondary'} onClick={onOpen} aria-label={`Open ${s.step} ${s.title}`}>
            Open <ArrowRight size={10} />
          </Button>
        </span>
      </div>
      {expanded && (
        <div className="space-y-1.5 px-3 pb-3 pl-[46px] text-[11px] sm:pl-[66px]">
          <p className="text-text-secondary"><span className="font-medium text-text">Why it matters. </span>{s.why}</p>
          {s.done_when && <p className="text-text-secondary"><span className="font-medium text-text">Done when </span>{s.done_when}.</p>}
          {s.gaps.length > 0 && (
            <div>
              <div className="font-medium text-text">Still failing in the framework checks</div>
              <ul className="ml-4 list-disc text-negative">{s.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          )}
          {s.status === 'blocked' && s.waiting_on.map((w) => (
            <button key={w.id} onClick={() => onJump(w.id, w.scope)} className="block text-accent hover:underline">
              Go to {w.step} {w.title}{w.scope === 'org' ? ' (Organisation view)' : ''}
            </button>
          ))}
          {s.controls.length > 0 && <p className="font-mono text-[9.5px] text-text-tertiary">Checks: {s.controls.join(', ')}</p>}
          {s.last_done_at && <p className="font-mono text-[9.5px] text-text-tertiary">Last done {day(s.last_done_at)}{s.next_due_at ? ` · next due ${day(s.next_due_at)}` : ''}</p>}
        </div>
      )}
    </div>
  );
}

function JurisdictionModal({ jur, onClose, onSaved }: { jur: Jurisdiction; onClose: () => void; onSaved: (label: string) => void }) {
  const regional = jur.catalog.filter((c) => !c.baseline);
  const [primary, setPrimary] = useState<string>(jur.is_default ? '' : jur.primary ?? '');
  const [extra, setExtra] = useState<Set<string>>(() => new Set(jur.enabled_packs));
  const [reason, setReason] = useState('Jurisdiction chosen from the Workflows page');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const choice = JURISDICTION_CHOICES.find((j) => j.id === primary);
  const locked = new Set(choice?.packs ?? []);
  const packs = [...new Set([...(choice?.packs ?? []), ...extra])].filter((p) => regional.some((r) => r.pack_id === p));
  const unchanged = !!choice && primary === (jur.primary ?? 'INTL') && packs.length === jur.enabled_packs.length && packs.every((p) => jur.enabled_packs.includes(p));

  const pick = (id: string) => {
    const prev = JURISDICTION_CHOICES.find((j) => j.id === primary);
    const next = JURISDICTION_CHOICES.find((j) => j.id === id)!;
    setExtra((e) => { const n = new Set(e); prev?.packs.forEach((p) => n.delete(p)); next.packs.forEach((p) => n.add(p)); return n; });
    setPrimary(id);
  };

  const save = async () => {
    if (!choice) return;
    if (unchanged) { onClose(); return; }
    if (reason.trim().length < 5) { setErr('Give a reason of at least 5 characters. It is kept in the change history.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await api('/governance/settings', { method: 'PUT', body: JSON.stringify({ settings: { primaryJurisdiction: primary, enabledPacks: packs }, reason: reason.trim() }) });
      onSaved(choice.label);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Where does your organisation operate?"
      subtitle="This picks the framework packs in force, and so which steps appear in every workflow. It saves a new version of Governance › Setup › Settings."
      footer={
        <>
          <span className="mr-auto text-[10px] text-text-tertiary">NIST AI RMF and ISO/IEC 42001 always apply.</span>
          <Button variant="ghost" size="sm" onClick={onClose}>Later</Button>
          <Button variant="primary" size="sm" disabled={!choice || busy} onClick={save}>
            {busy ? 'Saving…' : unchanged ? 'Keep as is' : 'Save and apply'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-1.5" role="radiogroup" aria-label="Primary jurisdiction">
          {JURISDICTION_CHOICES.filter((j) => j.id === 'INTL' || j.packs.some((p) => regional.some((r) => r.pack_id === p))).map((j) => (
            <label key={j.id} className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 ${primary === j.id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-hover'}`}>
              <input type="radio" name="jurisdiction" className="mt-0.5" checked={primary === j.id} onChange={() => pick(j.id)} />
              <span>
                <span className="block text-[12px] font-medium text-text">{j.label}</span>
                <span className="block text-[10.5px] text-text-secondary">{j.note}</span>
              </span>
            </label>
          ))}
        </div>
        {regional.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-medium text-text">Also in force (other regions you operate in)</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {regional.map((r) => (
                <label key={r.pack_id} className="flex items-center gap-1.5 text-[11px] text-text">
                  <input
                    type="checkbox"
                    checked={packs.includes(r.pack_id)}
                    disabled={locked.has(r.pack_id)}
                    onChange={(e) => setExtra((x) => { const n = new Set(x); if (e.target.checked) n.add(r.pack_id); else n.delete(r.pack_id); return n; })}
                  />
                  {r.name}
                  {locked.has(r.pack_id) && <span className="font-mono text-[9px] text-accent">primary</span>}
                </label>
              ))}
            </div>
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-text">Reason for the change history</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-8 w-full rounded-md border border-border-strong bg-bg px-2 text-[11.5px] text-text"
          />
        </label>
        <p className="text-[10.5px] text-text-tertiary">
          Banks: model-risk (SR 26-2) scope is set per model in W2.3, so it is not asked here. Risk appetite and deploy-gate modes stay in Governance › Setup.
        </p>
        {err && <p className="rounded-md border border-negative bg-negative-soft px-2 py-1.5 text-[11px] text-negative">{err}</p>}
      </div>
    </Modal>
  );
}
