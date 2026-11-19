import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { join } from 'path';

import {
  AiProviderConfigEntity,
  AIModelEntity,
  AiUsageEventEntity,
  ModelLedgerEventEntity,
  OrganizationEntity,
  ProjectEntity,
} from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { ModelLifecycleStage, ModelType, RiskLevel, Role } from '../common/enums';
import { WORKSPACES_DIR } from '../common/paths';
import { decryptSecret, encryptSecret, maskKey } from './key-crypto';
import { externalCallAllowed, governanceHooks } from '../governance/hooks';
import { chatComplete } from './llm-client';
import { CreateProviderDto, ProviderResponse, TestResult, UpdateProviderDto } from './ai.dto';

/** Hostname shapes that keep traffic on-box / in-network (Ollama, vLLM…). */
const LOCAL_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|host\.docker\.internal|.+\.local)$/i;

/** True when the endpoint stays on-box or in-network (an unparseable URL counts as external). */
export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    return LOCAL_HOST_RE.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Governance E3.8: whether the organisation's external-AI policy lets a call
 * go to this endpoint. With no policy hook (flag off) every call is allowed.
 */
export async function aiCallAllowed(tenantId: string | null, baseUrl: string, providerId: string | null): Promise<boolean> {
  const policy = await governanceHooks.externalAiPolicy?.(tenantId);
  return externalCallAllowed(policy, isLocalEndpoint(baseUrl), providerId);
}

@Injectable()
export class AiProvidersService {
  private readonly logger = new Logger(AiProvidersService.name);

  constructor(
    @InjectRepository(AiProviderConfigEntity) private readonly configs: Repository<AiProviderConfigEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(AiUsageEventEntity) private readonly usageEvents: Repository<AiUsageEventEntity>,
    private readonly config: ConfigService,
  ) {}

  private get encryptionKey(): string {
    return (this.config.get('encryption') as { key: string }).key;
  }

