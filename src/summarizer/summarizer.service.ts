import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiProvidersService } from '../ai/ai-providers.service';
import { PromptVaultService } from '../ai/prompt-vault.service';
import { chatComplete } from '../ai/llm-client';
import { renderTemplate } from '../ai/template';
import { ConfiguredLlmSummarizer } from './configured-llm.summarizer';
import { HeuristicSummarizer } from './heuristic.summarizer';
import { redactSecrets } from './redact';
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

  /**
   * Generic AI drafting for any vault use case (risk_rationale,
   * gap_remediation, …): the org's template + the org's provider, degrading to
   * the caller-supplied deterministic heuristic when no AI is configured or the
   * call fails. Every interpolated value is secret-masked here — untrusted
   * content cannot reach an external provider unredacted through this path.
   */
  async draftForOrg(
    tenantId: string | null,
    useCase: string,
    vars: Record<string, string>,
    heuristicText: () => string,
  ): Promise<{ text: string; source: 'ai' | 'heuristic'; model: string | null; provider: string }> {
    const template = await this.vault.resolveActiveBody(tenantId, useCase);
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) masked[k] = redactSecrets(v ?? '');
    const prompt = renderTemplate(template.body, masked);

    let cfg: { adapter: string; baseUrl: string; model: string; apiKey: string | null; label: string } | null = null;
    try {
      cfg = await this.providers.resolveActiveForOrg(tenantId, useCase);
    } catch (e) {
      this.log.warn(`Org provider resolution failed (${String(e)}); falling through.`);
    }
    if (!cfg && this.envCfg) {
      cfg = { adapter: 'anthropic', baseUrl: this.envCfg.baseUrl, model: this.envCfg.model, apiKey: this.envCfg.apiKey, label: this.envCfg.model };
    }

    if (cfg) {
      try {
        const { text } = await chatComplete({
          adapter: cfg.adapter, baseUrl: cfg.baseUrl, model: cfg.model, apiKey: cfg.apiKey,
          prompt, maxTokens: 700, timeoutMs: 45_000,
        });
        return { text, source: 'ai', model: cfg.model, provider: `${cfg.label} · ${cfg.model}` };
      } catch (e) {
        this.log.warn(`AI draft '${useCase}' via '${cfg.label}' failed (${String(e)}); using heuristic.`);
      }
    }
    return { text: heuristicText(), source: 'heuristic', model: null, provider: 'heuristic (local)' };
  }
}
