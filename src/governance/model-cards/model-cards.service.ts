/**
 * Model cards (governance E4.1): the live card for a model, its readiness,
 * frozen DRAFT and FINAL versions with staleness, and the PDF / Markdown /
 * JSON exports. The card reads the model record and the governance registers;
 * its framework mapping follows the packs enabled for the organisation.
 */
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { frameworkLabel, frameworkReportOf, frameworkScopeForOrg } from '../../compliance/framework-scope';
import {
  AIIncidentEntity, AIModelEntity, DatasetEntity, DriftReportEntity, ModelApprovalEntity, ModelCardEntity,
  ModelDatasetEntity, ModelValidationEntity, OrganizationEntity, ProjectEntity,
} from '../../database/entities';
import { InventoryService } from '../../inventory/inventory.service';
import { assertFlag, modelForUser } from '../governance-access';
import { governanceHooks } from '../hooks';
import { packRegistry } from '../packs/pack-loader';
import { MAINTAINERS, OFFICERS, oneOf, optText, requireRole, saveVersioned } from '../phase2-util';
import {
  buildCard, CardContent, CardExportMeta, cardHash, cardMarkdown, CardFacts, CARD_STATUSES, CardStatus, changedSections, readiness,
} from './model-card.model';
import { generateModelCardPdf } from './model-card.pdf';

export interface ModelCardSummary {
  models: number;
  final_current: number;
  final_stale: number;
  draft_only: number;
  none: number;
}

@Injectable()
export class ModelCardsService implements OnModuleInit {
  constructor(
    @InjectRepository(ModelCardEntity) private readonly cards: Repository<ModelCardEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(ModelDatasetEntity) private readonly modelDatasets: Repository<ModelDatasetEntity>,
    @InjectRepository(DatasetEntity) private readonly datasets: Repository<DatasetEntity>,
    @InjectRepository(ModelApprovalEntity) private readonly approvals: Repository<ModelApprovalEntity>,
    @InjectRepository(ModelValidationEntity) private readonly validations: Repository<ModelValidationEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    private readonly inventory: InventoryService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    // The board report and the readiness PDF count model cards through this hook.
    governanceHooks.modelCardSummary = async (modelIds) => (this.flags.isEnabled('modelCards') ? this.summary(modelIds) : undefined);
  }

  private assert(): void {
    assertFlag(this.flags, 'modelCards');
  }

