import { chatComplete } from '../ai/llm-client';
import { buildSummaryPrompt } from './prompt-builder';
import { SummarizationContext, Summarizer, SummaryResult } from './summarizer.types';

/**
 * LLM-backed summariser for ANY configured endpoint — org-registered providers
 * (OpenAI, Gemini, Ollama, OpenRouter, Together.ai, HF, …) and the env-level
 * Anthropic config alike; the wire protocol comes from `adapter`. Only ever
 * constructed with an explicit configuration, so no code leaves the box unless
 * an operator opted in; prompt content is secret-masked by the prompt builder.
 */
export class ConfiguredLlmSummarizer implements Summarizer {
  readonly source = 'ai' as const;

  constructor(
    private readonly adapter: string,
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey: string | null,
    private readonly maxSnippetChars: number,
    /** The vault-resolved template body (org's active version or the default). */
    private readonly template: string,
  ) {}

  async generate(ctx: SummarizationContext): Promise<SummaryResult> {
    const r = await chatComplete({
      adapter: this.adapter,
      baseUrl: this.baseUrl,
      model: this.model,
      apiKey: this.apiKey,
      prompt: buildSummaryPrompt(ctx, this.template, this.maxSnippetChars),
      maxTokens: 400,
      timeoutMs: 45_000,
    });
    return { text: r.text, source: this.source, model: this.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, latencyMs: r.latencyMs };
  }
}
