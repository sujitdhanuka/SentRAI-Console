import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiProvidersService } from '../ai/ai-providers.service';
import { PromptVaultService } from '../ai/prompt-vault.service';
import { ConfiguredLlmSummarizer } from './configured-llm.summarizer';
import { HeuristicSummarizer } from './heuristic.summarizer';
import { SummarizationContext, Summarizer, SummaryResult } from './summarizer.types';

/**
 * Picks the description summariser per request and runs it.
 *
 * Provider precedence for a caller's organization:
 *   1. the org's own registered provider (AI Settings — BYO-LLM),
 *   2. the env-level provider (AI_SUMMARIZER_* / ANTHROPIC_API_KEY),
 *   3. the local heuristic (no network — always available).
 *
 * The PROMPT is resolved independently from the vault: the org's active
 * 'model_summary' template, else the code default — so a customized prompt
 * applies no matter which provider serves the call.
 *
 * If a selected AI provider errors at call time we degrade to the heuristic
 * rather than failing the request — a governance console should always be able
 * to produce *a* summary.
 */
@Injectable()
export class SummarizerService {
  private readonly log = new Logger('SummarizerService');
  private readonly heuristic = new HeuristicSummarizer();
  private readonly envCfg: { provider: string; model: string; apiKey: string | null; baseUrl: string } | null;
  private readonly maxSnippetChars: number;

  constructor(
    private readonly config: ConfigService,
    private readonly providers: AiProvidersService,
    private readonly vault: PromptVaultService,
  ) {
    const cfg = this.config.get('aiSummarizer') as {
      provider: string; model: string; apiKey: string | null; baseUrl: string; maxSnippetChars: number;
    };
    this.maxSnippetChars = cfg?.maxSnippetChars ?? 4000;
    this.envCfg = cfg?.provider === 'anthropic' && cfg.apiKey ? cfg : null;
    if (this.envCfg) this.log.log(`Env-level AI summariser enabled: anthropic (${this.envCfg.model})`);
  }

  private async pickForOrg(tenantId: string | null): Promise<{ s: Summarizer; label: string }> {
    const template = await this.vault.resolveActiveBody(tenantId, 'model_summary');
    // 1) The org's own registered provider.
    try {
      const cfg = await this.providers.resolveActiveForOrg(tenantId, 'model_summary');
      if (cfg) {
        return {
          s: new ConfiguredLlmSummarizer(cfg.adapter, cfg.baseUrl, cfg.model, cfg.apiKey, this.maxSnippetChars, template.body),
          label: `${cfg.label} · ${cfg.model}`,
        };
      }
    } catch (e) {
      this.log.warn(`Org provider resolution failed (${String(e)}); falling through.`);
    }
    // 2) Env-level provider.
    if (this.envCfg) {
      return {
        s: new ConfiguredLlmSummarizer('anthropic', this.envCfg.baseUrl, this.envCfg.model, this.envCfg.apiKey, this.maxSnippetChars, template.body),
        label: this.envCfg.model,
      };
    }
    // 3) Local heuristic.
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
