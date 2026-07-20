import { Logger } from '@nestjs/common';
import { redactSecrets } from './redact';
import { SummarizationContext, Summarizer, SummaryResult } from './summarizer.types';

/**
 * Claude-backed summariser. WIRED BUT OFF by default — the service only ever
 * constructs this when AI_SUMMARIZER_PROVIDER=anthropic and an API key is set,
 * so no code leaves the box unless an operator explicitly opts in. Everything it
 * sends is secret-masked first (redactSecrets). Uses the built-in fetch (Node
 * 18+) so there's no SDK dependency; baseUrl can target a VPC/Bedrock proxy.
 */
export class AnthropicSummarizer implements Summarizer {
  readonly source = 'ai' as const;
  private readonly log = new Logger('AnthropicSummarizer');

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly maxSnippetChars: number,
  ) {}

  private buildPrompt(ctx: SummarizationContext): string {
    const snippet = ctx.snippet ? redactSecrets(ctx.snippet).slice(0, this.maxSnippetChars) : '';
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

  async generate(ctx: SummarizationContext): Promise<SummaryResult> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 400,
        messages: [{ role: 'user', content: this.buildPrompt(ctx) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const text = (data?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
    if (!text) throw new Error('Anthropic API returned no text');
    return { text, source: this.source, model: this.model };
  }
}