  /**
   * Which organization the caller is acting for. Org members always act on
   * their own org (a mismatching explicit id is refused, not silently
   * ignored); a global ADMIN with no org of their own must name the target.
   */
  private async resolveTenant(user: CurrentUser, explicitOrgId?: string | null): Promise<string> {
    if (user.tenantId) {
      if (explicitOrgId && explicitOrgId !== user.tenantId) {
        throw new ForbiddenException('You can only manage AI providers for your own organization.');
      }
      return user.tenantId;
    }
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('You must belong to an organization to manage AI providers.');
    }
    if (!explicitOrgId) {
      throw new BadRequestException('organization_id is required for a global admin.');
    }
    const org = await this.orgs.findOne({ where: { id: explicitOrgId } });
    if (!org) throw new NotFoundException(`Organization '${explicitOrgId}' not found`);
    return org.id;
  }

  private async getScoped(user: CurrentUser, providerId: string, explicitOrgId?: string | null): Promise<AiProviderConfigEntity> {
    const orm = await this.configs.findOne({ where: { id: providerId } });
    if (!orm) throw new NotFoundException('AI provider config not found');
    if (user.tenantId) {
      if (orm.tenantId !== user.tenantId) {
        // Same-shape 404 as "does not exist" — don't leak other orgs' config ids.
        throw new NotFoundException('AI provider config not found');
      }
    } else if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('You must belong to an organization to manage AI providers.');
    } else if (explicitOrgId && orm.tenantId !== explicitOrgId) {
      throw new NotFoundException('AI provider config not found');
    }
    return orm;
  }

  /**
   * Self-governance: the LLM an org configures for governance drafting is
   * itself an AI system in use, so it gets registered in the org's own model
   * inventory. It lands in a per-org 'AI Governance Tooling' project (models
   * are org-visible via projects) at DESIGN stage with governance gaps open —
   * configuring an LLM creates a governance obligation, exactly like any other
   * model. Failures here never block provider creation (logged instead).
   */
  private async registerInInventory(cfg: AiProviderConfigEntity, actor: string): Promise<string | null> {
    try {
      const org = await this.orgs.findOne({ where: { id: cfg.tenantId } });
      const projName = `AI Governance Tooling (${org?.name ?? cfg.tenantId.slice(0, 8)})`;
      let project = await this.projects.findOne({ where: { tenantId: cfg.tenantId, name: projName } });
      if (!project) {
        const now = new Date();
        const pid = uuidv4();
        project = await this.projects.save(this.projects.create({
          id: pid,
          name: projName,
          description: 'Auto-managed: AI systems SentRAI itself uses for this organization (LLM providers configured in AI Settings).',
          rootDirectory: join(WORKSPACES_DIR, pid),
          lastScannedAt: null,
          lastScanResult: null,
          createdAt: now,
          updatedAt: now,
          tenantId: cfg.tenantId,
        }));
      }
      const now = new Date();
      const model = await this.models.save(this.models.create({
        id: uuidv4(),
        projectId: project.id,
        name: `LLM: ${cfg.label}`,
        modelType: ModelType.GENERATIVE_AI,
        functionalArea: 'governance_tooling',
        useCaseDescription:
          `Large-language model used by SentRAI for AI-assisted governance drafting (summaries, risk rationales, remediation plans). ` +
          `Endpoint: ${cfg.baseUrl} · model: ${cfg.model} · protocol: ${cfg.adapter}. Prompts are secret-masked before egress.`,
        targetCustomerSegments: [],
        riskLevel: RiskLevel.LOW,
        lifecycleStage: ModelLifecycleStage.DESIGN,
        ownerTeam: 'UNASSIGNED — pending review',
        developedBy: 'third_party',
        deploymentDate: null,
        dependencies: [],
        performanceBenchmarks: [],
        sutrasAlignment: [],
        humanOversightRequired: true, // every AI draft is human-reviewed by design
        autonomousScope: null,
        boardPolicyRef: '',
        lastRedTeamDate: null,
        nextAuditDue: null,
        grievanceCount: 0,
        grievanceResolutionNotes: '',
        sourceRef: null,
        securityFindings: null,
        detectionSignals: ['llm_api'],
        isActive: true,
        registeredAt: now,
        updatedAt: now,
      }));
      await this.ledger.save(this.ledger.create({
        id: uuidv4(),
        modelId: model.id,
        eventType: 'MODEL_REGISTERED',
        eventData: { source: 'ai_settings_self_governance', provider_label: cfg.label, endpoint: cfg.baseUrl },
        actor,
        occurredAt: now,
      }));
      return model.id;
    } catch (e) {
      this.logger.warn(`Self-governance registration failed for provider '${cfg.label}': ${String(e)}`);
      return null;
    }
  }

  private toResponse(orm: AiProviderConfigEntity): ProviderResponse {
    let localEndpoint = false;
    try {
      localEndpoint = LOCAL_HOST_RE.test(new URL(orm.baseUrl).hostname);
    } catch { /* unparseable URL — treat as external */ }
    return {
      provider_id: orm.id,
      organization_id: orm.tenantId,
      label: orm.label,
      adapter: orm.adapter,
      base_url: orm.baseUrl,
      model: orm.model,
      api_key_masked: orm.apiKeyMasked,
      has_api_key: Boolean(orm.apiKeyEncrypted),
      linked_model_id: orm.linkedModelId,
      enabled: orm.enabled,
      local_endpoint: localEndpoint,
      last_test_status: orm.lastTestStatus,
      last_test_at: orm.lastTestAt,
      created_by: orm.createdBy,
      created_at: orm.createdAt,
      updated_at: orm.updatedAt,
    };
  }

  async list(user: CurrentUser, explicitOrgId?: string | null): Promise<ProviderResponse[]> {
    const tenantId = await this.resolveTenant(user, explicitOrgId);
    const rows = await this.configs.find({ where: { tenantId }, order: { createdAt: 'ASC' } });
    return rows.map((r) => this.toResponse(r));
  }

  async create(user: CurrentUser, dto: CreateProviderDto): Promise<ProviderResponse> {
    const tenantId = await this.resolveTenant(user, dto.organization_id);
    const now = new Date();
    const key = dto.api_key?.trim() || null;
    const orm = this.configs.create({
      id: uuidv4(),
      tenantId,
      label: dto.label.trim(),
      adapter: dto.adapter,
      baseUrl: dto.base_url.trim().replace(/\/$/, ''),
      model: dto.model.trim(),
      apiKeyEncrypted: key ? encryptSecret(key, this.encryptionKey) : null,
      apiKeyMasked: maskKey(key),
      enabled: dto.enabled ?? true,
      defaultForUseCase: null,
      lastTestStatus: null,
      lastTestAt: null,
      createdBy: user.email,
      createdAt: now,
      updatedAt: now,
    });
    await this.configs.save(orm);
    // Dogfooding: the configured LLM enters the org's own model inventory.
    orm.linkedModelId = await this.registerInInventory(orm, user.email);
    if (orm.linkedModelId) await this.configs.save(orm);
    this.logger.log(`AI provider '${orm.label}' (${orm.adapter}) created for org ${tenantId} by ${user.email}`);
    return this.toResponse(orm);
  }

  async update(user: CurrentUser, providerId: string, dto: UpdateProviderDto): Promise<ProviderResponse> {
    const orm = await this.getScoped(user, providerId);
    if (dto.label !== undefined) orm.label = dto.label.trim();
    if (dto.adapter !== undefined) orm.adapter = dto.adapter;
    if (dto.base_url !== undefined) orm.baseUrl = dto.base_url.trim().replace(/\/$/, '');
    if (dto.model !== undefined) orm.model = dto.model.trim();
    if (dto.enabled !== undefined) orm.enabled = dto.enabled;
    if (dto.api_key !== undefined) {
      const key = dto.api_key.trim();
      // Empty string clears the key (keyless endpoint); non-empty replaces it.
      orm.apiKeyEncrypted = key ? encryptSecret(key, this.encryptionKey) : null;
      orm.apiKeyMasked = maskKey(key || null);
      orm.lastTestStatus = null; // a changed credential invalidates the old test result
      orm.lastTestAt = null;
    }
    orm.updatedAt = new Date();
    await this.configs.save(orm);
    return this.toResponse(orm);
  }

  async remove(user: CurrentUser, providerId: string): Promise<void> {
    const orm = await this.getScoped(user, providerId);
    await this.configs.delete({ id: orm.id });
    // Retire (never hard-delete) the self-registered inventory entry — its
    // ledger history is audit evidence that this LLM was in use.
    if (orm.linkedModelId) {
      try {
        await this.models.update({ id: orm.linkedModelId }, { isActive: false, lifecycleStage: ModelLifecycleStage.DECOMMISSIONED, updatedAt: new Date() });
        await this.ledger.save(this.ledger.create({
          id: uuidv4(),
          modelId: orm.linkedModelId,
          eventType: 'MODEL_DECOMMISSIONED',
          eventData: { source: 'ai_settings_self_governance', reason: `provider '${orm.label}' removed` },
          actor: user.email,
          occurredAt: new Date(),
        }));
      } catch (e) {
        this.logger.warn(`Could not retire linked inventory model ${orm.linkedModelId}: ${String(e)}`);
      }
    }
    this.logger.log(`AI provider '${orm.label}' removed from org ${orm.tenantId} by ${user.email}`);
  }

  /** Fires a 1-token completion so a bad key/URL fails at setup, not first use. */
  async test(user: CurrentUser, providerId: string): Promise<TestResult> {
    const orm = await this.getScoped(user, providerId);
    // Governance E3.8: an organisation that keeps data off external AI refuses the call outright.
    if (!(await aiCallAllowed(orm.tenantId, orm.baseUrl, orm.id))) {
      throw new ForbiddenException("This organization's external-AI policy does not allow calls to this provider (local endpoints, or attested providers only).");
    }
    const started = Date.now();
    let status: 'ok' | 'failed' = 'ok';
    let detail = 'Connection OK — provider answered.';
    try {
      await chatComplete({
        adapter: orm.adapter,
        baseUrl: orm.baseUrl,
        model: orm.model,
        apiKey: orm.apiKeyEncrypted ? decryptSecret(orm.apiKeyEncrypted, this.encryptionKey) : null,
        prompt: 'ping',
        maxTokens: 1,
        timeoutMs: 10_000,
      });
    } catch (e) {
      status = 'failed';
      detail = e instanceof Error && e.name === 'AbortError' ? 'Timed out after 10s' : String((e as Error).message ?? e).slice(0, 300);
    }
    orm.lastTestStatus = status;
    orm.lastTestAt = new Date();
    await this.configs.save(orm);
    return { provider_id: orm.id, status, latency_ms: Date.now() - started, detail };
  }

  /**
   * Org LLM usage: totals, a daily series, and breakdowns by use case, model,
   * provider and actor — the numbers a CISO needs to answer "what is our AI
   * spend, is it reliable, and who is driving it".
   */
  async usageSummary(user: CurrentUser, explicitOrgId?: string | null, days = 30) {
    const tenantId = await this.resolveTenant(user, explicitOrgId);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.usageEvents.find({
      where: { tenantId, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'DESC' },
      take: 5000,
    });
    const ok = rows.filter((r) => r.status === 'ok');
    const failed = rows.filter((r) => r.status !== 'ok');
    const sum = (xs: (number | null)[]): number => { let t = 0; for (const x of xs) t += x ?? 0; return t; };

    /** Group rows by a key, returning counts + token totals, busiest first. */
    const breakdown = (key: (r: AiUsageEventEntity) => string) => {
      const m = new Map<string, { calls: number; ok: number; tokens_in: number; tokens_out: number; latency: number[] }>();
      for (const r of rows) {
        const k = key(r) || 'unknown';
        const e = m.get(k) ?? { calls: 0, ok: 0, tokens_in: 0, tokens_out: 0, latency: [] };
        e.calls += 1;
        if (r.status === 'ok') { e.ok += 1; e.latency.push(r.latencyMs); }
        e.tokens_in += r.tokensIn ?? 0;
        e.tokens_out += r.tokensOut ?? 0;
        m.set(k, e);
      }
      return [...m.entries()]
        .map(([name, e]) => ({
          name,
          calls: e.calls,
          ok_calls: e.ok,
          failed_calls: e.calls - e.ok,
          tokens_in: e.tokens_in,
          tokens_out: e.tokens_out,
          total_tokens: e.tokens_in + e.tokens_out,
          avg_latency_ms: e.latency.length ? Math.round(sum(e.latency) / e.latency.length) : null,
        }))
        .sort((a, b) => b.calls - a.calls);
    };

    // Dense daily series (zero-filled) so a chart has no gaps. The window ends
    // TODAY — anchoring it to `since` would push the current day off the end
    // and hide the activity a user has just generated.
    const byDay = new Map<string, { calls: number; failed: number; tokens: number }>();
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      byDay.set(d, { calls: 0, failed: 0, tokens: 0 });
    }
    for (const r of rows) {
      const d = new Date(r.createdAt).toISOString().slice(0, 10);
      const e = byDay.get(d);
      if (!e) continue;
      e.calls += 1;
      if (r.status !== 'ok') e.failed += 1;
      e.tokens += (r.tokensIn ?? 0) + (r.tokensOut ?? 0);
    }

    return {
      organization_id: tenantId,
      window_days: days,
      total_calls: rows.length,
      ok_calls: ok.length,
      failed_calls: failed.length,
      success_rate: rows.length ? Number((ok.length / rows.length).toFixed(3)) : null,
      tokens_in: sum(rows.map((r) => r.tokensIn)),
      tokens_out: sum(rows.map((r) => r.tokensOut)),
      total_tokens: sum(rows.map((r) => r.tokensIn)) + sum(rows.map((r) => r.tokensOut)),
      avg_latency_ms: ok.length ? Math.round(sum(ok.map((r) => r.latencyMs)) / ok.length) : null,
      p95_latency_ms: ok.length
        ? [...ok.map((r) => r.latencyMs)].sort((a, b) => a - b)[Math.floor(ok.length * 0.95) === ok.length ? ok.length - 1 : Math.floor(ok.length * 0.95)]
        : null,
      // Kept for the existing compact usage strip.
      by_use_case: Object.fromEntries(
        [...new Set(rows.map((r) => r.useCase))].map((uc) => [uc, rows.filter((r) => r.useCase === uc).length]),
      ),
      daily: [...byDay.entries()].map(([date, e]) => ({ date, ...e })),
      use_cases: breakdown((r) => r.useCase),
      models: breakdown((r) => r.model),
      providers: breakdown((r) => r.provider),
      actors: breakdown((r) => r.actor),
      recent_failures: failed.slice(0, 10).map((r) => ({
        use_case: r.useCase, provider: r.provider, model: r.model,
        latency_ms: r.latencyMs, actor: r.actor, at: r.createdAt,
      })),
      recent: rows.slice(0, 20).map((r) => ({
        use_case: r.useCase, provider: r.provider, model: r.model, status: r.status,
        tokens_in: r.tokensIn, tokens_out: r.tokensOut, latency_ms: r.latencyMs,
        actor: r.actor, at: r.createdAt,
      })),
    };
  }

  /**
   * The org's active provider for outbound AI calls, with the decrypted key —
   * used ONLY by server-side call sites (summarizer), never serialized.
   * Precedence within the org: a use-case pin wins, else the oldest enabled
   * config (stable + predictable).
   */
  async resolveActiveForOrg(
    tenantId: string | null,
    useCase?: string,
  ): Promise<{ adapter: string; baseUrl: string; model: string; apiKey: string | null; label: string } | null> {
    if (!tenantId) return null;
    const all = await this.configs.find({ where: { tenantId, enabled: true }, order: { createdAt: 'ASC' } });
    // Governance E3.8: providers the organisation's external-AI policy refuses are never chosen.
    const policy = await governanceHooks.externalAiPolicy?.(tenantId);
    const rows = policy ? all.filter((r) => externalCallAllowed(policy, isLocalEndpoint(r.baseUrl), r.id)) : all;
    if (!rows.length) return null;
    const chosen = (useCase && rows.find((r) => r.defaultForUseCase === useCase)) || rows.find((r) => !r.defaultForUseCase) || rows[0];
    return {
      adapter: chosen.adapter,
      baseUrl: chosen.baseUrl,
      model: chosen.model,
      apiKey: chosen.apiKeyEncrypted ? decryptSecret(chosen.apiKeyEncrypted, this.encryptionKey) : null,
      label: chosen.label,
    };
  }
}
