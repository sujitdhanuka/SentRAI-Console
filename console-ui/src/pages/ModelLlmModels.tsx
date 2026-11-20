import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { fieldClass, labelClass } from '../components/ui/form';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';

type Status = 'not_applicable' | 'unconfirmed' | 'mismatch' | 'confirmed';
interface Entry { task: string; provider: string; model: string; notes?: string }
interface Storage { kind: 'db_column' | 'settings_key' | 'env_var'; location: string; keyed_by?: string[]; file: string; line: number }
interface Observed {
  task: string | null; provider: string | null; model: string; requested_models: string[];
  calls: number; first_seen: string; last_seen: string; confirmed: boolean | null;
}
interface LlmModelsView {
  model_id: string;
  status: Status;
  detected: null | {
    scanned_at: string; providers: string[]; runtime_configured: boolean; per_task: boolean;
    candidate_models: Array<{ model: string; provider?: string; roles: string[]; count: number }>;
    storage: Storage[];
  };
  confirmed: null | { entries: Entry[]; confirmed_by: string; confirmed_at: string };
  observed: Observed[];
  suggestions: Array<Entry & { source: 'scan' | 'runtime' }>;
}

const STATUS: Record<Status, { tone: BadgeTone; label: string; help: string }> = {
  confirmed: { tone: 'positive', label: 'Confirmed', help: 'The owner confirmed these models, and nothing seen at runtime contradicts them.' },
  unconfirmed: { tone: 'warning', label: 'Not confirmed', help: 'This record calls an LLM, but nobody has confirmed which models it uses. The code often names only the provider; the model is set in the app.' },
  mismatch: { tone: 'negative', label: 'Unconfirmed model in use', help: 'Runtime telemetry saw a model that is not on the confirmed list. Check it, then add it or fix the app.' },
  not_applicable: { tone: 'neutral', label: 'No LLM detected', help: 'The scan did not find LLM calls in this record. You can still list models if it uses one.' },
};

const KIND_LABEL: Record<Storage['kind'], string> = {
  db_column: 'Database column',
  settings_key: 'Settings key',
  env_var: 'Environment variable',
};

const when = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');
const blank = (): Entry => ({ task: '', provider: '', model: '', notes: '' });

const TELEMETRY_EXAMPLE = `POST /api/v1/telemetry/events
{ "events": [{
    "sentrai_model_id": "<this model's id>",
    "type": "llm_call",
    "provider": "OpenRouter",
    "task": "summary",
    "model": "<model the app requested>",
    "response_model": "<model field of the provider's response>"
}] }`;

/**
 * The real LLM models behind a record. The scan usually sees only the provider
 * (for example OpenRouter); the model is often chosen in the app's own UI and
 * kept in its database. This tab shows where the scan found the model stored,
 * lets the owner confirm the per-task list, and compares it with runtime calls.
 */
