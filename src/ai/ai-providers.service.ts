import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AiProviderConfigEntity, OrganizationEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { decryptSecret, encryptSecret, maskKey } from './key-crypto';
import { chatComplete } from './llm-client';
import { CreateProviderDto, ProviderResponse, TestResult, UpdateProviderDto } from './ai.dto';

/** Hostname shapes that keep traffic on-box / in-network (Ollama, vLLM…). */
const LOCAL_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|host\.docker\.internal|.+\.local)$/i;

@Injectable()
export class AiProvidersService {
  private readonly logger = new Logger(AiProvidersService.name);

  constructor(
    @InjectRepository(AiProviderConfigEntity) private readonly configs: Repository<AiProviderConfigEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
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
    this.logger.log(`AI provider '${orm.label}' removed from org ${orm.tenantId} by ${user.email}`);
  }

  /** Fires a 1-token completion so a bad key/URL fails at setup, not first use. */
  async test(user: CurrentUser, providerId: string): Promise<TestResult> {
    const orm = await this.getScoped(user, providerId);
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
    const rows = await this.configs.find({ where: { tenantId, enabled: true }, order: { createdAt: 'ASC' } });
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
