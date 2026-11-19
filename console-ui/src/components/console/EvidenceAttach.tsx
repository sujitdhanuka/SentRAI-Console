import { Paperclip } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../../api/client';
import { useConsoleUi } from '../../stores/consoleUi';
import { useGovernanceFeatures } from '../../stores/governanceFeatures';
import { Button } from '../ui/Button';
import { fieldClass as FIELD } from '../ui/form';

/** Evidence kinds a person attaches by hand. Red teams, evals and remediation plans have their own forms. */
export const EVIDENCE_KINDS: Array<{ type: string; label: string }> = [
  { type: 'bias_test', label: 'Bias / fairness test' },
  { type: 'model_card', label: 'Model card' },
  { type: 'dpia', label: 'DPIA / privacy assessment' },
  { type: 'explainability', label: 'Explainability report' },
  { type: 'validation_report', label: 'Validation report' },
  { type: 'data_sheet', label: 'Datasheet' },
  { type: 'other', label: 'Other' },
];

interface Artifact { type: string; ref: string; description?: string; added_at?: string; document_id?: string }

/**
 * Attach a typed evidence artifact (bias test, model card, DPIA…) to a model
 * and list what is already on record. Before this, these could only be
 * attached through the API.
 */
export function EvidenceAttach({ modelId, onAttached }: { modelId: string; onAttached?: () => void | Promise<void> }) {
  const toast = useConsoleUi((s) => s.toast);
  const docControl = useGovernanceFeatures((s) => s.features?.documentControl);
  const [list, setList] = useState<Artifact[]>([]);
  const [docs, setDocs] = useState<Array<{ document_id: string; title: string }>>([]);
  const [f, setF] = useState({ type: 'bias_test', ref: '', description: '', document_id: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList((await api<{ evidence: Artifact[] }>(`/inventory/models/${modelId}/evidence`)).evidence ?? []);
    } catch {
      setList([]);
    }
  }, [modelId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!docControl) return;
    api<{ documents: Array<{ document_id: string; title: string }> }>('/governance/documents')
      .then((r) => setDocs(r.documents ?? []))
      .catch(() => setDocs([]));
  }, [docControl]);

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/inventory/models/${modelId}/evidence`, {
        method: 'POST',
        body: JSON.stringify({
          type: f.type, ref: f.ref.trim(), description: f.description.trim() || undefined,
          document_id: f.document_id || undefined, actor: 'dashboard_user',
        }),
      });
      toast('Evidence attached', 'positive');
      setF({ ...f, ref: '', description: '', document_id: '' });
      await load();
      await onAttached?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Attach failed', 'negative');
    } finally {
      setBusy(false);
    }
  };

  const label = (t: string) => EVIDENCE_KINDS.find((k) => k.type === t)?.label ?? t.replace(/_/g, ' ');
  return (
    <section className="rounded-md border border-border p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Paperclip size={11} className="text-accent" />
        <span className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Evidence on record</span>
        <span className="ml-auto font-mono text-[9px] text-text-tertiary">{list.length}</span>
      </div>
      {list.length > 0 && (
        <ul className="mb-1.5 max-h-28 space-y-0.5 overflow-y-auto">
          {[...list].reverse().map((a, i) => (
            <li key={i} className="truncate text-[10px] text-text-secondary" title={a.description ?? a.ref}>
              <span className="font-mono text-[9px] text-text-tertiary">{(a.added_at ?? '').slice(0, 10)}</span> {label(a.type)}: {a.ref}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-1.5">
        <select aria-label="Evidence type" className={`${FIELD} w-44 text-[10px]`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          {EVIDENCE_KINDS.map((k) => <option key={k.type} value={k.type}>{k.label}</option>)}
        </select>
        <input aria-label="Evidence reference" className={`${FIELD} min-w-[140px] flex-1 text-[10px]`} placeholder="Report URL or document reference" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-end gap-1.5">
        <input aria-label="Evidence description" className={`${FIELD} min-w-[160px] flex-1 text-[10px]`} placeholder="What it shows (e.g. disparate impact within 0.8–1.25)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        {docs.length > 0 && (
          <select aria-label="Controlled document" className={`${FIELD} w-40 text-[10px]`} value={f.document_id} onChange={(e) => setF({ ...f, document_id: e.target.value })}>
            <option value="">No controlled document</option>
            {docs.map((d) => <option key={d.document_id} value={d.document_id}>{d.title}</option>)}
          </select>
        )}
        <Button size="xs" variant="secondary" disabled={busy || f.ref.trim().length < 3} onClick={() => void submit()}>
          {busy ? 'Attaching…' : 'Attach'}
        </Button>
      </div>
    </section>
  );
}
