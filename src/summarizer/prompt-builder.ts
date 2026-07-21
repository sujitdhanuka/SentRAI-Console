import { redactSecrets } from './redact';
import { SummarizationContext } from './summarizer.types';

/**
 * Builds the governance-summary prompt for any LLM provider. Shared by every
 * adapter so org-configured providers and the env-configured one produce the
 * same, auditable prompt. Untrusted content (docstring, snippet) is secret-
 * masked here — nothing above this call needs to remember to do it.
 *
 * Phase 2 replaces the hardcoded text with the org's prompt-vault template.
 */
export function buildSummaryPrompt(ctx: SummarizationContext, maxSnippetChars: number): string {
  const snippet = ctx.snippet ? redactSecrets(ctx.snippet).slice(0, maxSnippetChars) : '';
  return [
    'You are an AI-governance analyst. Write a concise, plain-language summary of what this software component does, for a compliance inventory read by risk officers and auditors (not engineers).',
    'Rules: 2–4 sentences. Say what it does, what decisions/outputs it influences, and who/what it affects. Note if it processes personal data. Do NOT restate code identifiers or include code. Do NOT invent capabilities not evidenced below.',
    '',
    `Name: ${ctx.name}`,
    `Detected type: ${ctx.modelType}`,
    `Functional area: ${ctx.functionalArea}`,
    `Static-analysis signals: ${ctx.signals.join(', ') || 'none'}`,
    `Domain tags: ${ctx.domainTags.join(', ') || 'none'}`,
    `Human oversight required: ${ctx.humanOversightRequired}`,
    `Existing description (may be raw docstring): ${redactSecrets(ctx.existingDescription || '(none)')}`,
    snippet ? `\nSource excerpt (secrets already masked):\n${snippet}` : '',
  ].join('\n');
}
