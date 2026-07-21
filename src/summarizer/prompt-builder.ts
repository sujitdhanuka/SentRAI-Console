import { renderTemplate } from '../ai/template';
import { redactSecrets } from './redact';
import { SummarizationContext } from './summarizer.types';

/**
 * Renders the model-summary prompt from a vault template (the org's active
 * version, or the system default — the caller resolves which). Untrusted
 * values (docstring, snippet) are secret-masked HERE, before interpolation,
 * so no call site above can forget; template bodies themselves are trusted
 * (only governance roles can save them).
 */
export function buildSummaryPrompt(ctx: SummarizationContext, template: string, maxSnippetChars: number): string {
  const snippet = ctx.snippet ? redactSecrets(ctx.snippet).slice(0, maxSnippetChars) : '';
  return renderTemplate(template, {
    name: ctx.name,
    model_type: ctx.modelType,
    functional_area: ctx.functionalArea,
    signals: ctx.signals.join(', ') || 'none',
    domain_tags: ctx.domainTags.join(', ') || 'none',
    human_oversight: String(ctx.humanOversightRequired),
    existing_description: redactSecrets(ctx.existingDescription || '(none)'),
    snippet_block: snippet ? `\nSource excerpt (secrets already masked):\n${snippet}` : '',
  });
}
