/**
 * Underlying LLM models of an inventory record. A scan can name the provider
 * (OpenRouter, OpenAI) but the model is often picked at runtime from the app's
 * own database. Three sources are reconciled here:
 *
 *  - detected:  where the scan found the model is named or stored (static);
 *  - confirmed: the per-task list an owner attests to (`ai_models.llmModels`);
 *  - observed:  what runtime `llm_call` telemetry says was actually called.
 *
 * Pure functions only, so the gate, the telemetry ingest and the API agree.
 */

export interface ConfirmedLlmModel {
  /** What the app uses this model for: 'summary', 'chat', 'embeddings', or 'default'. */
  task: string;
  provider: string;
  model: string;
  notes?: string;
}

export interface LlmModelsAttestation {
  entries: ConfirmedLlmModel[];
  confirmed_by: string;
  confirmed_at: string;
}

/** OpenRouter's auto router: confirming it accepts whatever model it picks. */
const AUTO_ROUTERS = new Set(['openrouter/auto', 'auto']);

/**
 * Canonical model id for comparison: lower-case, no vendor prefix, no dated
 * snapshot or variant suffix. 'openai/gpt-4o-2024-08-06' and 'gpt-4o' compare equal;
 * 'meta-llama/llama-3.1-8b-instruct:free' and 'llama-3.1-8b-instruct' compare equal.
 */
export function canonicalModel(model: string): string {
  let m = String(model ?? '').trim().toLowerCase();
  const slash = m.lastIndexOf('/');
  if (slash >= 0) m = m.slice(slash + 1);
  m = m.replace(/:[\w-]+$/, ''); // ':free', ':beta', ':nitro'
  m = m.replace(/[-@](?:\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/, ''); // dated snapshots
  m = m.replace(/-latest$/, '');
  return m;
}

export function sameModel(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase() || canonicalModel(a) === canonicalModel(b);
}

const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase();

export interface LlmCallFacts {
  provider?: string | null;
  /** The model the app asked for. */
  model?: string | null;
  /** The model that answered (OpenRouter may route or fall back). */
  response_model?: string | null;
  task?: string | null;
}

/** The model that actually served a call: the response model when reported. */
export function servedModel(ev: LlmCallFacts): string {
  return String(ev.response_model || ev.model || '').trim();
}

/**
 * Was this call made with a confirmed model? `null` when nothing is confirmed
 * yet (undeclared is surfaced on the record, not treated as a breach, matching
 * how tool authorization treats an undeclared permitted set).
 */
export function isConfirmedCall(att: LlmModelsAttestation | null | undefined, ev: LlmCallFacts): boolean | null {
  const entries = att?.entries ?? [];
  if (!entries.length) return null;
  const used = servedModel(ev);
  if (!used) return null;
  const task = norm(ev.task);
  const forTask = task ? entries.filter((e) => norm(e.task) === task) : [];
  const pool = forTask.length ? forTask : entries;
  return pool.some((e) => {
    if (AUTO_ROUTERS.has(norm(e.model))) return true; // the owner accepted router-chosen models for this task
    // Judged on the model that served the call: a confirmed request that the
    // gateway silently fell back from is still an unconfirmed model in use.
    return sameModel(e.model, used);
  });
}

/** Clean and de-duplicate an owner-submitted list. */
export function cleanEntries(entries: Array<Partial<ConfirmedLlmModel>>): ConfirmedLlmModel[] {
  const out: ConfirmedLlmModel[] = [];
  const seen = new Set<string>();
  for (const e of entries ?? []) {
    const task = String(e.task ?? '').trim() || 'default';
    const model = String(e.model ?? '').trim();
    const provider = String(e.provider ?? '').trim();
    if (!model) continue;
    const key = `${task.toLowerCase()}|${canonicalModel(model)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ task, provider, model, ...(e.notes && String(e.notes).trim() ? { notes: String(e.notes).trim().slice(0, 500) } : {}) });
  }
  return out;
}

export interface ObservedLlmModel {
  task: string | null;
  provider: string | null;
  model: string;
  requested_models: string[];
  calls: number;
  first_seen: string;
  last_seen: string;
  confirmed: boolean | null;
}

/** Group runtime llm_call events into one row per (task, provider, served model). */
export function aggregateObserved(
  events: Array<{ detail: Record<string, any> | null; occurredAt: Date }>,
  att: LlmModelsAttestation | null | undefined,
): ObservedLlmModel[] {
  const rows = new Map<string, ObservedLlmModel & { _req: Set<string> }>();
  for (const e of events) {
    const llm = (e.detail?.llm ?? {}) as LlmCallFacts;
    const model = servedModel(llm);
    if (!model) continue;
    const key = `${norm(llm.task)}|${norm(llm.provider)}|${model.toLowerCase()}`;
    const ts = e.occurredAt.toISOString();
    const r = rows.get(key) ?? {
      task: llm.task ? String(llm.task) : null, provider: llm.provider ? String(llm.provider) : null, model,
      requested_models: [], calls: 0, first_seen: ts, last_seen: ts, confirmed: isConfirmedCall(att, llm), _req: new Set<string>(),
    };
    r.calls += 1;
    if (llm.model) r._req.add(String(llm.model));
    if (ts < r.first_seen) r.first_seen = ts;
    if (ts > r.last_seen) r.last_seen = ts;
    rows.set(key, r);
  }
  return [...rows.values()]
    .map(({ _req, ...r }) => ({ ...r, requested_models: [..._req].sort() }))
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen));
}

/**
 * Record-level status, for the gate and the UI:
 *  - not_applicable: the record does not call an LLM;
 *  - unconfirmed:    it does, and no owner has confirmed its models;
 *  - mismatch:       confirmed, but runtime saw a model outside the list;
 *  - confirmed:      confirmed, and nothing observed contradicts it.
 */
export type LlmModelsStatus = 'not_applicable' | 'unconfirmed' | 'mismatch' | 'confirmed';

export function llmModelsStatus(isLlm: boolean, att: LlmModelsAttestation | null | undefined, observed: ObservedLlmModel[]): LlmModelsStatus {
  if (!att?.entries?.length) return isLlm || observed.length ? 'unconfirmed' : 'not_applicable';
  return observed.some((o) => o.confirmed === false) ? 'mismatch' : 'confirmed';
}