  /** Everything the card is generated from. */
  private async facts(model: AIModelEntity, orgId: string | null): Promise<CardFacts> {
    const project = model.projectId ? await this.projects.findOne({ where: { id: model.projectId } }) : null;
    const org = orgId ? await this.orgs.findOne({ where: { id: orgId } }) : null;
    const scope = await frameworkScopeForOrg(orgId);
    const packIds = scope.pack_ids ?? packRegistry().defaultPackIds();
    const report = await this.inventory.complianceCheck(model.id);
    const compliance = scope.frameworks.map((id) => {
      const r = frameworkReportOf(report, id);
      return { framework: frameworkLabel(id), pass: Boolean(r?.overall_pass), gaps: (r?.blocking_gaps ?? []).length };
    });
    const links = await this.modelDatasets.find({ where: { modelId: model.id } });
    const sets = links.length ? await this.datasets.find({ where: { id: In(links.map((l) => l.datasetId)) } }) : [];
    const approvals = await this.approvals.find({ where: { modelId: model.id }, order: { createdAt: 'DESC' }, take: 5 });
    const validations = this.flags.isEnabled('modelValidation') ? await this.validations.find({ where: { modelId: model.id }, order: { version: 'DESC' }, take: 3 }) : [];
    const drift = await this.drifts.findOne({ where: { modelId: model.id }, order: { computedAt: 'DESC' } });
    const incidents = await this.incidents.find({ where: { modelId: model.id }, select: ['id', 'status'] });
    return {
      model: {
        id: model.id, name: model.name, modelType: model.modelType, functionalArea: model.functionalArea,
        useCaseDescription: model.useCaseDescription, targetCustomerSegments: model.targetCustomerSegments ?? [],
        riskLevel: model.riskLevel, lifecycleStage: model.lifecycleStage, ownerTeam: model.ownerTeam, developedBy: model.developedBy,
        deploymentDate: model.deploymentDate, dependencies: model.dependencies ?? [], performanceBenchmarks: model.performanceBenchmarks ?? [],
        humanOversightRequired: model.humanOversightRequired, autonomousScope: model.autonomousScope, boardPolicyRef: model.boardPolicyRef,
        lastRedTeamDate: model.lastRedTeamDate, nextAuditDue: model.nextAuditDue, grievanceCount: model.grievanceCount,
        sourceRefs: model.sourceRefs ?? (model.sourceRef ? [model.sourceRef] : []), evidenceArtifacts: model.evidenceArtifacts ?? [],
        riskRationale: model.riskRationale, registeredAt: model.registeredAt, operationalState: model.operationalState,
        energyKwh: model.energyKwh ?? null, co2eKg: model.co2eKg ?? null,
      },
      organisation: org?.name ?? null,
      project: project?.name ?? null,
      packIds,
      compliance,
      governance: (await governanceHooks.cardGovernance?.(model.id)) ?? {},
      datasets: links.map((l) => {
        const d = sets.find((x) => x.id === l.datasetId);
        return { name: d?.name ?? l.datasetId, purpose: l.purpose, personal_data: Boolean(d?.personalData), provenance: d?.provenance ?? null };
      }),
      approvals: approvals.map((a) => ({ target_stage: a.targetStage, status: a.status, resolved_at: a.resolvedAt ? a.resolvedAt.toISOString() : null })),
      validations: validations.map((v) => ({ version: v.version, status: v.status, result: v.result, independent: v.independent })),
      drift: drift?.status ?? null,
      incidents: { total: incidents.length, open: incidents.filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status)).length },
    };
  }

  private async live(model: AIModelEntity, orgId: string | null) {
    const content = buildCard(await this.facts(model, orgId));
    const gate = (await governanceHooks.gateCheck?.(model.id)) ?? null;
    return { content, hash: cardHash(content), readiness: readiness(content, gate) };
  }

  private versionView(row: ModelCardEntity, live: CardContent, liveHash: string, latestFinal: number | null) {
    const changed = row.contentHash === liveHash ? [] : changedSections(row.content as CardContent, live);
    return {
      version: row.version,
      status: row.status,
      note: row.note,
      created_by: row.createdBy,
      created_at: row.createdAt,
      content_hash: row.contentHash,
      stale: row.contentHash !== liveHash,
      changed_sections: changed,
      current_final: row.status === 'FINAL' && row.version === latestFinal,
    };
  }

  /** The live card, its readiness and every frozen version with its staleness. */
  async get(user: CurrentUser, modelId: string) {
    this.assert();
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    const live = await this.live(model, orgId);
    const rows = await this.cards.find({ where: { modelId }, order: { version: 'DESC' } });
    const latestFinal = rows.find((r) => r.status === 'FINAL')?.version ?? null;
    const versions = rows.map((r) => this.versionView(r, live.content, live.hash, latestFinal));
    const final = versions.find((v) => v.current_final) ?? null;
    return {
      model_id: modelId,
      generated_at: new Date().toISOString(),
      card: live.content,
      content_hash: live.hash,
      readiness: live.readiness,
      versions,
      current_final: final,
      status: final ? (final.stale ? 'FINAL_STALE' : 'FINAL_CURRENT') : versions.length ? 'DRAFT_ONLY' : 'NONE',
    };
  }

  /** Freeze the live card as a DRAFT (any time) or a FINAL (required fields and gates clear). */
  async freeze(user: CurrentUser, modelId: string, body: { status?: string; note?: string }, req?: any) {
    this.assert();
    const status = oneOf<CardStatus>(body?.status, CARD_STATUSES, 'status', 'DRAFT');
    requireRole(user, status === 'FINAL' ? OFFICERS : MAINTAINERS, status === 'FINAL' ? 'issue a final model card' : 'save a model card draft');
    const note = optText(body?.note, 'note', 1000);
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    const live = await this.live(model, orgId);
    if (status === 'FINAL' && !live.readiness.final_allowed) {
      throw new BadRequestException({ message: 'The model card cannot be final yet', blockers: live.readiness.final_blockers });
    }
    const last = await this.cards.findOne({ where: { modelId }, order: { version: 'DESC' } });
    const row = this.cards.create({
      id: uuidv4(), orgId, modelId, version: (last?.version ?? 0) + 1, status, content: live.content, contentHash: live.hash,
      note, createdBy: user.email, createdAt: new Date(),
    });
    await saveVersioned(() => this.cards.save(row));
    if (req) req.auditSummary = { model_card_frozen: { model_id: modelId, version: row.version, status, content_hash: row.contentHash } };
    return { ...this.versionView(row, live.content, live.hash, status === 'FINAL' ? row.version : null), readiness: live.readiness };
  }

  /** Export the live card (a DRAFT) or a frozen version as JSON, Markdown or PDF. */
  async export(user: CurrentUser, modelId: string, format: string, version?: string): Promise<{ body: Buffer | string; type: string; filename: string }> {
    this.assert();
    const fmt = oneOf(format || 'json', ['JSON', 'MD', 'PDF'] as const, 'format');
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    const live = await this.live(model, orgId);
    let content = live.content;
    let meta: CardExportMeta = { status: 'LIVE DRAFT', version: null, generated_at: new Date().toISOString(), content_hash: live.hash, readiness: live.readiness };
    if (version) {
      const n = Number(version);
      if (!Number.isInteger(n) || n < 1) throw new BadRequestException('version must be a positive whole number');
      const row = await this.cards.findOne({ where: { modelId, version: n } });
      if (!row) throw new NotFoundException('Model card version not found');
      content = row.content as CardContent;
      const stale = row.contentHash !== live.hash;
      meta = {
        status: row.status as CardStatus, version: row.version, generated_at: row.createdAt.toISOString(), created_by: row.createdBy,
        content_hash: row.contentHash, stale, changed_sections: stale ? changedSections(content, live.content) : [], readiness: null,
      };
    }
    const base = `model-card-${model.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || model.id.slice(0, 8)}${meta.version ? `-v${meta.version}` : '-draft'}`;
    if (fmt === 'JSON') {
      return { body: JSON.stringify({ ...meta, card: content }, null, 2), type: 'application/json', filename: `${base}.json` };
    }
    if (fmt === 'MD') return { body: cardMarkdown(content, meta), type: 'text/markdown; charset=utf-8', filename: `${base}.md` };
    return { body: await generateModelCardPdf(content, meta), type: 'application/pdf', filename: `${base}.pdf` };
  }

  /** Counts for the board report: current final card, stale final, draft only, none. */
  async summary(modelIds: string[]): Promise<ModelCardSummary> {
    const out: ModelCardSummary = { models: modelIds.length, final_current: 0, final_stale: 0, draft_only: 0, none: 0 };
    if (!modelIds.length) return out;
    const rows = await this.cards.find({ where: { modelId: In(modelIds) }, order: { version: 'DESC' } });
    for (const id of modelIds) {
      const mine = rows.filter((r) => r.modelId === id);
      const final = mine.find((r) => r.status === 'FINAL');
      if (!mine.length) out.none++;
      else if (!final) out.draft_only++;
      else {
        const model = await this.models.findOne({ where: { id } });
        const project = model?.projectId ? await this.projects.findOne({ where: { id: model.projectId }, select: ['id', 'tenantId'] }) : null;
        const live = model ? await this.live(model, project?.tenantId ?? null) : null;
        if (live && live.hash === final.contentHash) out.final_current++;
        else out.final_stale++;
      }
    }
    return out;
  }
}
