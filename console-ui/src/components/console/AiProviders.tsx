import { Boxes, Globe, KeyRound, Lock, Plus, Trash2, Activity } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '../../api/client';
import { useConsoleUi } from '../../stores/consoleUi';
import { Badge } from '../ui/Badge';
import { Panel, PanelError } from '../ui/Panel';
import { SkeletonBlock } from '../ui/Skeleton';

export interface Provider {
  provider_id: string;
  organization_id: string;
  label: string;
  adapter: string;
  base_url: string;
  model: string;
  api_key_masked: string | null;
  has_api_key: boolean;
  linked_model_id: string | null;
  enabled: boolean;
  local_endpoint: boolean;
  last_test_status: string | null;
  last_test_at: string | null;
}

/** A preset just prefills protocol + endpoint + a sensible default model.
 *  Two adapters cover the market; Ollama leads because it keeps data on-box. */
const PRESETS: Record<string, { label: string; adapter: string; base_url: string; model: string }> = {
  ollama: { label: 'Ollama (local)', adapter: 'openai-compat', base_url: 'http://localhost:11434/v1', model: 'llama3.1' },
  openai: { label: 'OpenAI', adapter: 'openai-compat', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  gemini: { label: 'Google Gemini', adapter: 'openai-compat', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  anthropic: { label: 'Anthropic Claude', adapter: 'anthropic', base_url: 'https://api.anthropic.com', model: 'claude-sonnet-5' },
  openrouter: { label: 'OpenRouter', adapter: 'openai-compat', base_url: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  together: { label: 'Together.ai', adapter: 'openai-compat', base_url: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  huggingface: { label: 'Hugging Face', adapter: 'openai-compat', base_url: 'https://router.huggingface.co/v1', model: 'meta-llama/Llama-3.1-8B-Instruct' },
  groq: { label: 'Groq', adapter: 'openai-compat', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  mistral: { label: 'Mistral', adapter: 'openai-compat', base_url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  custom: { label: '', adapter: 'openai-compat', base_url: '', model: '' },
};

const LOCAL_RE = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|host\.docker\.internal|\[?::1)/i;
const FIELD = 'w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text placeholder:text-text-tertiary focus:border-accent';
const LABEL = 'mb-1 block text-[9px] font-medium uppercase tracking-widest text-text-tertiary';

const emptyForm = { id: '', label: '', adapter: 'openai-compat', base_url: '', model: '', api_key: '' };

export function AiProviders({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
  const toast = useConsoleUi((s) => s.toast);
  const [rows, setRows] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [existingKey, setExistingKey] = useState<string | null>(null);

  const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<Provider[]>(`/ai/providers${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    void load();
  }, [load]);

  const openForm = (p?: Provider) => {
    setForm(p ? { id: p.provider_id, label: p.label, adapter: p.adapter, base_url: p.base_url, model: p.model, api_key: '' } : emptyForm);
    setExistingKey(p?.has_api_key ? p.api_key_masked : null);
    setOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('form');
    try {
      const body: Record<string, unknown> = {
        label: form.label.trim(), adapter: form.adapter,
        base_url: form.base_url.trim(), model: form.model.trim(),
      };
      // Key semantics: send on create; on edit only when the user typed one
      // (blank keeps the stored key, which the API never returns).
      if (!form.id || form.api_key) body.api_key = form.api_key;
      if (!form.id && orgId) body.organization_id = orgId;
      if (form.id) await api(`/ai/providers/${form.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/ai/providers', { method: 'POST', body: JSON.stringify(body) });
      toast(form.id ? 'Provider updated' : 'Provider added — run Test to verify', 'positive');
      setOpen(false);
      setForm(emptyForm);
      await load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'negative');
    } finally {
      setBusy(null);
    }
  };

  const test = async (p: Provider) => {
    setBusy(p.provider_id);
    try {
      const r = await api<{ status: string; latency_ms: number; detail: string }>(`/ai/providers/${p.provider_id}/test`, { method: 'POST' });
      toast(r.status === 'ok' ? `Connection OK · ${r.latency_ms} ms` : `Test failed — ${r.detail}`, r.status === 'ok' ? 'positive' : 'negative');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Test failed', 'negative');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (p: Provider) => {
    try {
      await api(`/ai/providers/${p.provider_id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !p.enabled }) });
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'negative');
    }
  };

  const remove = async (p: Provider) => {
    if (!window.confirm(`Remove "${p.label}"?\n\nIts stored API key is deleted. The self-registered inventory entry is retired (not deleted) so its history survives.`)) return;
    try {
      await api(`/ai/providers/${p.provider_id}`, { method: 'DELETE' });
      toast('Provider removed');
      await load();
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'negative');
    }
  };

  const isLocal = LOCAL_RE.test(form.base_url);

  return (
    <Panel
      title="AI Providers"
      right={
        <button onClick={() => openForm()} className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[10.5px] font-medium text-white hover:opacity-90">
          <Plus size={11} /> Add
        </button>
      }
    >
      {error ? (
        <PanelError onRetry={load} />
      ) : loading ? (
        <SkeletonBlock />
      ) : (
        <div className="p-2">
          {open && (
            <form onSubmit={submit} className="mb-2 rounded-md border border-border bg-bg-elevated p-2.5">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <label className={LABEL}>Preset</label>
                  <select
                    className={FIELD}
                    onChange={(e) => {
                      const p = PRESETS[e.target.value];
                      if (p) setForm((f) => ({ ...f, label: p.label || f.label, adapter: p.adapter, base_url: p.base_url, model: p.model }));
                    }}
                    defaultValue=""
                  >
                    <option value="">— choose a provider —</option>
                    {Object.entries(PRESETS).map(([k, p]) => (
                      <option key={k} value={k}>{p.label || 'Custom (vLLM / TGI / other)'}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Label</label>
                  <input className={FIELD} required maxLength={120} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Ollama (on-prem)" />
                </div>
                <div>
                  <label className={LABEL}>Protocol</label>
                  <select className={FIELD} value={form.adapter} onChange={(e) => setForm({ ...form, adapter: e.target.value })}>
                    <option value="openai-compat">OpenAI-compatible</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Base URL</label>
                  <input className={FIELD} required value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.openai.com/v1" />
                </div>
                <div>
                  <label className={LABEL}>Model</label>
                  <input className={FIELD} required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="gpt-4o-mini" />
                </div>
                <div>
                  <label className={LABEL}>API key</label>
                  <input className={FIELD} type="password" autoComplete="off" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    placeholder={existingKey ? `saved (${existingKey}) — blank keeps it` : 'blank = keyless (Ollama)'} />
                </div>
              </div>
              {form.base_url && (
                <p className={`mt-2 text-[10px] ${isLocal ? 'text-positive' : 'text-warning'}`}>
                  {isLocal
                    ? '🔒 Local endpoint — code snippets stay on your network.'
                    : '🌐 External endpoint — secret-masked snippets will be sent to this provider. Confirm this is acceptable under your data policy.'}
                </p>
              )}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover">Cancel</button>
                <button type="submit" disabled={busy === 'form'} className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50">
                  {busy === 'form' ? 'Saving…' : 'Save provider'}
                </button>
              </div>
            </form>
          )}

          {!rows.length ? (
            <p className="px-1 py-3 text-[11px] leading-relaxed text-text-secondary">
              No AI provider configured — drafting uses the built-in rule-based engine (fully local).
              Add a provider to enable richer AI summaries and rationales.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((p) => (
                <div key={p.provider_id} className={`rounded-md border border-border bg-bg-elevated p-2.5 ${p.enabled ? '' : 'opacity-60'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium text-text">{p.label}</span>
                        {!p.enabled && <Badge tone="neutral">disabled</Badge>}
                      </div>
                      <div className="truncate font-mono text-[9.5px] text-text-tertiary">
                        {p.adapter} · {p.model} · {p.base_url}
                        {p.has_api_key ? ` · key ${p.api_key_masked}` : ' · keyless'}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {p.local_endpoint ? (
                          <Badge tone="positive" title="The base URL points inside your network — snippets never leave your infrastructure."><Lock size={8} className="mr-0.5 inline" />local — no egress</Badge>
                        ) : (
                          <Badge tone="warning" title="Secret-masked code snippets are sent to this external provider."><Globe size={8} className="mr-0.5 inline" />external</Badge>
                        )}
                        {p.last_test_status === 'ok' && <Badge tone="positive">connection OK</Badge>}
                        {p.last_test_status === 'failed' && <Badge tone="negative">last test failed</Badge>}
                        {!p.last_test_status && <Badge tone="neutral">not tested</Badge>}
                        {p.linked_model_id && (
                          <Badge tone="accent" title="Self-governance: this LLM is registered in your own Model Inventory and carries governance obligations like any other AI system.">
                            <Boxes size={8} className="mr-0.5 inline" />in inventory
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button disabled={busy === p.provider_id} onClick={() => test(p)} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50">
                        <Activity size={11} /> {busy === p.provider_id ? 'Testing…' : 'Test'}
                      </button>
                      <button onClick={() => openForm(p)} className="rounded-md border border-border px-2 py-1 text-[10.5px] text-text-secondary hover:bg-surface-hover">Edit</button>
                      <button onClick={() => toggle(p)} className="rounded-md border border-border px-2 py-1 text-[10.5px] text-text-secondary hover:bg-surface-hover">{p.enabled ? 'Disable' : 'Enable'}</button>
                      <button onClick={() => remove(p)} aria-label={`Remove ${p.label}`} className="rounded-md border border-border px-1.5 py-1 text-text-tertiary hover:bg-surface-hover hover:text-negative">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 flex items-start gap-1.5 px-1 text-[10px] leading-relaxed text-text-tertiary">
            <KeyRound size={11} className="mt-0.5 shrink-0" />
            Keys are encrypted at rest and never returned by the API — only the mask is shown. Where snippets are sent is a governance decision, so this surface is limited to ADMIN / CISO / OWNER.
          </p>
        </div>
      )}
    </Panel>
  );
}
