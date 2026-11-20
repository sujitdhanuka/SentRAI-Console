import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AgentActionEventEntity, AIModelEntity, ModelLedgerEventEntity, ProjectEntity } from '../database/entities';
import { ModelType, Role } from '../common/enums';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { aggregateObserved, cleanEntries, LlmModelsAttestation, llmModelsStatus } from './llm-models';
import { ConfirmLlmModelsDto } from './telemetry.dto';
import { detectLlmConfig, llmConfigForRecord, LlmRecordConfig } from '../discovery/llm-config-detector';
import { expandAndResolve, isDirectory } from '../common/fs-utils';

/** How many recent llm_call events feed the "seen at runtime" view. */
const OBSERVED_WINDOW = 2000;

/** Gateways that take `vendor/model` slugs; a slug in a project that uses one is called through it. */
const SLUG_GATEWAYS = ['OpenRouter', 'LiteLLM', 'Together AI', 'Hugging Face'];
function gatewayFor(model: string, providers: string[]): string | undefined {
  return model.includes('/') ? SLUG_GATEWAYS.find((g) => providers.includes(g)) : undefined;
}

/** True when the record calls an LLM, so it has underlying models to confirm. */
export function recordCallsLlm(m: Pick<AIModelEntity, 'modelType' | 'detectionSignals' | 'llmConfig'>): boolean {
  if (m.modelType === ModelType.GENERATIVE_AI || m.modelType === ModelType.AGENT) return true;
  if ((m.detectionSignals ?? []).some((s) => s.startsWith('llm_') || s === 'ast_llm_sdk')) return true;
  return (m.llmConfig?.providers?.length ?? 0) > 0 && (m.llmConfig?.record_files?.length ?? 0) > 0;
}

/**
 * The underlying LLM models of one inventory record: where the scan found them
 * named or stored, the per-task list an owner confirmed, and what runtime
 * telemetry saw being called.
 */
@Injectable()
export class LlmModelsService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AgentActionEventEntity) private readonly actions: Repository<AgentActionEventEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
  ) {}

  private async load(user: CurrentUser, modelId: string): Promise<AIModelEntity> {
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');
    if (user.role !== Role.ADMIN && user.tenantId && model.projectId) {
      const p = await this.projects.findOne({ where: { id: model.projectId } });
      if (p?.tenantId && p.tenantId !== user.tenantId) throw new NotFoundException('Model not found');
    }
    return model;
  }

  async get(user: CurrentUser, modelId: string) {
    const model = await this.load(user, modelId);
    const events = await this.actions.find({
      where: { modelId, eventType: 'llm_call' },
      order: { occurredAt: 'DESC' },
      take: OBSERVED_WINDOW,
    });
    const att = model.llmModels ?? null;
    const observed = aggregateObserved(events, att);
    // Records imported before this feature have no evidence of their own: fall
    // back to the project's stored scan, narrowed to the record's files.
    const detected = model.llmConfig ?? (await this.projectEvidence(model));
    return {
      model_id: model.id,
      model_name: model.name,
      status: llmModelsStatus(recordCallsLlm(model), att, observed),
      detected,
      confirmed: att,
      observed,
      // Rows an owner can add with one click: concrete models the scan found
      // as defaults/seeds, plus anything runtime saw that is not confirmed yet.
      suggestions: [
        // A vendor/model slug behind a detected gateway is called through that gateway.
        ...(detected?.candidate_models ?? []).map((c) => ({ task: 'default', provider: gatewayFor(c.model, detected?.providers ?? []) ?? c.provider ?? '', model: c.model, source: 'scan' as const })),
        ...observed.filter((o) => o.confirmed !== true).map((o) => ({ task: o.task ?? 'default', provider: o.provider ?? '', model: o.model, source: 'runtime' as const })),
      ].filter((s, i, all) => all.findIndex((o) => o.model.toLowerCase() === s.model.toLowerCase() && o.task === s.task) === i)
        .filter((s) => !(att?.entries ?? []).some((e) => e.model.toLowerCase() === s.model.toLowerCase() && e.task.toLowerCase() === s.task.toLowerCase())),
    };
  }

  private recordFiles(m: AIModelEntity): string[] {
    return m.sourceRefs?.length ? m.sourceRefs : m.sourceRef ? [m.sourceRef] : [];
  }

  private async projectEvidence(m: AIModelEntity): Promise<LlmRecordConfig | null> {
    if (!m.projectId) return null;
    const p = await this.projects.findOne({ where: { id: m.projectId } });
    return llmConfigForRecord(p?.lastScanResult?.llm_config ?? null, this.recordFiles(m));
  }

  /**
   * Look for the record's models in the project's code now, without a full
   * re-import. Needs the uploaded code on the server; hosted deployments may
   * have discarded it, and then the code must be uploaded or imported again.
   */
  async rescan(user: CurrentUser, modelId: string) {
    if (user.role === Role.VIEWER) throw new ForbiddenException('Viewers cannot run a scan.');
    const model = await this.load(user, modelId);
    if (!model.projectId) throw new BadRequestException('This record is not linked to a project, so there is no code to scan.');
    const project = await this.projects.findOne({ where: { id: model.projectId } });
    if (!project?.rootDirectory || !isDirectory(project.rootDirectory)) {
      throw new BadRequestException("The project's code is no longer on the server. Upload it again or re-import it from GitHub on Projects, then scan.");
    }
    const summary = detectLlmConfig(expandAndResolve(project.rootDirectory));
    if (project.lastScanResult) {
      project.lastScanResult = { ...project.lastScanResult, llm_config: summary };
      await this.projects.save(project);
    }
    model.llmConfig = llmConfigForRecord(summary, this.recordFiles(model));
    model.updatedAt = new Date();
    await this.models.save(model);
    return this.get(user, modelId);
  }

  /** Replace the confirmed list. An empty list withdraws the confirmation. */
  async confirm(user: CurrentUser, modelId: string, dto: ConfirmLlmModelsDto) {
    if (user.role === Role.VIEWER) throw new ForbiddenException('Viewers cannot confirm models.');
    const model = await this.load(user, modelId);
    const entries = cleanEntries(dto.entries ?? []);
    const before = model.llmModels?.entries ?? [];
    const now = new Date();
    model.llmModels = entries.length
      ? ({ entries, confirmed_by: user.email, confirmed_at: now.toISOString() } satisfies LlmModelsAttestation)
      : null;
    model.updatedAt = now;
    await this.models.save(model);
    await this.ledger.save(this.ledger.create({
      id: uuidv4(),
      modelId: model.id,
      eventType: entries.length ? 'LLM_MODELS_CONFIRMED' : 'LLM_MODELS_CLEARED',
      eventData: {
        entries: entries.map((e) => ({ task: e.task, provider: e.provider, model: e.model })),
        previous: before.map((e) => ({ task: e.task, provider: e.provider, model: e.model })),
      },
      actor: user.email,
      occurredAt: now,
    }));
    return this.get(user, modelId);
  }
}
