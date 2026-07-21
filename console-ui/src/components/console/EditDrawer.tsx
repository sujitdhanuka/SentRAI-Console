import { X } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';

import { AIComponent, provider, SUTRA_ENUM, SUTRAS } from '../../providers';
import { useGovernanceData } from '../../stores/governanceData';
import { useConsoleUi } from '../../stores/consoleUi';

const daysAgoToISO = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
const isoToDaysAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));

const FIELD = 'w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text placeholder:text-text-tertiary focus:border-accent';
const LABEL = 'mb-1 block text-[9px] font-medium uppercase tracking-widest text-text-tertiary';

/** Right-side drawer editing the selected component. Focus-trapped; Esc closes;
 *  Save round-trips through the provider (which appends a ledger entry). */
export function EditDrawer({ component }: { component: AIComponent | null }) {
  const open = useConsoleUi((s) => s.drawerOpen);
  const setDrawer = useConsoleUi((s) => s.setDrawer);
  const toast = useConsoleUi((s) => s.toast);
  const load = useGovernanceData((s) => s.load);
  const ref = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    owner: '', boardPolicyRef: '', humanOversight: true, redTeamDate: '',
    autonomousScope: '', useCase: '', riskRationale: '', sutras: [] as boolean[],
  });

  useEffect(() => {
    if (open && component) {
      setForm({
        owner: component.owner,
        boardPolicyRef: component.boardPolicyRef ?? '',
        humanOversight: component.humanOversight,
        redTeamDate: daysAgoToISO(component.lastRedTeamDaysAgo),
        autonomousScope: component.autonomousScope ?? '',
        useCase: component.useCase ?? component.description,
        riskRationale: component.riskRationale ?? '',
        // Prefer the exact declared sutras (HTTP mode); fall back to count-only.
        sutras: component.sutras
          ? SUTRA_ENUM.map((v) => component.sutras!.includes(v))
          : SUTRAS.map((_, i) => i < component.sutrasDeclared),
      });
      setTimeout(() => ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus(), 0);
    }
  }, [open, component]);

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
      toast('Compliance re-checked', 'positive');
      setDrawer(false);
    } catch {
      toast('Save failed', 'negative');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`Edit ${component.name}`}>
      <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
      <div ref={ref} className="absolute right-0 top-0 flex h-full w-[400px] max-w-full flex-col border-l border-border-strong bg-surface shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="font-heading text-[13px] font-medium">Edit Entry</h2>
            <div className="font-mono text-[9px] text-text-tertiary">{component.name} · {component.id}</div>
          </div>
          <button onClick={() => setDrawer(false)} aria-label="Close" className="rounded p-1 text-text-tertiary hover:bg-surface-hover">
            <X size={15} />
          </button>
        </header>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <div><label className={LABEL}>Owner team<input className={FIELD} value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label></div>
            <div><label className={LABEL}>Board policy reference<input className={FIELD} placeholder="e.g. AI-POL-2026-014" value={form.boardPolicyRef} onChange={(e) => setForm({ ...form, boardPolicyRef: e.target.value })} /></label></div>
            <label className="flex items-center gap-2 text-[11px] text-text">
              <input type="checkbox" checked={form.humanOversight} onChange={(e) => setForm({ ...form, humanOversight: e.target.checked })} />
              Human oversight required
            </label>
            <div><label className={LABEL}>Last red-team date<input type="date" className={`${FIELD} font-mono`} value={form.redTeamDate} onChange={(e) => setForm({ ...form, redTeamDate: e.target.value })} /></label></div>
            <div><label className={LABEL}>Autonomous scope<input className={FIELD} placeholder="empty = fully supervised" value={form.autonomousScope} onChange={(e) => setForm({ ...form, autonomousScope: e.target.value })} /></label></div>
            <div><label className={LABEL}>Use case description<textarea rows={3} className={FIELD} value={form.useCase} onChange={(e) => setForm({ ...form, useCase: e.target.value })} /></label></div>
            <div><label className={LABEL}>Risk rationale<textarea rows={3} className={FIELD} value={form.riskRationale} onChange={(e) => setForm({ ...form, riskRationale: e.target.value })} /></label></div>
            <fieldset className="rounded-md border border-border p-2.5">
              <legend className="px-1 text-[9px] font-medium uppercase tracking-widest text-text-tertiary">7 Sutras declared</legend>
              <div className="grid grid-cols-1 gap-1.5">
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
                    />
                    {s}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <footer className="shrink-0 border-t border-border p-3">
            <button type="submit" disabled={saving} className="w-full rounded-md bg-accent py-2 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save & Re-check Compliance'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
