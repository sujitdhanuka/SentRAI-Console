import { FileStack, Info, Paperclip, PenLine, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../api/client';
import { AIComponent, provider, SUTRA_ENUM, SUTRAS } from '../../providers';
import { useGovernanceData } from '../../stores/governanceData';
import { useConsoleUi } from '../../stores/consoleUi';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

const daysAgoToISO = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
const isoToDaysAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));

const FIELD = 'w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text placeholder:text-text-tertiary focus:border-accent';
const LABEL = 'mb-1 block text-[9px] font-medium uppercase tracking-widest text-text-tertiary';

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
  redteam: 'When this model was last adversarially / bias tested. Policy target: within 90 days; NIST MEASURE expects a red-team or bias review within the last 12 months.',
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

  useEffect(() => {
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
      setRemediation(component.gapRemediation ?? '');
      void refreshCheck(component.id);
      setTimeout(() => ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus(), 0);
    }
  }, [open, component, refreshCheck]);

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
      if (!r.draft) { toast(r.message ?? 'No open gaps — nothing to remediate.'); return; }
      setRemediation(r.draft);
      toast(`Remediation drafted for ${r.open_gaps} open gap(s) — review before attaching`, 'positive');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Draft failed', 'negative');
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
