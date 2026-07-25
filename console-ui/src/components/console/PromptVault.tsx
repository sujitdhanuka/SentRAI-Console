import { History, PencilLine, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../../api/client';
import { useConsoleUi } from '../../stores/consoleUi';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Panel, PanelError } from '../ui/Panel';
import { SkeletonBlock } from '../ui/Skeleton';

interface PromptVariable { name: string; description: string; required: boolean }

interface PromptUseCase {
  use_case: string;
  title: string;
  description: string;
  variables: PromptVariable[];
  body: string;
  customized: boolean;
  active_version: number | null;
  version_count: number;
  default_body: string;
}

interface Version {
  version: number;
  body: string;
  active: boolean;
  change_note: string | null;
  created_by: string;
  created_at: string;
}

import { fieldClass as FIELD } from '../ui/form';

/**
 * Versioned prompt templates. Saving never overwrites — it appends version N+1
 * and activates it — so the vault doubles as an audit trail of exactly which
 * prompt drove which AI output. Restore copies an old body forward as a new
 * version; reset deactivates the org's versions but keeps their history.
 */
export function PromptVault({ orgId }: { orgId: string }) {
  const toast = useConsoleUi((s) => s.toast);
  const [rows, setRows] = useState<PromptUseCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [preview, setPreview] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : '';
  const scopeBody = orgId ? { organization_id: orgId } : {};

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<PromptUseCase[]>(`/ai/prompts${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prompt vault');
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (p: PromptUseCase) => {
    setHistoryOf(null);
    setEditing(p.use_case);
    setDraft(p.body);
    setNote('');
  };

  const save = async (useCase: string) => {
    setBusy(true);
    try {
      const r = await api<{ version: number; warnings: string[] }>(`/ai/prompts/${useCase}`, {
        method: 'PUT',
        body: JSON.stringify({ body: draft, change_note: note || undefined, ...scopeBody }),
      });
      toast(`Saved as v${r.version}`, 'positive');
      (r.warnings ?? []).forEach((w) => toast(w, 'negative'));
      setEditing(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'negative');
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (useCase: string) => {
    setEditing(null);
    setPreview(null);
    setHistoryOf(useCase);
    setVersions([]);
    try {
      setVersions(await api<Version[]>(`/ai/prompts/${useCase}/history${qs}`));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load history', 'negative');
    }
  };

  const restore = async (useCase: string, version: number) => {
    try {
      const r = await api<{ version: number }>(`/ai/prompts/${useCase}/restore/${version}`, { method: 'POST', body: JSON.stringify(scopeBody) });
      toast(`Restored v${version} as v${r.version}`, 'positive');
      setHistoryOf(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Restore failed', 'negative');
    }
  };

  const reset = async (useCase: string) => {
    if (!window.confirm('Reset this prompt to the system default?\n\nYour saved versions stay in History — nothing is deleted.')) return;
    try {
      await api(`/ai/prompts/${useCase}/reset`, { method: 'POST', body: JSON.stringify(scopeBody) });
      toast('Reset to system default');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Reset failed', 'negative');
    }
  };

  return (
    <Panel title="Prompt Vault">
      {error ? (
        <PanelError onRetry={load} />
      ) : loading ? (
        <SkeletonBlock />
      ) : (
        <div className="flex flex-col gap-2 p-2">
          <p className="px-1 text-[10.5px] leading-relaxed text-text-secondary">
            The exact instructions sent to the AI for each task. Every edit is saved as a{' '}
            <b>new version</b> — nothing is overwritten, so the vault is also the record of which
            prompt produced which output. <code className="font-mono text-accent">{'{{variables}}'}</code> are
            filled from the model being processed.
          </p>

          {rows.map((p) => (
            <div key={p.use_case} className="rounded-md border border-border bg-bg-elevated p-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] font-medium text-text">{p.title}</span>
                    {p.customized
                      ? <Badge tone="warning" title={`Your organization's version ${p.active_version} is active`}>customized · v{p.active_version}</Badge>
                      : <Badge tone="neutral" title="No customization — the built-in default applies">system default</Badge>}
                  </div>
                  <p className="mt-0.5 max-w-[70ch] text-[10.5px] text-text-secondary">{p.description}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => startEdit(p)} icon={<PencilLine size={11} />}>Edit</Button>
                  <Button variant="secondary" size="sm" disabled={!p.version_count} onClick={() => openHistory(p.use_case)} icon={<History size={11} />}>History ({p.version_count})</Button>
                  {p.customized && (
                    <Button variant="secondary" size="sm" onClick={() => reset(p.use_case)} icon={<RotateCcw size={11} />}>Reset</Button>
                  )}
                </div>
              </div>

              {editing === p.use_case && (
                <div className="mt-2 border-t border-border pt-2">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[9px] uppercase tracking-widest text-text-tertiary">Variables (* required):</span>
                    {p.variables.map((v) => (
                      <span key={v.name} title={v.description} className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[9px] text-text-secondary">
                        {`{{${v.name}}}`}{v.required ? ' *' : ''}
                      </span>
                    ))}
                  </div>
                  <textarea rows={9} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${FIELD} font-mono`} />
                  <input className={`${FIELD} mt-2`} maxLength={255} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Change note (optional) — e.g. added PII instruction" />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => save(p.use_case)}>{busy ? 'Saving…' : 'Save as new version'}</Button>
                  </div>
                </div>
              )}

              {historyOf === p.use_case && (
                <div className="mt-2 border-t border-border pt-2">
                  {!versions.length ? (
                    <p className="text-[10.5px] text-text-secondary">Loading history…</p>
                  ) : (
                    <>
                      {versions.map((v) => (
                        <div key={v.version} className="border-b border-border py-1.5 last:border-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[10.5px] font-medium">v{v.version}</span>
                            {v.active && <Badge tone="positive">active</Badge>}
                            <span className="font-mono text-[9px] text-text-tertiary">
                              {v.created_by} · {new Date(v.created_at).toLocaleString()}
                              {v.change_note ? ` · “${v.change_note}”` : ''}
                            </span>
                            <span className="ml-auto flex gap-1.5">
                              <Button variant="secondary" size="xs" onClick={() => setPreview(preview === v.version ? null : v.version)}>{preview === v.version ? 'Hide' : 'View'}</Button>
                              {!v.active && (
                                <Button variant="secondary" size="xs" onClick={() => restore(p.use_case, v.version)}>Restore</Button>
                              )}
                            </span>
                          </div>
                          {preview === v.version && (
                            <pre className="mt-1.5 max-h-52 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface p-2 font-mono text-[9.5px] text-text">{v.body}</pre>
                          )}
                        </div>
                      ))}
                      <div className="mt-1.5 text-right">
                        <Button variant="secondary" size="xs" onClick={() => setHistoryOf(null)}>Close</Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
