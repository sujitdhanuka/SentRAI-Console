import { PromptUseCase } from './default-prompts';

/**
 * The {{variable}} template engine for the prompt vault.
 *
 * Trust boundary: template BODIES are trusted (only governance roles can save
 * them); interpolated VALUES are untrusted (docstrings, code snippets) — the
 * caller secret-masks values before rendering. Unknown placeholders render as
 * empty strings so a typo never sends literal '{{foo}}' to an LLM.
 */

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(VAR_RE)) seen.add(m[1]);
  return [...seen];
}

export interface TemplateValidation {
  ok: boolean;
  /** Fatal: required variables the template no longer references. */
  missingRequired: string[];
  /** Advisory: placeholders that aren't in the use case's variable catalog. */
  unknownVariables: string[];
}

export function validateTemplate(body: string, spec: PromptUseCase): TemplateValidation {
  const used = new Set(extractVariables(body));
  const known = new Set(spec.variables.map((v) => v.name));
  const missingRequired = spec.variables.filter((v) => v.required && !used.has(v.name)).map((v) => v.name);
  const unknownVariables = [...used].filter((name) => !known.has(name));
  return { ok: missingRequired.length === 0, missingRequired, unknownVariables };
}

export function renderTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(VAR_RE, (_m, name: string) => String(vars[name] ?? ''));
}
