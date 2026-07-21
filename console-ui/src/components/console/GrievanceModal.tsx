import { X } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';

import { provider } from '../../providers';
import { useGovernanceData } from '../../stores/governanceData';
import { useConsoleUi } from '../../stores/consoleUi';

const FIELD = 'w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text placeholder:text-text-tertiary focus:border-accent';

/** Minimal consumer-grievance intake — files through the provider, which
 *  appends to the audit ledger, then toasts the generated grievance id. */
export function GrievanceModal() {
  const open = useConsoleUi((s) => s.grievanceOpen);
  const setGrievance = useConsoleUi((s) => s.setGrievance);
  const toast = useConsoleUi((s) => s.toast);
  const load = useGovernanceData((s) => s.load);
  const components = useGovernanceData((s) => s.components);
  const ref = useRef<HTMLDivElement>(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [componentId, setComponentId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSubject('');
      setDescription('');
      setComponentId(components[0]?.id ?? '');
      setTimeout(() => ref.current?.querySelector<HTMLElement>('select, input')?.focus(), 0);
    }
  }, [open, components]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setGrievance(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setGrievance]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await provider.fileGrievance({ subject, description, componentId: componentId || undefined });
      await load();
      toast(`Grievance ${id} filed`, 'positive');
      setGrievance(false);
    } catch {
      toast('Could not file grievance', 'negative');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="File a grievance">
      <div className="absolute inset-0 bg-black/40" onClick={() => setGrievance(false)} />
      <div ref={ref} className="relative w-[380px] max-w-[92vw] rounded-lg border border-border-strong bg-surface p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-[13px] font-medium">File a Grievance</h2>
          <button onClick={() => setGrievance(false)} aria-label="Close" className="rounded p-1 text-text-tertiary hover:bg-surface-hover">
            <X size={15} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <select className={FIELD} required value={componentId} onChange={(e) => setComponentId(e.target.value)} aria-label="AI component concerned">
            <option value="" disabled>— which AI component? —</option>
            {components.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input className={FIELD} required placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className={FIELD} required rows={4} placeholder="What happened, and which AI decision does it concern?" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button type="submit" disabled={busy} className="w-full rounded-md bg-accent py-2 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-50">
            {busy ? 'Filing…' : 'Submit Grievance'}
          </button>
        </form>
      </div>
    </div>
  );
}
