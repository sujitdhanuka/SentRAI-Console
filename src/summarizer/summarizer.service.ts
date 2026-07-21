import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiProvidersService } from '../ai/ai-providers.service';
import { ConfiguredLlmSummarizer } from './configured-llm.summarizer';
import { HeuristicSummarizer } from './heuristic.summarizer';
import { SummarizationContext, Summarizer, SummaryResult } from './summarizer.types';

/**
 * Picks the description summariser per request and runs it.
 *
 * Precedence for a caller's organization:
 *   1. the org's own registered provider (AI Settings — BYO-LLM),
 *   2. the env-level provider (AI_SUMMARIZER_* / ANTHROPIC_API_KEY),
 *   3. the local heuristic (no network — always available).
 *
 * If a selected AI provider errors at call time we degrade to the heuristic
 * rather than failing the request — a governance console should always be able
 * to produce *a* summary.
 */
@Injectable()
export class SummarizerService {
  private readonly log = new Logger('SummarizerService');
  private readonly heuristic = new HeuristicSummarizer();
  private readonly envPrimary: Summarizer;
  private readonly maxSnippetChars: number;

  constructor(
    private readonly config: ConfigService,
    private readonly providers: AiProvidersService,
  ) {
    const cfg = this.config.get('aiSummarizer') as {
      provider: string; model: string; apiKey: string | null; baseUrl: string; maxSnippetChars: number;
    };
    this.maxSnippetChars = cfg?.maxSnippetChars ?? 4000;
    if (cfg?.provider === 'anthropic' && cfg.apiKey) {
      this.envPrimary = new ConfiguredLlmSummarizer('anthropic', cfg.baseUrl, cfg.model, cfg.apiKey, this.maxSnippetChars);
      this.log.log(`Env-level AI summariser enabled: anthropic (${cfg.model})`);
    } else {
      this.envPrimary = this.heuristic;
    }
  }

  private async pickForOrg(tenantId: string | null): Promise<{ s: Summarizer; label: string }> {
    // 1) The org's own registered provider.
    try {
      const cfg = await this.providers.resolveActiveForOrg(tenantId, 'model_summary');
      if (cfg) {
        return {
          s: new ConfiguredLlmSummarizer(cfg.adapter, cfg.baseUrl, cfg.model, cfg.apiKey, this.maxSnippetChars),
          label: `${cfg.label} · ${cfg.model}`,
        };
      }
    } catch (e) {
      this.log.warn(`Org provider resolution failed (${String(e)}); falling through.`);
    }
    // 2) Env-level provider, 3) heuristic.
    if (this.envPrimary.source === 'ai') return { s: this.envPrimary, label: String(this.envPrimary.model) };
    return { s: this.heuristic, label: 'heuristic (local)' };
  }

  /** True when a real AI provider (org or env) would serve this org. */
  async aiEnabledForOrg(tenantId: string | null): Promise<boolean> {
    return (await this.pickForOrg(tenantId)).s.source === 'ai';
  }

  async summarizeForOrg(
    tenantId: string | null,
    ctx: SummarizationContext,
  ): Promise<SummaryResult & { provider: string }> {
    const { s, label } = await this.pickForOrg(tenantId);
    try {
      return { ...(await s.generate(ctx)), provider: label };
    } catch (e) {
      if (s.source === 'ai') {
        this.log.warn(`AI summariser '${label}' failed (${String(e)}); falling back to heuristic.`);
        return { ...(await this.heuristic.generate(ctx)), provider: 'heuristic (local)' };
      }
      throw e;
    }
  }
}
