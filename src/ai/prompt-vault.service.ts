import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { OrganizationEntity, PromptTemplateEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { getUseCase, PROMPT_USE_CASES } from './default-prompts';
import { validateTemplate } from './template';

/**
 * The prompt vault: org-customizable, versioned prompt templates.
 *
 * Append-only by design — saving writes version N+1 and flips `active`;
 * a body is never edited in place, so the vault doubles as an audit trail of
 * exactly which prompt drove which AI output at any point in time. Restore
 * copies an old body forward as a NEW version (git-revert style); reset
 * deactivates all org rows so the code default applies again.
 */
@Injectable()
export class PromptVaultService {
  private readonly logger = new Logger(PromptVaultService.name);

  constructor(
    @InjectRepository(PromptTemplateEntity) private readonly templates: Repository<PromptTemplateEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
  ) {}

  /** Same acting-org resolution contract as the provider registry. */
  private async resolveTenant(user: CurrentUser, explicitOrgId?: string | null): Promise<string> {
    if (user.tenantId) {
      if (explicitOrgId && explicitOrgId !== user.tenantId) {
        throw new ForbiddenException('You can only manage prompts for your own organization.');
      }
      return user.tenantId;
    }
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('You must belong to an organization to manage prompts.');
    }
    if (!explicitOrgId) throw new BadRequestException('organization_id is required for a global admin.');
    const org = await this.orgs.findOne({ where: { id: explicitOrgId } });
    if (!org) throw new NotFoundException(`Organization '${explicitOrgId}' not found`);
    return org.id;
  }

  private assertUseCase(useCase: string) {
    const spec = getUseCase(useCase);
    if (!spec) throw new NotFoundException(`Unknown prompt use case '${useCase}'`);
    return spec;
  }

  /** The template body that would drive a generation for this org right now. */
  async resolveActiveBody(tenantId: string | null, useCase: string): Promise<{ body: string; customized: boolean; version: number | null }> {
    const spec = this.assertUseCase(useCase);
    if (tenantId) {
      const row = await this.templates.findOne({ where: { tenantId, useCase, active: true } });
      if (row) return { body: row.body, customized: true, version: row.version };
    }
    return { body: spec.defaultBody, customized: false, version: null };
  }

  /** Vault overview: every use case with its active template + variable specs. */
  async list(user: CurrentUser, explicitOrgId?: string | null) {
    const tenantId = await this.resolveTenant(user, explicitOrgId);
    return Promise.all(PROMPT_USE_CASES.map(async (spec) => {
      const active = await this.resolveActiveBody(tenantId, spec.useCase);
      const versionCount = await this.templates.count({ where: { tenantId, useCase: spec.useCase } });
      return {
        use_case: spec.useCase,
        title: spec.title,
        description: spec.description,
        variables: spec.variables,
        body: active.body,
        customized: active.customized,
        active_version: active.version,
        version_count: versionCount,
        default_body: spec.defaultBody,
      };
    }));
  }

  /** Save a new version and make it active. Append-only. */
  async save(user: CurrentUser, useCase: string, body: string, changeNote?: string | null, explicitOrgId?: string | null) {
    const spec = this.assertUseCase(useCase);
    const tenantId = await this.resolveTenant(user, explicitOrgId);
    const trimmed = (body ?? '').trim();
    if (!trimmed) throw new BadRequestException('Template body must not be empty.');
    const validation = validateTemplate(trimmed, spec);
    if (!validation.ok) {
      throw new BadRequestException(
        `Template is missing required variable(s): ${validation.missingRequired.map((v) => `{{${v}}}`).join(', ')}`,
      );
    }
    const version = (await this.templates.count({ where: { tenantId, useCase } })) + 1;
    await this.templates.update({ tenantId, useCase, active: true }, { active: false });
    const row = this.templates.create({
      id: uuidv4(),
      tenantId,
      useCase,
      version,
      body: trimmed,
      active: true,
      changeNote: changeNote?.trim() || null,
      createdBy: user.email,
      createdAt: new Date(),
    });
    await this.templates.save(row);
    this.logger.log(`Prompt '${useCase}' v${version} saved for org ${tenantId} by ${user.email}`);
    return {
      use_case: useCase,
      version,
      active: true,
      // Advisory only — unknown placeholders render as empty, never sent raw.
      warnings: validation.unknownVariables.length
        ? [`Unknown variable(s) will render empty: ${validation.unknownVariables.map((v) => `{{${v}}}`).join(', ')}`]
        : [],
    };
  }

  /** Full version history, newest first. */
  async history(user: CurrentUser, useCase: string, explicitOrgId?: string | null) {
    this.assertUseCase(useCase);
    const tenantId = await this.resolveTenant(user, explicitOrgId);
    const rows = await this.templates.find({ where: { tenantId, useCase }, order: { version: 'DESC' } });
    return rows.map((r) => ({
      version: r.version,
      body: r.body,
      active: r.active,
      change_note: r.changeNote,
      created_by: r.createdBy,
      created_at: r.createdAt,
    }));
  }

  /** Restore an old version by copying its body forward as a new version. */
  async restore(user: CurrentUser, useCase: string, version: number, explicitOrgId?: string | null) {
    this.assertUseCase(useCase);
    const tenantId = await this.resolveTenant(user, explicitOrgId);
    const source = await this.templates.findOne({ where: { tenantId, useCase, version } });
    if (!source) throw new NotFoundException(`Version ${version} not found for '${useCase}'`);
    return this.save(user, useCase, source.body, `restored from v${version}`, explicitOrgId);
  }

  /** Back to the system default: deactivate every org version (history kept). */
  async reset(user: CurrentUser, useCase: string, explicitOrgId?: string | null) {
    this.assertUseCase(useCase);
    const tenantId = await this.resolveTenant(user, explicitOrgId);
    await this.templates.update({ tenantId, useCase }, { active: false });
    this.logger.log(`Prompt '${useCase}' reset to system default for org ${tenantId} by ${user.email}`);
    return { use_case: useCase, customized: false };
  }
}
