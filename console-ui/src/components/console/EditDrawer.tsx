import { CheckCircle2, FileStack, Info, Paperclip, PenLine, Power, ShieldAlert, Wrench, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../api/client';
import { AIComponent, provider, SUTRA_ENUM, SUTRAS } from '../../providers';
import { useGovernanceData } from '../../stores/governanceData';
import { useConsoleUi } from '../../stores/consoleUi';
import { useSession } from '../../stores/session';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

/** Model tool-authorization + operational-control facts (Pillar 2 — Control). */
interface ControlInfo {
  detected_tools: string[];
  permitted_tools: string[];
  tool_authorization: { unauthorized: string[]; authorized: string[]; undeclared: boolean; compliant: boolean };
  operational_state: string;
  operational_state_reason: string | null;
}

/** Latest review-board sign-off, as listed by /alignment/approvals. */
interface BoardApproval {
  approval_id: string;
  model_id: string;
  target_stage: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | string;
  requested_by: string;
  decisions: { actor: string; decision: string; decidedAt: string }[];
  created_at?: string;
  resolved_at?: string | null;
}

const toolLabel = (id: string) =>
  id.startsWith('tool:') ? id.slice(5) : id.replace(/^capability:/, '').replace(/[._]/g, ' ');

const daysAgoToISO = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
const isoToDaysAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));

import { fieldClass as FIELD } from '../ui/form';
import { labelClass as LABEL } from '../ui/form';

/* Per-framework compliance as returned by /inventory/models/:id/compliance-check. */
interface FrameworkReport {
  overall_pass?: boolean;
  blocking_gaps?: string[];
}
interface ComplianceCheck extends FrameworkReport {
  nist_rmf?: FrameworkReport;
  eu_ai_act?: FrameworkReport;
  iso_42001?: FrameworkReport;
}

const FRAMEWORKS: Array<{ key: 'rbi' | 'nist' | 'eu' | 'iso'; label: string }> = [
  { key: 'rbi', label: 'RBI FREE-AI 7 Sutras' },
  { key: 'nist', label: 'NIST AI RMF 1.0' },
  { key: 'eu', label: 'EU AI Act' },
  { key: 'iso', label: 'ISO 42001' },
];

function frameworkOf(check: ComplianceCheck | null, key: string): FrameworkReport | null {
  if (!check) return null;
  if (key === 'rbi') return check; // the sutras report is the top-level object
  if (key === 'nist') return check.nist_rmf ?? null;
  if (key === 'eu') return check.eu_ai_act ?? null;
  return check.iso_42001 ?? null;
}

/** Plain-language help for each governance field — shown as a hover tooltip so
 *  the form explains itself to a first-time user (or a judge) during the demo. */
const HINTS = {
  owner: "The named, accountable team that owns this model's risks. RBI FREE-AI accountability and ISO 42001 Clause 7.2 require a designated owner — 'unassigned' is a gap.",
  policy: 'The board-approved AI policy this model operates under. RBI FREE-AI Recommendation 14 mandates a board-approved AI policy reference.',
  redteam: 'When this model was last red teamed. The interval depends on the risk tier (HIGH 90 days, MEDIUM 180, LOW 365 with per-tier intervals on); an attached red_team report counts too.',
  oversight: 'Whether a human must review outputs before they are acted on. Uncheck only for genuinely autonomous systems — which then require a declared autonomous scope.',
  scope: "The boundary of what this model may do without per-action human sign-off — e.g. 'may draft tier-1 replies; escalate disputes to a human'. Empty means fully supervised. RBI FREE-AI Recommendation 16 requires clear autonomous action limits for any model without human oversight.",
  useCase: 'What this system does, in plain language. Auto-drafted from the code scan — review and confirm before governance sign-off.',
  rationale: 'Why this model carries its assigned risk tier. Drafted on demand from the detected code signals; edit and save as your confirmed rationale.',
  sutras: "Alignment with RBI FREE-AI's seven guiding principles (sutras). Declare the principles this model's governance satisfies.",
} as const;

/** A small info affordance: hover (or focus) to read the field's governance meaning. */
function Hint({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} tabIndex={0} className="ml-1 inline-flex cursor-help align-middle text-text-tertiary hover:text-accent focus-visible:text-accent">
      <Info size={11} />
    </span>
  );
}

