import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { aiCallAllowedFor, AiProvidersService } from '../ai/ai-providers.service';
import { PromptVaultService } from '../ai/prompt-vault.service';
import { chatComplete } from '../ai/llm-client';
import { renderTemplate } from '../ai/template';
import { AiUsageEventEntity } from '../database/entities';
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
 * The PROMPT is resolved independently from the vault (org version → default).
 *
 * Operational guardrails on every AI path:
 *   - metering: one ai_usage_events row per AI call (ok or failed) — token
 *     counts, latency, actor — the org's cost + audit trail of AI-in-the-loop;
 *   - circuit breaker: 3 consecutive failures per org open a 60s window where
 *     drafts go straight to the heuristic instead of hammering a dead endpoint;
 *   - rate limit: a sliding 5-minute per-org cap on AI calls (429 beyond it).
 * Heuristic generations are unlimited and unmetered — they cost nothing.
 */
@Injectable()
export class SummarizerService {
  private readonly log = new Logger('SummarizerService');
  private readonly heuristic = new HeuristicSummarizer();
  private readonly envCfg: { provider: string; model: string; apiKey: string | null; baseUrl: string } | null;
  private readonly maxSnippetChars: number;
  private readonly rateLimitPer5Min: number;

  /** orgKey → consecutive failures + breaker-open deadline (in-memory; per node). */
  private readonly breaker = new Map<string, { failures: number; openUntil: number }>();
  /** orgKey → timestamps of AI calls in the sliding window. */
  private readonly callLog = new Map<string, number[]>();

  constructor(
    private readonly config: ConfigService,
    private readonly providers: AiProvidersService,
    private readonly vault: PromptVaultService,
    @InjectRepository(AiUsageEventEntity) private readonly usage: Repository<AiUsageEventEntity>,
  ) {
    const cfg = this.config.get('aiSummarizer') as {
      provider: string; model: string; apiKey: string | null; baseUrl: string; maxSnippetChars: number;
    };
    this.maxSnippetChars = cfg?.maxSnippetChars ?? 4000;
    this.envCfg = cfg?.provider === 'anthropic' && cfg.apiKey ? cfg : null;
    this.rateLimitPer5Min = parseInt(process.env.AI_RATE_LIMIT_PER_5MIN ?? '60', 10);
    if (this.envCfg) this.log.log(`Env-level AI summariser enabled: anthropic (${this.envCfg.model})`);
  }

  // ── Guardrails ──────────────────────────────────────────────────────────────

  private orgKey(tenantId: string | null): string {
    return tenantId ?? '_global';
  }

  private breakerOpen(key: string): boolean {
    const b = this.breaker.get(key);
    return Boolean(b && b.openUntil > Date.now());
  }

  private recordOutcome(key: string, ok: boolean): void {
    if (ok) { this.breaker.delete(key); return; }
    const b = this.breaker.get(key) ?? { failures: 0, openUntil: 0 };
    b.failures += 1;
    if (b.failures >= 3) {
      b.openUntil = Date.now() + 60_000;
      b.failures = 0;
      this.log.warn(`AI circuit breaker OPEN for '${key}' — heuristic-only for 60s.`);
    }
    this.breaker.set(key, b);
  }

