import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AnthropicSummarizer } from './anthropic.summarizer';
import { HeuristicSummarizer } from './heuristic.summarizer';
import { SummarizationContext, Summarizer, SummaryResult } from './summarizer.types';

/**
 * Picks the description summariser from config and runs it. Default is the local
 * heuristic (no network). The Anthropic provider is only instantiated when
 * explicitly configured with a key; if it errors at call time we degrade to the
 * heuristic rather than failing the request — a governance console should always
 * be able to produce *a* summary.
 */
@Injectable()
export class SummarizerService {
  private readonly log = new Logger('SummarizerService');
  private readonly heuristic = new HeuristicSummarizer();
  private readonly primary: Summarizer;

  constructor(private readonly config: ConfigService) {
    const cfg = this.config.get('aiSummarizer') as {
      provider: string; model: string; apiKey: string | null; baseUrl: string; maxSnippetChars: number;
    };
    if (cfg?.provider === 'anthropic' && cfg.apiKey) {
      this.primary = new AnthropicSummarizer(cfg.model, cfg.apiKey, cfg.baseUrl, cfg.maxSnippetChars);
      this.log.log(`AI summariser enabled: anthropic (${cfg.model})`);
    } else {
      this.primary = this.heuristic;
    }
  }

  /** True when a real AI provider (not the local heuristic) is active. */
  get aiEnabled(): boolean {
    return this.primary.source === 'ai';
  }

  get activeProvider(): string {
    return this.aiEnabled ? `${this.primary.model}` : 'heuristic (local)';
  }

  async summarize(ctx: SummarizationContext): Promise<SummaryResult> {
    try {
      return await this.primary.generate(ctx);
    } catch (e) {
      if (this.primary.source === 'ai') {
        this.log.warn(`AI summariser failed (${String(e)}); falling back to heuristic.`);
        return this.heuristic.generate(ctx);
      }
      throw e;
    }
  }
}