/**
 * Governance workspace popup — opened by "Edit Entry". One screen carries the
 * whole glance the classic console offered: live per-framework verdicts with
 * their blocking gaps, the persisted remediation plan (re-draftable and
 * attachable as evidence), AI drafting on both narrative fields, and the
 * governance form. Saving re-checks compliance and updates the verdict cards
 * in place, so the effect of an edit is visible without closing the popup.
 */
export function EditDrawer({ component }: { component: AIComponent | null }) {
  const open = useConsoleUi((s) => s.drawerOpen);
  const setDrawer = useConsoleUi((s) => s.setDrawer);
  const toast = useConsoleUi((s) => s.toast);
  const load = useGovernanceData((s) => s.load);
  const ref = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [check, setCheck] = useState<ComplianceCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [remediation, setRemediation] = useState('');
  const [evalForm, setEvalForm] = useState({ suite: 'promptfoo', passed: '', total: '' });
  const [advForm, setAdvForm] = useState({ suite: 'garak', probes: '', breaches: '' });
  const [ctrl, setCtrl] = useState<ControlInfo | null>(null);
  const [permitted, setPermitted] = useState<string[]>([]);
  const [approval, setApproval] = useState<BoardApproval | null | 'none'>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const role = useSession((s) => s.user?.role ?? 'VIEWER');
  const canControl = role === 'ADMIN' || role === 'CISO';
  const [form, setForm] = useState({
    owner: '', boardPolicyRef: '', humanOversight: true, redTeamDate: '',
    autonomousScope: '', useCase: '', riskRationale: '', sutras: [] as boolean[],
  });

  const refreshCheck = useCallback(async (id: string) => {
    setChecking(true);
    try {
      setCheck(await api<ComplianceCheck>(`/inventory/models/${id}/compliance-check`));
    } catch {
      setCheck(null);
    } finally {
      setChecking(false);
    }
  }, []);

  const fetchControl = useCallback(async (id: string) => {
    try {
      const m = await api<ControlInfo>(`/inventory/models/${id}`);
      setCtrl(m);
      setPermitted(m.permitted_tools ?? []);
    } catch {
      setCtrl(null);
    }
  }, []);

  // Latest review-board sign-off for this model — the drawer is mission
  // control, so the approval state belongs here, not only on Alignment.
  const fetchApproval = useCallback(async (id: string) => {
    try {
      const all = await api<BoardApproval[]>(`/alignment/approvals`);
      const mine = all
        .filter((a) => a.model_id === id)
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      setApproval(mine[0] ?? 'none');
    } catch {
      setApproval('none');
    }
  }, []);

  // Seed the form once per opened component. Keyed on the id, not the object:
  // every reload hands over a new object, and re-seeding then would wipe edits
  // the user has not saved yet.
  const componentId = component?.id ?? null;
  const seedRef = useRef(component);
  seedRef.current = component;
  useEffect(() => {
    const component = seedRef.current;
    if (open && component) {
      setForm({
        owner: component.owner,
        boardPolicyRef: component.boardPolicyRef ?? '',
        humanOversight: component.humanOversight,
        redTeamDate: component.lastRedTeamDaysAgo < 9000 ? daysAgoToISO(component.lastRedTeamDaysAgo) : '',
        autonomousScope: component.autonomousScope ?? '',
        useCase: component.useCase ?? component.description,
        riskRationale: component.riskRationale ?? '',
        sutras: component.sutras
          ? SUTRA_ENUM.map((v) => component.sutras!.includes(v))
          : SUTRAS.map((_, i) => i < component.sutrasDeclared),
      });
      void refreshCheck(component.id);
      void fetchControl(component.id);
      void fetchApproval(component.id);
      setTimeout(() => ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus(), 0);
    }
  }, [open, componentId, refreshCheck, fetchControl, fetchApproval]);

  // The plan follows the server, which checks it against the live gaps on every
  // read, so it updates as gaps close instead of keeping the first scan's list.
  const serverPlan = component?.gapRemediation ?? '';
  useEffect(() => {
    if (open) setRemediation(serverPlan);
  }, [open, componentId, serverPlan]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
      if (e.key === 'Tab' && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>('input, textarea, button, a[href]')]
          .filter((el) => !el.hasAttribute('disabled'));
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setDrawer]);

  if (!open || !component) return null;

  /* ── AI drafting, same endpoints the detail panel and classic console use ── */

  const draftSummary = async () => {
    setBusy('summary');
    try {
      const r = await api<{ summary: string; ai_enabled: boolean; provider?: string }>(
        `/inventory/models/${component.id}/summarize`, { method: 'POST' });
      setForm((f) => ({ ...f, useCase: r.summary }));
      toast(r.ai_enabled ? `Drafted by ${r.provider ?? 'AI'} — review before saving` : 'Drafted locally — review before saving', 'positive');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Draft failed', 'negative');
    } finally { setBusy(null); }
  };

  const draftRationale = async () => {
    setBusy('rationale');
    try {
      const r = await api<{ risk_rationale: string; ai_enabled: boolean; provider?: string }>(
        `/inventory/models/${component.id}/risk-rationale`, { method: 'POST' });
      setForm((f) => ({ ...f, riskRationale: r.risk_rationale }));
      toast(r.ai_enabled ? `Drafted by ${r.provider ?? 'AI'} — review before saving` : 'Drafted locally — review before saving', 'positive');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Draft failed', 'negative');
    } finally { setBusy(null); }
  };

  const draftScope = async () => {
    setBusy('scope');
    try {
      const r = await api<{ autonomous_scope: string; ai_enabled: boolean; provider?: string }>(
        `/inventory/models/${component.id}/autonomous-scope`, { method: 'POST' });
      setForm((f) => ({ ...f, autonomousScope: r.autonomous_scope }));
      toast(r.ai_enabled ? `Scope drafted by ${r.provider ?? 'AI'} — review before saving` : 'Scope drafted locally — review before saving', 'positive');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Draft failed', 'negative');
    } finally { setBusy(null); }
  };

  const draftRemediation = async () => {
    setBusy('remediation');
    try {
      const r = await api<{ draft: string | null; open_gaps: number; message?: string }>(
        `/inventory/models/${component.id}/draft-remediation`, { method: 'POST' });
      if (!r.draft) { toast(r.message ?? 'No open gaps — nothing to remediate.'); setRemediation(''); return; }
      setRemediation(r.draft);
      await load();
      toast(`Remediation drafted for ${r.open_gaps} open gap(s) — review before attaching`, 'positive');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Draft failed', 'negative');
    } finally { setBusy(null); }
  };

  const ingestEval = async () => {
    const passed = Number(evalForm.passed);
    const total = Number(evalForm.total);
    if (!evalForm.suite.trim() || !Number.isFinite(total) || total <= 0 || !Number.isFinite(passed) || passed < 0) {
      toast('Enter a suite name, passed count, and a positive total.', 'negative');
      return;
    }
    setBusy('eval');
    try {
      const r = await api<{ pass_rate: number; passed: number; total: number }>(
        `/inventory/models/${component.id}/eval-evidence`,
        { method: 'POST', body: JSON.stringify({ suite: evalForm.suite.trim(), passed, total, actor: 'dashboard_user' }) },
      );
      toast(`Behavioral eval ingested — ${r.passed}/${r.total} passed (${r.pass_rate}%)`, 'positive');
      setEvalForm((f) => ({ ...f, passed: '', total: '' }));
      await refreshCheck(component.id);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ingest failed', 'negative');
    } finally { setBusy(null); }
  };

  const ingestAdversarial = async () => {
    const probes = Number(advForm.probes);
    const breaches = Number(advForm.breaches);
    if (!advForm.suite.trim() || !Number.isFinite(probes) || probes <= 0 || !Number.isFinite(breaches) || breaches < 0) {
      toast('Enter a suite, a positive probe count, and breaches.', 'negative');
      return;
    }
    setBusy('adversarial');
    try {
      const r = await api<{ resist_rate: number; failures: number; total_probes: number }>(
        `/inventory/models/${component.id}/adversarial-evidence`,
        { method: 'POST', body: JSON.stringify({ suite: advForm.suite.trim(), total_probes: probes, failures: breaches, actor: 'dashboard_user' }) },
      );
      toast(`Adversarial evidence ingested — ${r.failures}/${r.total_probes} breached (${r.resist_rate}% resisted); red-team date set`, r.failures > 0 ? 'negative' : 'positive');
      setAdvForm((f) => ({ ...f, probes: '', breaches: '' }));
      await refreshCheck(component.id);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ingest failed', 'negative');
    } finally { setBusy(null); }
  };

  const attachRemediation = async () => {
    setBusy('attach');
    try {
      await api(`/inventory/models/${component.id}/evidence`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'remediation_plan',
          ref: `remediation-draft:${new Date().toISOString().slice(0, 10)}`,
          description: remediation,
          actor: 'dashboard_user',
        }),
      });
      toast('Remediation plan attached as evidence', 'positive');
      await refreshCheck(component.id);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Attach failed', 'negative');
    } finally { setBusy(null); }
  };

  const toggleTool = (id: string) =>
    setPermitted((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const authorizeAllDetected = () =>
    setPermitted((p) => [...new Set([...p, ...(ctrl?.detected_tools ?? [])])]);

  const saveTools = async () => {
    setBusy('tools');
    try {
      await api(`/inventory/models/${component.id}/governance`, {
        method: 'PATCH',
        body: JSON.stringify({ permitted_tools: permitted, actor: 'dashboard_user' }),
      });
      toast('Tool authorization saved', 'positive');
      await fetchControl(component.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'negative');
    } finally { setBusy(null); }
  };

  const suspend = async () => {
    if (suspendReason.trim().length < 4) return;
    setBusy('suspend');
    try {
      await api(`/control/models/${component.id}/suspend`, {
        method: 'POST', body: JSON.stringify({ reason: suspendReason.trim() }),
      });
      toast('Model suspended — kill switch engaged', 'negative');
      setSuspendReason('');
      await fetchControl(component.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Suspend failed', 'negative');
    } finally { setBusy(null); }
  };

  const resume = async () => {
    setBusy('resume');
    try {
      await api(`/control/models/${component.id}/resume`, { method: 'POST' });
      toast('Model resumed — kill switch released', 'positive');
      await fetchControl(component.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Resume failed', 'negative');
    } finally { setBusy(null); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await provider.saveComponent({
        id: component.id,
        owner: form.owner,
        boardPolicyRef: form.boardPolicyRef || null,
        humanOversight: form.humanOversight,
        lastRedTeamDaysAgo: form.redTeamDate ? isoToDaysAgo(form.redTeamDate) : component.lastRedTeamDaysAgo,
        autonomousScope: form.autonomousScope || null,
        useCase: form.useCase,
        riskRationale: form.riskRationale,
        sutrasDeclared: form.sutras.filter(Boolean).length,
        sutras: SUTRA_ENUM.filter((_, i) => form.sutras[i]),
      });
      await load();
      // Keep the popup open: refresh the verdict cards so the effect of the
      // edit is visible immediately — that's the point of the single screen.
      await refreshCheck(component.id);
      toast('Saved — compliance re-checked', 'positive');
    } catch {
      toast('Save failed', 'negative');
    } finally {
      setSaving(false);
    }
  };

  const sourceRefs = component.sourceRefs ?? [];
  const detectedTools = ctrl?.detected_tools ?? [];
  const toolChips = [...new Set([...detectedTools, ...permitted])];
  const liveUnauthorized = detectedTools.filter((t) => !permitted.includes(t));
  const suspended = (ctrl?.operational_state ?? 'ACTIVE') === 'SUSPENDED';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 md:p-8" role="dialog" aria-modal="true" aria-label={`Edit ${component.name}`}>
      <div className="absolute inset-0 bg-black/45" onClick={() => setDrawer(false)} />
      <div ref={ref} className="relative flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-md border border-border-strong bg-surface">

        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h2 className="font-heading text-[15px] font-medium">Close Governance Gaps — {component.name}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={component.riskTier === 'High' ? 'negative' : component.riskTier === 'Medium' ? 'warning' : 'positive'}>
                {component.riskTier} risk
              </Badge>
              <span className="font-mono text-[9px] text-text-tertiary">{component.model} · {component.id.slice(0, 8)}</span>
              {sourceRefs.length > 0 && (
                <span className="flex items-center gap-1 font-mono text-[9px] text-text-tertiary">
                  <FileStack size={10} className="text-accent" />
                  {sourceRefs.length > 1 ? `merged from ${sourceRefs.length} files` : sourceRefs[0]}
                </span>
              )}
              <a
                href={`/card/${component.id}`}
                target="_blank"
                rel="noreferrer"
                title="Open the public consumer transparency card"
                className="font-mono text-[9px] text-accent hover:underline"
              >
                ↗ Public transparency card
              </a>
            </div>
          </div>
          <button onClick={() => setDrawer(false)} aria-label="Close" className="rounded p-1 text-text-tertiary hover:bg-surface-hover">
            <X size={16} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-5">

          {/* ── Left: the glance — verdicts, gaps, remediation ── */}
          <div className="space-y-3 border-b border-border p-4 lg:col-span-2 lg:border-b-0 lg:border-r">
            <div className="grid gap-2">
              {FRAMEWORKS.map(({ key, label }) => {
                const fw = frameworkOf(check, key);
                const pass = fw?.overall_pass ?? null;
                const gaps = fw?.blocking_gaps ?? [];
                return (
                  <section key={key} className="rounded-md border border-border bg-bg-elevated p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-text">{label}</span>
                      {checking ? (
                        <span className="font-mono text-[9px] text-text-tertiary">checking…</span>
                      ) : (
                        <Badge tone={pass == null ? 'neutral' : pass ? 'positive' : 'negative'}>
                          {pass == null ? '—' : pass ? 'Compliant' : 'Non-compliant'}
                        </Badge>
                      )}
                    </div>
                    {pass === true && <p className="mt-1 text-[10px] text-positive">✓ All checks satisfied.</p>}
                    {gaps.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {gaps.map((g, i) => (
                          <li key={i} className="text-[10px] leading-snug text-text-secondary">• {g}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>

            <section className="rounded-md border border-border p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Remediation plan</span>
                <button
                  type="button"
                  onClick={draftRemediation}
                  disabled={busy !== null}
                  className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                >
                  <PenLine size={9} /> {busy === 'remediation' ? 'Drafting…' : remediation ? 'Re-draft' : 'Draft plan'}
                </button>
              </div>
              {component.gapRemediationStale && remediation && (
                <p role="status" className="mb-1.5 rounded border border-warning bg-warning-soft px-2 py-1 text-[10px] leading-snug text-warning">
                  Drafted for an earlier set of gaps
                  {component.gapRemediationClosed ? `: ${component.gapRemediationClosed} closed since` : ''}
                  {component.gapRemediationNew ? `${component.gapRemediationClosed ? ',' : ':'} ${component.gapRemediationNew} new` : ''}
                  . Re-draft before attaching it as evidence.
                </p>
              )}
              {remediation ? (
                <>
                  <textarea
                    rows={7}
                    value={remediation}
                    onChange={(e) => setRemediation(e.target.value)}
                    className={`${FIELD} font-mono text-[10px] leading-relaxed`}
                  />
                  <button
                    type="button"
                    onClick={attachRemediation}
                    disabled={busy !== null || !remediation.trim()}
                    className="mt-1.5 flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                  >
                    <Paperclip size={10} /> {busy === 'attach' ? 'Attaching…' : 'Attach as evidence (remediation_plan)'}
                  </button>
                </>
              ) : (
                <p className="text-[10px] italic text-text-tertiary">
                  One actionable step per open gap, drafted for review — attaching it as evidence is how it
                  enters the compliance record.
                </p>
              )}
            </section>

            {/* Behavioral eval evidence — ingest eval-harness output as typed evidence. */}
            <section className="rounded-md border border-border p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Behavioral eval evidence</span>
              </div>
              <div className="flex flex-wrap items-end gap-1.5">
                <label className="flex-1">
                  <span className="mb-0.5 block text-[8.5px] uppercase tracking-wider text-text-tertiary">Suite</span>
                  <input className={`${FIELD} text-[10px]`} value={evalForm.suite} onChange={(e) => setEvalForm({ ...evalForm, suite: e.target.value })} placeholder="promptfoo / garak / pyrit" />
                </label>
                <label className="w-16">
                  <span className="mb-0.5 block text-[8.5px] uppercase tracking-wider text-text-tertiary">Passed</span>
                  <input inputMode="numeric" className={`${FIELD} font-mono text-[10px]`} value={evalForm.passed} onChange={(e) => setEvalForm({ ...evalForm, passed: e.target.value.replace(/[^0-9]/g, '') })} placeholder="0" />
                </label>
                <label className="w-16">
                  <span className="mb-0.5 block text-[8.5px] uppercase tracking-wider text-text-tertiary">Total</span>
                  <input inputMode="numeric" className={`${FIELD} font-mono text-[10px]`} value={evalForm.total} onChange={(e) => setEvalForm({ ...evalForm, total: e.target.value.replace(/[^0-9]/g, '') })} placeholder="0" />
                </label>
                <button
                  type="button"
                  onClick={ingestEval}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[10px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                >
                  <Paperclip size={10} /> {busy === 'eval' ? 'Ingesting…' : 'Ingest'}
                </button>
              </div>
              <p className="mt-1.5 text-[9.5px] italic text-text-tertiary">
                Records the eval-harness result as a typed <code className="font-mono not-italic text-accent">behavioral_eval</code> evidence artifact with its pass-rate — so a reviewer sees test <em>results</em>, not just a link.
              </p>
            </section>

            {/* Adversarial / red-team evidence (Pillar 4 — Security). */}
            <section className="rounded-md border border-border p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <ShieldAlert size={11} className="text-accent" />
                <span className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Adversarial / red-team evidence</span>
              </div>
              <div className="flex flex-wrap items-end gap-1.5">
                <label className="flex-1">
                  <span className="mb-0.5 block text-[8.5px] uppercase tracking-wider text-text-tertiary">Suite</span>
                  <input className={`${FIELD} text-[10px]`} value={advForm.suite} onChange={(e) => setAdvForm({ ...advForm, suite: e.target.value })} placeholder="garak / pyrit / promptfoo" />
                </label>
                <label className="w-16">
                  <span className="mb-0.5 block text-[8.5px] uppercase tracking-wider text-text-tertiary">Probes</span>
                  <input inputMode="numeric" className={`${FIELD} font-mono text-[10px]`} value={advForm.probes} onChange={(e) => setAdvForm({ ...advForm, probes: e.target.value.replace(/[^0-9]/g, '') })} placeholder="0" />
                </label>
                <label className="w-16">
                  <span className="mb-0.5 block text-[8.5px] uppercase tracking-wider text-text-tertiary">Breaches</span>
                  <input inputMode="numeric" className={`${FIELD} font-mono text-[10px]`} value={advForm.breaches} onChange={(e) => setAdvForm({ ...advForm, breaches: e.target.value.replace(/[^0-9]/g, '') })} placeholder="0" />
                </label>
                <button
                  type="button"
                  onClick={ingestAdversarial}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[10px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                >
                  <Paperclip size={10} /> {busy === 'adversarial' ? 'Ingesting…' : 'Ingest'}
                </button>
              </div>
              <p className="mt-1.5 text-[9.5px] italic text-text-tertiary">
                Ingest a garak / PyRIT / promptfoo run (breaches = probes that succeeded). Stores a typed <code className="font-mono not-italic text-accent">red_team</code> artifact <em>and</em> stamps the last-red-team date, satisfying the red-team control.
              </p>
            </section>

            {/* Static tool authorization (Pillar 2 — Control). */}
            <section className="rounded-md border border-border p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Wrench size={11} className="text-accent" />
                <span className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Tool authorization</span>
                {liveUnauthorized.length > 0
                  ? <Badge tone="negative">{liveUnauthorized.length} unauthorized</Badge>
                  : detectedTools.length > 0 ? <Badge tone="positive">authorized</Badge> : null}
              </div>
              {toolChips.length === 0 ? (
                <p className="text-[10px] italic text-text-tertiary">
                  No tools or capabilities detected in this model's source. Tool authorization applies to agents/tools that call the outside world.
                </p>
              ) : (
                <>
                  <p className="mb-1.5 text-[9.5px] text-text-secondary">
                    Check the tools this model is <b>permitted</b> to use. A detected tool left unchecked is an authorization
                    violation the CI gate will block.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {toolChips.map((id) => {
                      const isDetected = detectedTools.includes(id);
                      const isPermitted = permitted.includes(id);
                      const unauthorized = isDetected && !isPermitted;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleTool(id)}
                          title={isDetected ? 'Detected in source' : 'Declared, not detected'}
                          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9.5px] transition-colors ${
                            unauthorized
                              ? 'border-negative bg-negative-soft text-negative'
                              : isPermitted
                                ? 'border-positive bg-positive-soft text-positive'
                                : 'border-border text-text-tertiary hover:bg-surface-hover'
                          }`}
                        >
                          {isPermitted ? <CheckCircle2 size={10} /> : unauthorized ? <ShieldAlert size={10} /> : null}
                          {toolLabel(id)}
                          {!isDetected && <span className="opacity-60">(declared)</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="xs" onClick={authorizeAllDetected} disabled={busy !== null || detectedTools.every((t) => permitted.includes(t))}>
                      Authorize all detected
                    </Button>
                    <Button variant="primary" size="xs" onClick={saveTools} disabled={busy !== null}>
                      {busy === 'tools' ? 'Saving…' : 'Save authorization'}
                    </Button>
                    {liveUnauthorized.length > 0 && (
                      <span className="font-mono text-[9px] text-negative">
                        {liveUnauthorized.map(toolLabel).join(', ')} not authorized
                      </span>
                    )}
                  </div>
                </>
              )}
            </section>

            {/* Operational control — the kill switch (Pillar 2 — Control). */}
            <section className={`rounded-md border p-2.5 ${suspended ? 'border-negative' : 'border-border'}`}>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Power size={11} className={suspended ? 'text-negative' : 'text-positive'} />
                <span className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Operational control</span>
                <Badge tone={suspended ? 'negative' : 'positive'}>{suspended ? 'SUSPENDED' : 'ACTIVE'}</Badge>
              </div>
              {suspended && ctrl?.operational_state_reason && (
                <p className="mb-1.5 text-[10px] text-negative">Suspended: “{ctrl.operational_state_reason}”</p>
              )}
              {!canControl ? (
                <p className="text-[9.5px] italic text-text-tertiary">Only ADMIN or CISO can engage the kill switch.</p>
              ) : suspended ? (
                <Button variant="primary" size="sm" onClick={resume} disabled={busy !== null} icon={<Power size={12} />}>
                  {busy === 'resume' ? 'Resuming…' : 'Resume model'}
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${FIELD} max-w-[38ch] text-[10px]`}
                    placeholder="Reason (required) — e.g. anomalous outputs observed"
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                  />
                  <Button variant="danger" size="sm" onClick={suspend} disabled={busy !== null || suspendReason.trim().length < 4} icon={<Power size={12} />}>
                    {busy === 'suspend' ? 'Suspending…' : 'Suspend (kill switch)'}
                  </Button>
                </div>
              )}
              <p className="mt-1.5 text-[9.5px] italic text-text-tertiary">
                A deployed agent polls <code className="font-mono not-italic text-accent">/api/v1/control/models/{component.id.slice(0, 8)}…/poll</code> each loop and halts when suspended — the kill switch takes effect without a redeploy.
              </p>
            </section>
          </div>

          {/* ── Right: the governance form ── */}
          <form onSubmit={submit} className="flex min-h-0 flex-col lg:col-span-3">
            <div className="min-h-0 flex-1 space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className={LABEL}>Owner team<Hint text={HINTS.owner} /><input className={FIELD} value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label></div>
                <div><label className={LABEL}>Board policy reference<Hint text={HINTS.policy} /><input className={FIELD} placeholder="e.g. AI-POL-2026-014" value={form.boardPolicyRef} onChange={(e) => setForm({ ...form, boardPolicyRef: e.target.value })} /></label></div>
                <div><label className={LABEL}>Last red-team date<Hint text={HINTS.redteam} /><input type="date" className={`${FIELD} font-mono`} value={form.redTeamDate} onChange={(e) => setForm({ ...form, redTeamDate: e.target.value })} /></label></div>
                <label className="flex items-center gap-2 self-end pb-1.5 text-[11px] text-text">
                  <input type="checkbox" checked={form.humanOversight} onChange={(e) => setForm({ ...form, humanOversight: e.target.checked })} className="accent-accent" />
                  Human oversight required
                  <Hint text={HINTS.oversight} />
                </label>
              </div>

              {/* Review-board approval state — read-only; granted on the Alignment page. */}
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-2">
                <span className={LABEL} style={{ marginBottom: 0 }}>Board approval</span>
                {approval === null ? (
                  <span className="text-[10px] text-text-tertiary">checking…</span>
                ) : approval === 'none' ? (
                  <Badge tone="neutral">none on record</Badge>
                ) : (
                  <>
                    <Badge tone={approval.status === 'APPROVED' ? 'positive' : approval.status === 'REJECTED' ? 'negative' : 'warning'}>
                      {approval.status.toLowerCase()}
                    </Badge>
                    <span className="font-mono text-[9.5px] text-text-secondary">
                      → {approval.target_stage} · requested by {approval.requested_by}
                      {approval.decisions[0] && ` · decided by ${approval.decisions[0].actor}`}
                    </span>
                  </>
                )}
              </div>
              <div>
                <span className="flex items-center justify-between gap-2">
                  <label className={LABEL}>Autonomous scope<Hint text={HINTS.scope} /></label>
                  <button type="button" onClick={draftScope} disabled={busy !== null}
                    className="mb-1 flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50">
                    <PenLine size={9} /> {busy === 'scope' ? 'Drafting…' : 'Draft scope'}
                  </button>
                </span>
                <input className={FIELD} placeholder={'e.g. "may draft tier-1 replies; escalate disputes to a human" — empty = fully supervised'}
                  value={form.autonomousScope} onChange={(e) => setForm({ ...form, autonomousScope: e.target.value })} />
              </div>

              <div>
                <span className="flex items-center justify-between gap-2">
                  <label className={LABEL}>Use case description<Hint text={HINTS.useCase} /></label>
                  <button type="button" onClick={draftSummary} disabled={busy !== null}
                    className="mb-1 flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50">
                    <PenLine size={9} /> {busy === 'summary' ? 'Drafting…' : 'Summarize'}
                  </button>
                </span>
                <textarea rows={4} className={FIELD} value={form.useCase} onChange={(e) => setForm({ ...form, useCase: e.target.value })} />
              </div>

              <div>
                <span className="flex items-center justify-between gap-2">
                  <label className={LABEL}>Risk rationale<Hint text={HINTS.rationale} /></label>
                  <button type="button" onClick={draftRationale} disabled={busy !== null}
                    className="mb-1 flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50">
                    <PenLine size={9} /> {busy === 'rationale' ? 'Drafting…' : 'Draft rationale'}
                  </button>
                </span>
                <textarea rows={4} className={FIELD} placeholder="Why this model carries its assigned risk level — drafted on demand, editable, saved as your confirmed rationale."
                  value={form.riskRationale} onChange={(e) => setForm({ ...form, riskRationale: e.target.value })} />
              </div>

              <fieldset className="rounded-md border border-border p-2.5">
                <legend className="px-1 text-[9px] font-medium uppercase tracking-widest text-text-tertiary">7 Sutras declared<Hint text={HINTS.sutras} /></legend>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {SUTRAS.map((s, i) => (
                    <label key={s} className="flex items-center gap-2 text-[10.5px] text-text-secondary">
                      <input
                        type="checkbox"
                        checked={form.sutras[i] ?? false}
                        onChange={(e) => {
                          const sutras = [...form.sutras];
                          sutras[i] = e.target.checked;
                          setForm({ ...form, sutras });
                        }}
                        className="accent-accent"
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <footer className="flex shrink-0 items-center gap-2 border-t border-border p-3">
              <span className="mr-auto text-[9.5px] text-text-tertiary">
                Saving appends a ledger entry and re-checks the verdicts on the left.
              </span>
              <Button variant="secondary" size="md" onClick={() => setDrawer(false)}>Close</Button>
              <Button type="submit" variant="primary" size="md" disabled={saving}>
                {saving ? 'Saving…' : 'Save & Re-check Compliance'}
              </Button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
}