  /** Throws 429 when the org's sliding 5-minute AI budget is exhausted. */
  private checkRateLimit(key: string): void {
    const now = Date.now();
    const windowStart = now - 5 * 60_000;
    const calls = (this.callLog.get(key) ?? []).filter((t) => t > windowStart);
    if (calls.length >= this.rateLimitPer5Min) {
      throw new HttpException(
        `AI rate limit reached (${this.rateLimitPer5Min} calls / 5 min for your organization) — try again shortly.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    calls.push(now);
    this.callLog.set(key, calls);
  }

  /** Metering must never break a request — log and continue on failure. */
  private async meter(row: Omit<AiUsageEventEntity, 'id' | 'createdAt'>): Promise<void> {
    try {
      await this.usage.save(this.usage.create({ ...row, id: uuidv4(), createdAt: new Date() }));
    } catch (e) {
      this.log.warn(`AI usage metering failed: ${String(e)}`);
    }
  }

  // ── Provider/prompt resolution ──────────────────────────────────────────────

  /**
   * `dataOrgIds`: organisations whose data the request carries, when that is
   * not the caller's own (a platform admin acting on an organisation's model).
   * Their external-AI policy (governance E3.8) applies as well as the caller's.
   */
  private async pickForOrg(tenantId: string | null, dataOrgIds: Array<string | null> = []): Promise<{ s: Summarizer; label: string }> {
    const template = await this.vault.resolveActiveBody(tenantId, 'model_summary');
    try {
      const cfg = await this.providers.resolveActiveForOrg(tenantId, 'model_summary', dataOrgIds);
      if (cfg) {
        return {
          s: new ConfiguredLlmSummarizer(cfg.adapter, cfg.baseUrl, cfg.model, cfg.apiKey, this.maxSnippetChars, template.body),
          label: `${cfg.label} · ${cfg.model}`,
        };
      }
    } catch (e) {
      this.log.warn(`Org provider resolution failed (${String(e)}); falling through.`);
    }
    // Governance E3.8: the platform-level provider is external unless it points at a local endpoint.
    if (this.envCfg && (await aiCallAllowedFor([tenantId, ...dataOrgIds], this.envCfg.baseUrl, null))) {
      return {
        s: new ConfiguredLlmSummarizer('anthropic', this.envCfg.baseUrl, this.envCfg.model, this.envCfg.apiKey, this.maxSnippetChars, template.body),
        label: this.envCfg.model,
      };
    }
    return { s: this.heuristic, label: 'heuristic (local)' };
  }

  /** True when a real AI provider (org or env) would serve this org right now. */
  async aiEnabledForOrg(tenantId: string | null, dataOrgIds: Array<string | null> = []): Promise<boolean> {
    if (this.breakerOpen(this.orgKey(tenantId))) return false;
    return (await this.pickForOrg(tenantId, dataOrgIds)).s.source === 'ai';
  }

  // ── Generation entry points ─────────────────────────────────────────────────

  async summarizeForOrg(
    tenantId: string | null,
    ctx: SummarizationContext,
    actor = 'dashboard_user',
    dataOrgIds: Array<string | null> = [],
  ): Promise<SummaryResult & { provider: string }> {
    const key = this.orgKey(tenantId);
    if (this.breakerOpen(key)) {
      return { ...(await this.heuristic.generate(ctx)), provider: 'heuristic (local — provider cooling down)' };
    }
    const { s, label } = await this.pickForOrg(tenantId, dataOrgIds);
    if (s.source !== 'ai') return { ...(await s.generate(ctx)), provider: label };

    this.checkRateLimit(key);
    const started = Date.now();
    try {
      const result = await s.generate(ctx);
      this.recordOutcome(key, true);
      await this.meter({
        tenantId, useCase: 'model_summary', provider: label, model: String(s.model), status: 'ok',
        tokensIn: result.tokensIn ?? null, tokensOut: result.tokensOut ?? null,
        latencyMs: result.latencyMs ?? Date.now() - started, actor,
      });
      return { ...result, provider: label };
    } catch (e) {
      this.recordOutcome(key, false);
      await this.meter({
        tenantId, useCase: 'model_summary', provider: label, model: String(s.model), status: 'failed',
        tokensIn: null, tokensOut: null, latencyMs: Date.now() - started, actor,
      });
      this.log.warn(`AI summariser '${label}' failed (${String(e)}); falling back to heuristic.`);
      return { ...(await this.heuristic.generate(ctx)), provider: 'heuristic (local)' };
    }
  }

  /**
   * Generic AI drafting for any vault use case (risk_rationale,
   * gap_remediation, …): the org's template + the org's provider, degrading to
   * the caller-supplied deterministic heuristic when no AI is configured, the
   * breaker is open, or the call fails. Every interpolated value is
   * secret-masked here — untrusted content cannot reach an external provider
   * unredacted through this path.
   */
  async draftForOrg(
    tenantId: string | null,
    useCase: string,
    vars: Record<string, string>,
    heuristicText: () => string,
    actor = 'dashboard_user',
    dataOrgIds: Array<string | null> = [],
  ): Promise<{ text: string; source: 'ai' | 'heuristic'; model: string | null; provider: string }> {
    const key = this.orgKey(tenantId);
    const template = await this.vault.resolveActiveBody(tenantId, useCase);
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) masked[k] = redactSecrets(v ?? '');
    const prompt = renderTemplate(template.body, masked);

    let cfg: { adapter: string; baseUrl: string; model: string; apiKey: string | null; label: string } | null = null;
    if (!this.breakerOpen(key)) {
      try {
        cfg = await this.providers.resolveActiveForOrg(tenantId, useCase, dataOrgIds);
      } catch (e) {
        this.log.warn(`Org provider resolution failed (${String(e)}); falling through.`);
      }
      if (!cfg && this.envCfg && (await aiCallAllowedFor([tenantId, ...dataOrgIds], this.envCfg.baseUrl, null))) {
        cfg = { adapter: 'anthropic', baseUrl: this.envCfg.baseUrl, model: this.envCfg.model, apiKey: this.envCfg.apiKey, label: this.envCfg.model };
      }
    }

    if (cfg) {
      this.checkRateLimit(key);
      const label = `${cfg.label} · ${cfg.model}`;
      const started = Date.now();
      try {
        const r = await chatComplete({
          adapter: cfg.adapter, baseUrl: cfg.baseUrl, model: cfg.model, apiKey: cfg.apiKey,
          prompt, maxTokens: 700, timeoutMs: 45_000,
        });
        this.recordOutcome(key, true);
        await this.meter({
          tenantId, useCase, provider: label, model: cfg.model, status: 'ok',
          tokensIn: r.tokensIn, tokensOut: r.tokensOut, latencyMs: r.latencyMs, actor,
        });
        return { text: r.text, source: 'ai', model: cfg.model, provider: label };
      } catch (e) {
        this.recordOutcome(key, false);
        await this.meter({
          tenantId, useCase, provider: label, model: cfg.model, status: 'failed',
          tokensIn: null, tokensOut: null, latencyMs: Date.now() - started, actor,
        });
        this.log.warn(`AI draft '${useCase}' via '${cfg.label}' failed (${String(e)}); using heuristic.`);
      }
    }
    return { text: heuristicText(), source: 'heuristic', model: null, provider: 'heuristic (local)' };
  }
}