export function LlmModelsTab({ modelId }: { modelId: string }) {
  const toast = useConsoleUi((s) => s.toast);
  const [view, setView] = useState<LlmModelsView | null>(null);
  const [error, setError] = useState(false);
  const [rows, setRows] = useState<Entry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(false);
    api<LlmModelsView>(`/inventory/models/${encodeURIComponent(modelId)}/llm-models`)
      .then((v) => {
        setView(v);
        setRows(v.confirmed?.entries?.length ? v.confirmed.entries.map((e) => ({ ...e, notes: e.notes ?? '' })) : []);
        setDirty(false);
      })
      .catch(() => setError(true));
  }, [modelId]);
  useEffect(load, [load]);

  const edit = (i: number, patch: Partial<Entry>) => {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
    setDirty(true);
  };
  const add = (e: Entry = blank()) => { setRows((r) => [...r, e]); setDirty(true); };
  const remove = (i: number) => { setRows((r) => r.filter((_, j) => j !== i)); setDirty(true); };

  const save = async () => {
    const entries = rows.filter((r) => r.model.trim()).map((r) => ({ ...r, task: r.task.trim() || 'default' }));
    setSaving(true);
    try {
      const v = await api<LlmModelsView>(`/inventory/models/${encodeURIComponent(modelId)}/llm-models`, {
        method: 'PUT',
        body: JSON.stringify({ entries }),
      });
      setView(v);
      setRows(v.confirmed?.entries?.map((e) => ({ ...e, notes: e.notes ?? '' })) ?? []);
      setDirty(false);
      toast(entries.length ? 'Models confirmed' : 'Confirmation withdrawn', 'positive');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'negative');
    } finally {
      setSaving(false);
    }
  };

  if (error) return <Panel title="LLM models"><PanelError onRetry={load} /></Panel>;
  if (!view) return <Panel title="LLM models"><SkeletonRows rows={6} /></Panel>;

  const st = STATUS[view.status];
  const d = view.detected;
  const suggestions = view.suggestions.filter((s) => !rows.some((r) => r.model.toLowerCase() === s.model.toLowerCase() && (r.task || 'default').toLowerCase() === s.task.toLowerCase()));

  return (
    <>
      <Panel
        title="Models used"
        right={<Badge tone={st.tone} title={st.help}>{st.label}</Badge>}
      >
        <div className="space-y-2 p-3">
          <p className="text-[10.5px] text-text-secondary">{st.help}</p>
          {view.confirmed && (
            <p className="font-mono text-[9.5px] text-text-tertiary">
              Confirmed by {view.confirmed.confirmed_by} on {when(view.confirmed.confirmed_at)}
            </p>
          )}

          {rows.length > 0 && (
            <div className="space-y-1.5">
              <div className="hidden grid-cols-[1fr_1fr_1.4fr_1.4fr_auto] gap-1.5 md:grid">
                {['Task', 'Provider', 'Model', 'Notes', ''].map((h) => <span key={h} className={labelClass}>{h}</span>)}
              </div>
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-1 gap-1.5 rounded-md border border-border p-1.5 md:grid-cols-[1fr_1fr_1.4fr_1.4fr_auto] md:border-0 md:p-0">
                  <input aria-label="Task" className={fieldClass} value={r.task} placeholder="default, summary, chat…" onChange={(e) => edit(i, { task: e.target.value })} />
                  <input aria-label="Provider" className={fieldClass} value={r.provider} placeholder="OpenRouter" onChange={(e) => edit(i, { provider: e.target.value })} />
                  <input aria-label="Model" className={`${fieldClass} font-mono`} value={r.model} placeholder="anthropic/claude-sonnet-4" onChange={(e) => edit(i, { model: e.target.value })} />
                  <input aria-label="Notes" className={fieldClass} value={r.notes ?? ''} placeholder="Where it is set, e.g. Settings › AI" onChange={(e) => edit(i, { notes: e.target.value })} />
                  <Button variant="ghost" size="sm" aria-label="Remove row" onClick={() => remove(i)}><Trash2 size={12} /></Button>
                </div>
              ))}
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className={`${labelClass} mb-0 mr-1`}>Add from {suggestions.some((s) => s.source === 'runtime') ? 'scan and runtime' : 'scan'}</span>
              {suggestions.slice(0, 12).map((s) => (
                <button
                  key={`${s.source}:${s.task}:${s.model}`}
                  onClick={() => add({ task: s.task, provider: s.provider, model: s.model, notes: '' })}
                  title={s.source === 'runtime' ? 'Seen at runtime' : 'Found in the code, a default or a seed'}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] hover:bg-surface-hover ${s.source === 'runtime' ? 'border-warning text-warning' : 'border-border text-text-secondary'}`}
                >
                  + {s.task !== 'default' ? `${s.task}: ` : ''}{s.model}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 pt-1">
            <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={() => add()}>Add model</Button>
            <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>
              {saving ? 'Saving…' : rows.some((r) => r.model.trim()) ? 'Confirm models' : view.confirmed ? 'Withdraw confirmation' : 'Confirm models'}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Where the scan found them">
        {!d ? (
          <p className="p-3 text-[11px] text-text-secondary">No scan evidence yet. Re-scan the project to look for model settings in its schema, settings and environment files.</p>
        ) : (
          <div className="space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-1">
              <span className={`${labelClass} mb-0 mr-1`}>Providers</span>
              {d.providers.length ? d.providers.map((p) => <Badge key={p} tone="accent">{p}</Badge>) : <span className="text-[10.5px] text-text-tertiary">None found</span>}
              {d.per_task && <Badge tone="warning" title="Different tasks may use different models">Per-task models</Badge>}
            </div>

            <div>
              <span className={labelClass}>Where the model is set at runtime</span>
              {d.storage.length === 0 ? (
                <p className="text-[10.5px] text-text-tertiary">Nothing found. If the app picks its model in its own UI, add the models above.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {d.storage.map((s) => (
                    <li key={`${s.kind}:${s.location}`} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                      <Badge tone="neutral">{KIND_LABEL[s.kind]}</Badge>
                      <span className="font-mono text-[10.5px] text-text">{s.location}</span>
                      {s.keyed_by?.length ? <span className="text-[10px] text-text-secondary">one per {s.keyed_by.join(', ')}</span> : null}
                      <span className="ml-auto truncate font-mono text-[9.5px] text-text-tertiary">{s.file}:{s.line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {d.candidate_models.length > 0 && (
              <div>
                <span className={labelClass}>Model ids in code, defaults and seeds</span>
                <div className="flex flex-wrap gap-1">
                  {d.candidate_models.slice(0, 20).map((m) => (
                    <span key={m.model} className="rounded border border-border px-1.5 py-0.5 font-mono text-[9.5px] text-text-secondary" title={`${m.provider ?? 'Unknown vendor'} · ${m.roles.join(', ')}`}>
                      {m.model}{m.roles.includes('default') ? ' · default' : m.roles.includes('seed') ? ' · seed' : ''}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-text-tertiary">A default or seed is only a starting value. The app's UI may have changed it, so confirm what is set today.</p>
              </div>
            )}
            <p className="font-mono text-[9px] text-text-tertiary">Scanned {when(d.scanned_at)}</p>
          </div>
        )}
      </Panel>

      <Panel title="Seen at runtime">
        {view.observed.length === 0 ? (
          <div className="space-y-2 p-3">
            <p className="text-[11px] text-text-secondary">
              No LLM calls reported yet. To see the models the app really calls, have it send an <span className="font-mono">llm_call</span> event after each LLM request.
              Take <span className="font-mono">response_model</span> from the provider's response, since a gateway like OpenRouter can route or fall back to another model.
            </p>
            <pre className="overflow-x-auto rounded-md border border-border bg-bg-elevated p-2 font-mono text-[9.5px] text-text-secondary">{TELEMETRY_EXAMPLE.replace("<this model's id>", modelId)}</pre>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[10.5px]">
              <thead>
                <tr>
                  {['Task', 'Provider', 'Model served', 'Requested', 'Calls', 'Last seen', ''].map((h) => (
                    <th key={h} className="border-b border-border bg-surface px-2 py-1.5 text-left text-[9px] font-medium uppercase tracking-widest text-text-tertiary">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.observed.map((o) => (
                  <tr key={`${o.task}:${o.provider}:${o.model}`} className={o.confirmed === false ? 'bg-negative-soft' : ''}>
                    <td className="border-b border-border px-2 py-1">{o.task ?? '—'}</td>
                    <td className="border-b border-border px-2 py-1">{o.provider ?? '—'}</td>
                    <td className="border-b border-border px-2 py-1 font-mono">{o.model}</td>
                    <td className="border-b border-border px-2 py-1 font-mono text-text-secondary">{o.requested_models.filter((m) => m !== o.model).join(', ') || '—'}</td>
                    <td className="border-b border-border px-2 py-1 font-mono">{o.calls}</td>
                    <td className="border-b border-border px-2 py-1 font-mono text-text-tertiary">{when(o.last_seen)}</td>
                    <td className="border-b border-border px-2 py-1">
                      {o.confirmed === true ? <Badge tone="positive">Confirmed</Badge> : o.confirmed === false ? <Badge tone="negative">Not on list</Badge> : <Badge tone="neutral">Unchecked</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
