import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { ConfigService } from '@nestjs/config';
import { LessThan, Not } from 'typeorm';

import {
  AIIncidentEntity,
  AIModelEntity,
  BcpStateEntity,
  DriftReportEntity,
  ModelLedgerEventEntity,
  OrganizationEntity,
  ProjectEntity,
  PromptEntity,
} from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { IncidentStatus, ModelLifecycleStage, RiskLevel, Role, SutraAlignment } from '../common/enums';
import { maskDict } from '../common/dpdp';
import { NotifierService } from '../common/notifier.service';
import { AIModelEntry, EvidenceArtifact, triageAiModel } from '../domain/model-inventory';
import { ValidationContext } from '../compliance/frameworks.validator';
import { modelEntityToEntry } from './model.mapper';
import { expandAndResolve, isDirectory } from '../common/fs-utils';
import { DiscoveredCandidate, scanDirectory } from '../discovery/codebase-scanner';
import { TreeSitterService } from '../discovery/tree-sitter-parser';
import {
  sutrasBlockingGaps,
  sutrasOverallPass,
  sutrasReportAsDict,
  validateSutrasCompliance,
} from '../compliance/sutras.validator';
import {
  frameworkReportAsDict,
  validateEuAiAct,
  validateIso42001,
  validateNistRmf,
} from '../compliance/frameworks.validator';
import { generateCompliancePdf } from '../compliance/pdf-generator';
import {
  GovernanceUpdateDto,
  GrievanceUpdateDto,
  LifecycleUpdateDto,
  ModelRegisterDto,
  ModelResponse,
  RescanSummary,
} from './inventory.dto';

function parseDate(s?: string | null): Date | null {
  return s ? new Date(s) : null;
}

const RISK_ORDER: Record<string, number> = { [RiskLevel.LOW]: 0, [RiskLevel.MEDIUM]: 1, [RiskLevel.HIGH]: 2 };

/** Plan → active-model soft limit (null = unlimited). Never blocks anything. */
const PLAN_MODEL_LIMITS: Record<string, number | null> = {
  COMMUNITY: 10,
  GROWTH: 100,
  ENTERPRISE: null,
};

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(PromptEntity) private readonly prompts: Repository<PromptEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(BcpStateEntity) private readonly bcpStates: Repository<BcpStateEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    private readonly treeSitter: TreeSitterService,
    private readonly notifier: NotifierService,
    private readonly config: ConfigService,
  ) {}

  /** Append a ledger event; eventData is PII-masked before persistence. */
  private async recordLedger(modelId: string, eventType: string, eventData: Record<string, any>, actor: string): Promise<void> {
    await this.ledger.save(this.ledger.create({
      id: uuidv4(),
      modelId,
      eventType,
      eventData: maskDict(eventData),
      actor,
      occurredAt: new Date(),
    }));
  }

  /** Gather operational evidence for framework validators (Art-12, MEASURE-2.2, ...). */
  async buildValidationContext(modelId: string): Promise<ValidationContext> {
    const [ledgerEventCount, driftReportCount, lastDrift, overdueIncidentCount, bcpState] = await Promise.all([
      this.ledger.count({ where: { modelId } }),
      this.drifts.count({ where: { modelId } }),
      this.drifts.findOne({ where: { modelId }, order: { computedAt: 'DESC' } }),
      this.incidents.count({
        where: {
          modelId,
          reportingDeadline: LessThan(new Date()),
          reportedAt: IsNull(),
          status: Not(IncidentStatus.CLOSED),
        },
      }),
      this.bcpStates.findOne({ where: { modelId } }),
    ]);
    return {
      ledgerEventCount,
      driftReportCount,
      lastDriftAt: lastDrift?.computedAt ?? null,
      overdueIncidentCount,
      bcpConfigured: Boolean(bcpState),
      euHighRiskDomains: this.config.get<string[]>('euAiActHighRiskDomains'),
    };
  }

  private buildResponse(orm: AIModelEntity, triagedRisk?: RiskLevel): ModelResponse {
    const report = validateSutrasCompliance(modelEntityToEntry(orm));
    return {
      model_id: orm.id,
      name: orm.name,
      risk_level: orm.riskLevel as RiskLevel,
      triaged_risk_level: triagedRisk ?? (orm.riskLevel as RiskLevel),
      lifecycle_stage: orm.lifecycleStage as ModelLifecycleStage,
      human_oversight_required: orm.humanOversightRequired,
      source_ref: orm.sourceRef,
      project_id: orm.projectId,
      registered_at: orm.registeredAt,
      compliance_pass: sutrasOverallPass(report),
      open_gap_count: sutrasBlockingGaps(report).length,
      use_case_description: orm.useCaseDescription,
      owner_team: orm.ownerTeam,
      board_policy_ref: orm.boardPolicyRef,
      autonomous_scope: orm.autonomousScope,
      last_red_team_date: orm.lastRedTeamDate,
      sutras_alignment: orm.sutrasAlignment ?? [],
    };
  }

  async register(user: CurrentUser, dto: ModelRegisterDto): Promise<ModelResponse> {
    // Any logged-in user can register models; org membership is optional.
    const dupe = await this.models.findOne({
      where: { name: dto.name, projectId: dto.project_id ?? IsNull(), isActive: true },
    });
    if (dupe) {
      throw new ConflictException(`A model named '${dto.name}' already exists in this project.`);
    }

    const now = new Date();
    const entry: AIModelEntry = {
      modelId: uuidv4(),
      name: dto.name,
      modelType: dto.model_type,
      functionalArea: dto.functional_area,
      useCaseDescription: dto.use_case_description,
      targetCustomerSegments: dto.target_customer_segments ?? [],
      riskLevel: RiskLevel.LOW, // overridden by triage
      lifecycleStage: ModelLifecycleStage.DESIGN,
      ownerTeam: dto.owner_team ?? 'UNASSIGNED',
      developedBy: dto.developed_by ?? 'unknown',
      deploymentDate: parseDate(dto.deployment_date),
      dependencies: dto.dependencies ?? [],
      performanceBenchmarks: dto.performance_benchmarks ?? [],
      sutrasAlignment: dto.sutras_alignment ?? [],
      humanOversightRequired: dto.human_oversight_required ?? true,
      autonomousScope: dto.autonomous_scope ?? null,
      boardPolicyRef: dto.board_policy_ref ?? '',
      lastRedTeamDate: parseDate(dto.last_red_team_date),
      nextAuditDue: parseDate(dto.next_audit_due),
      grievanceCount: 0,
      grievanceResolutionNotes: '',
      sourceRef: dto.source_ref ?? null,
      registeredAt: now,
      updatedAt: now,
      isActive: true,
      projectId: dto.project_id ?? null,
    };
    const triaged = triageAiModel(entry);
    entry.riskLevel = triaged;

    const orm = await this.models.save(this.models.create({
      id: entry.modelId,
      projectId: entry.projectId,
      name: entry.name,
      modelType: entry.modelType,
      functionalArea: entry.functionalArea,
      useCaseDescription: entry.useCaseDescription,
      targetCustomerSegments: entry.targetCustomerSegments,
      riskLevel: entry.riskLevel,
      lifecycleStage: entry.lifecycleStage,
      ownerTeam: entry.ownerTeam,
      developedBy: entry.developedBy,
      deploymentDate: entry.deploymentDate,
      dependencies: entry.dependencies,
      performanceBenchmarks: entry.performanceBenchmarks,
      sutrasAlignment: entry.sutrasAlignment,
      humanOversightRequired: entry.humanOversightRequired,
      autonomousScope: entry.autonomousScope,
      boardPolicyRef: entry.boardPolicyRef,
      lastRedTeamDate: entry.lastRedTeamDate,
      nextAuditDue: entry.nextAuditDue,
      grievanceCount: 0,
      grievanceResolutionNotes: '',
      sourceRef: entry.sourceRef,
      isActive: true,
      registeredAt: entry.registeredAt,
      updatedAt: entry.updatedAt,
    }));

    await this.ledger.save(this.ledger.create({
      id: uuidv4(),
      modelId: entry.modelId,
      eventType: 'MODEL_REGISTERED',
      eventData: {
        triaged_risk_level: triaged,
        functional_area: entry.functionalArea,
        ...(entry.sourceRef ? { source_ref: entry.sourceRef } : {}),
      },
      actor: 'system',
      occurredAt: entry.registeredAt,
    }));

    const planWarning = await this.checkPlanSoftLimit(entry.projectId);
    return { ...this.buildResponse(orm, triaged), plan_warning: planWarning };
  }

  /**
   * Plan soft limit: registration NEVER blocks — crossing the plan's model
   * limit warns in the response, notifies the org (throttled to weekly), and
   * starts the 30-day grace window. Compliance features stay on regardless.
   */
  private async checkPlanSoftLimit(projectId: string | null): Promise<string | null> {
    if (!projectId) return null;
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project?.tenantId) return null;
    const org = await this.orgs.findOne({ where: { id: project.tenantId } });
    if (!org) return null;

    const limit = PLAN_MODEL_LIMITS[org.plan ?? 'COMMUNITY'];
    if (limit === null || limit === undefined) return null;

    const activeCount = await this.models
      .createQueryBuilder('m')
      .innerJoin(ProjectEntity, 'p', 'p.id = m.projectId')
      .where('p.tenantId = :tid AND m.isActive = 1', { tid: org.id })
      .getCount();
    if (activeCount <= limit) return null;

    const warning =
      `Organization '${org.name}' has ${activeCount} active models — over the ${org.plan} plan limit of ${limit}. ` +
      `A 30-day grace window applies; compliance monitoring is unaffected.`;

    const weekAgo = Date.now() - 7 * 86_400_000;
    if (!org.limitNotifiedAt || org.limitNotifiedAt.getTime() < weekAgo) {
      org.limitNotifiedAt = new Date();
      await this.orgs.save(org);
      await this.notifier.notify('plan_soft_limit_exceeded', {
        organization_id: org.id,
        organization: org.name,
        plan: org.plan,
        limit,
        active_models: activeCount,
        grace_days: 30,
      });
    }
    return warning;
  }

  /** Model usage vs. plan limit for an organization (soft limits only). */
  async orgUsage(orgId: string) {
    const org = await this.orgs.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    const limit = PLAN_MODEL_LIMITS[org.plan ?? 'COMMUNITY'] ?? null;
    const activeModels = await this.models
      .createQueryBuilder('m')
      .innerJoin(ProjectEntity, 'p', 'p.id = m.projectId')
      .where('p.tenantId = :tid AND m.isActive = 1', { tid: org.id })
      .getCount();
    return {
      organization_id: org.id,
      organization: org.name,
      plan: org.plan ?? 'COMMUNITY',
      model_limit: limit,
      active_models: activeModels,
      over_limit: limit !== null && activeModels > limit,
      limit_notified_at: org.limitNotifiedAt ? org.limitNotifiedAt.toISOString() : null,
    };
  }

  async list(
    user: CurrentUser,
    opts: { riskLevel?: RiskLevel; projectId?: string; activeOnly: boolean },
  ): Promise<ModelResponse[]> {
    const tenantId = user.role === Role.ADMIN ? null : user.tenantId;
    const qb = this.models.createQueryBuilder('m');
    if (tenantId) {
      qb.innerJoin(ProjectEntity, 'p', 'p.id = m.projectId').andWhere('p.tenantId = :tid', { tid: tenantId });
    }
    if (opts.activeOnly) qb.andWhere('m.isActive = 1');
    if (opts.riskLevel) qb.andWhere('m.riskLevel = :rl', { rl: opts.riskLevel });
    if (opts.projectId) qb.andWhere('m.projectId = :pid', { pid: opts.projectId });
    const rows = await qb.getMany();
    return rows.map((r) => this.buildResponse(r));
  }

  private async getOrThrow(modelId: string): Promise<AIModelEntity> {
    const orm = await this.models.findOne({ where: { id: modelId } });
    if (!orm) throw new NotFoundException('Model not found');
    return orm;
  }

  /**
   * Governance gate (REC 14/16): a model cannot be promoted to a live stage
   * (DEPLOYED / MONITORING) until its accountability chain is complete.
   * Discovery may create ungoverned drafts, but nothing ungoverned goes live.
   */
  private governanceGaps(orm: AIModelEntity): string[] {
    const missing: string[] = [];
    if (!orm.ownerTeam || orm.ownerTeam.toLowerCase().includes('unassigned')) {
      missing.push('owner_team — a named owner team is required');
    }
    if (!orm.boardPolicyRef || !orm.boardPolicyRef.trim()) {
      missing.push('board_policy_ref — a board-approved AI policy reference is required');
    }
    const isMedOrHigh = orm.riskLevel === RiskLevel.MEDIUM || orm.riskLevel === RiskLevel.HIGH;
    if (isMedOrHigh && !orm.humanOversightRequired && !orm.autonomousScope) {
      missing.push('human_oversight_required or autonomous_scope — MEDIUM/HIGH risk needs oversight or a defined autonomous scope');
    }
    return missing;
  }

  async updateLifecycle(modelId: string, dto: LifecycleUpdateDto) {
    const orm = await this.getOrThrow(modelId);
    const liveStages = [ModelLifecycleStage.DEPLOYED, ModelLifecycleStage.MONITORING];
    if (liveStages.includes(dto.stage)) {
      const missing = this.governanceGaps(orm);
      if (missing.length > 0) {
        throw new UnprocessableEntityException({
          message: `Model cannot move to ${dto.stage} until governance is complete.`,
          missing_fields: missing,
        });
      }
    }
    const prev = orm.lifecycleStage;
    orm.lifecycleStage = dto.stage;
    orm.updatedAt = new Date();
    await this.models.save(orm);
    await this.ledger.save(this.ledger.create({
      id: uuidv4(),
      modelId,
      eventType: 'LIFECYCLE_UPDATED',
      eventData: { from: prev, to: dto.stage, notes: dto.notes },
      actor: dto.actor,
      occurredAt: new Date(),
    }));
    return { model_id: modelId, stage: dto.stage, actor: dto.actor };
  }

  async remove(user: CurrentUser, modelId: string, permanent: boolean, actor: string): Promise<void> {
    const orm = await this.getOrThrow(modelId);
    if (permanent) {
      // The ledger is append-only: purging a model removes the inventory row
      // but its full event history — plus a tombstone — is kept for audit.
      if (user.role !== Role.ADMIN && user.role !== Role.CISO) {
        throw new ForbiddenException('Only ADMIN or CISO roles may permanently purge a model.');
      }
      await this.ledger.save(this.ledger.create({
        id: uuidv4(),
        modelId,
        eventType: 'MODEL_PURGED',
        eventData: { name: orm.name, risk_level: orm.riskLevel, purged_by_role: user.role },
        actor,
        occurredAt: new Date(),
      }));
      await this.models.delete({ id: modelId });
    } else {
      orm.isActive = false;
      orm.updatedAt = new Date();
      await this.models.save(orm);
      await this.ledger.save(this.ledger.create({
        id: uuidv4(),
        modelId,
        eventType: 'MODEL_DEACTIVATED',
        eventData: { reason: 'removed_via_dashboard' },
        actor,
        occurredAt: orm.updatedAt,
      }));
    }
  }

  async recordGrievance(modelId: string, dto: GrievanceUpdateDto) {
    const orm = await this.getOrThrow(modelId);
    orm.grievanceCount += dto.count_delta;
    orm.grievanceResolutionNotes = dto.resolution_notes;
    orm.updatedAt = new Date();
    await this.models.save(orm);
    await this.ledger.save(this.ledger.create({
      id: uuidv4(),
      modelId,
      eventType: 'GRIEVANCE_RECORDED',
      eventData: { delta: dto.count_delta, total: orm.grievanceCount },
      actor: 'system',
      occurredAt: new Date(),
    }));
    return { model_id: modelId, grievance_count: orm.grievanceCount };
  }

  async updateGovernance(modelId: string, dto: GovernanceUpdateDto) {
    const orm = await this.getOrThrow(modelId);
    const changes: Record<string, [any, any]> = {};

    if (dto.owner_team !== undefined && dto.owner_team !== null) {
      changes.owner_team = [orm.ownerTeam, dto.owner_team];
      orm.ownerTeam = dto.owner_team;
    }
    if (dto.board_policy_ref !== undefined && dto.board_policy_ref !== null) {
      changes.board_policy_ref = [orm.boardPolicyRef, dto.board_policy_ref];
      orm.boardPolicyRef = dto.board_policy_ref;
    }
    if (dto.human_oversight_required !== undefined && dto.human_oversight_required !== null) {
      changes.human_oversight_required = [orm.humanOversightRequired, dto.human_oversight_required];
      orm.humanOversightRequired = dto.human_oversight_required;
    }
    if (dto.autonomous_scope !== undefined && dto.autonomous_scope !== null) {
      changes.autonomous_scope = [orm.autonomousScope, dto.autonomous_scope];
      orm.autonomousScope = dto.autonomous_scope;
    }
    if (dto.sutras_alignment !== undefined && dto.sutras_alignment !== null) {
      const vals = dto.sutras_alignment as SutraAlignment[];
      changes.sutras_alignment = [orm.sutrasAlignment, vals];
      orm.sutrasAlignment = vals;
    }
    if (dto.last_red_team_date !== undefined && dto.last_red_team_date !== null) {
      const d = parseDate(dto.last_red_team_date);
      changes.last_red_team_date = [String(orm.lastRedTeamDate), String(d)];
      orm.lastRedTeamDate = d;
    }
    if (dto.use_case_description !== undefined && dto.use_case_description !== null) {
      orm.useCaseDescription = dto.use_case_description;
    }

    orm.updatedAt = new Date();

    // Re-triage with updated facts — closing gaps can raise or lower risk.
    const entry = modelEntityToEntry(orm);
    const newRisk = triageAiModel(entry);
    if (newRisk !== (orm.riskLevel as RiskLevel)) {
      changes.risk_level = [orm.riskLevel, newRisk];
      orm.riskLevel = newRisk;
    }

    await this.models.save(orm);

    if (Object.keys(changes).length > 0) {
      const eventData: Record<string, any> = {};
      for (const [k, v] of Object.entries(changes)) eventData[k] = { from: v[0], to: v[1] };
      await this.ledger.save(this.ledger.create({
        id: uuidv4(),
        modelId,
        eventType: 'GOVERNANCE_UPDATED',
        eventData,
        actor: dto.actor ?? 'dashboard_user',
        occurredAt: orm.updatedAt,
      }));
    }

    const finalEntry = modelEntityToEntry(orm);
    const ctx = await this.buildValidationContext(modelId);
    const compliance = sutrasReportAsDict(validateSutrasCompliance(finalEntry));
    compliance.nist_rmf = frameworkReportAsDict(validateNistRmf(finalEntry, ctx));
    compliance.eu_ai_act = frameworkReportAsDict(validateEuAiAct(finalEntry, ctx));
    compliance.iso_42001 = frameworkReportAsDict(validateIso42001(finalEntry, ctx));

    return {
      model_id: modelId,
      risk_level: orm.riskLevel,
      fields_changed: Object.keys(changes),
      compliance,
    };
  }

  async complianceCheck(modelId: string): Promise<Record<string, any>> {
    const orm = await this.getOrThrow(modelId);
    const entry = modelEntityToEntry(orm);
    const ctx = await this.buildValidationContext(modelId);
    const res = sutrasReportAsDict(validateSutrasCompliance(entry));
    res.nist_rmf = frameworkReportAsDict(validateNistRmf(entry, ctx));
    res.eu_ai_act = frameworkReportAsDict(validateEuAiAct(entry, ctx));
    res.iso_42001 = frameworkReportAsDict(validateIso42001(entry, ctx));
    return res;
  }

  /** Attach an evidence artifact (bias-test report, red-team report, ...). */
  async addEvidence(modelId: string, dto: { type: string; ref: string; description?: string }, actor: string) {
    const orm = await this.getOrThrow(modelId);
    const artifact: EvidenceArtifact = {
      type: dto.type,
      ref: dto.ref,
      description: dto.description,
      added_at: new Date().toISOString(),
    };
    orm.evidenceArtifacts = [...(orm.evidenceArtifacts ?? []), artifact];
    orm.updatedAt = new Date();
    await this.models.save(orm);
    await this.recordLedger(modelId, 'EVIDENCE_ATTACHED', { type: dto.type, ref: dto.ref }, actor);
    return { model_id: modelId, evidence_count: orm.evidenceArtifacts.length, artifact };
  }

  async listEvidence(modelId: string) {
    const orm = await this.getOrThrow(modelId);
    return { model_id: modelId, evidence: orm.evidenceArtifacts ?? [] };
  }

  async getLedger(modelId: string): Promise<any[]> {
    const rows = await this.ledger.find({ where: { modelId }, order: { occurredAt: 'ASC' } });
    return rows.map((r) => ({
      event_id: r.id,
      event_type: r.eventType,
      event_data: r.eventData,
      actor: r.actor,
      occurred_at: r.occurredAt.toISOString(),
    }));
  }

  async exportPdf(modelId: string): Promise<Buffer> {
    const orm = await this.getOrThrow(modelId);
    const ctx = await this.buildValidationContext(modelId);
    return generateCompliancePdf(modelEntityToEntry(orm), ctx);
  }

  /**
   * Re-evaluates existing models against the current SentrAI logic and (for
   * source-linked models) the current codebase, without touching any
   * human-entered governance. Re-runs triage on every in-scope model so rule
   * changes propagate; for models with a source file it re-scans the project,
   * re-applies max(triaged, static hint) like import, and refreshes prompts.
   */
  async rescan(user: CurrentUser, projectId?: string | null): Promise<RescanSummary> {
    const tenantId = user.role === Role.ADMIN ? null : user.tenantId;
    const qb = this.models.createQueryBuilder('m').where('m.isActive = 1');
    if (tenantId) {
      qb.innerJoin(ProjectEntity, 'p', 'p.id = m.projectId').andWhere('p.tenantId = :tid', { tid: tenantId });
    }
    if (projectId) qb.andWhere('m.projectId = :pid', { pid: projectId });
    const models = await qb.getMany();

    // Scan each referenced project directory at most once.
    const scanCache = new Map<string, DiscoveredCandidate[] | null>();
    const scanProject = async (pid: string): Promise<DiscoveredCandidate[] | null> => {
      if (scanCache.has(pid)) return scanCache.get(pid)!;
      const project = await this.projects.findOne({ where: { id: pid } });
      let candidates: DiscoveredCandidate[] | null = null;
      if (project && isDirectory(project.rootDirectory)) {
        candidates = scanDirectory(expandAndResolve(project.rootDirectory), this.treeSitter);
      }
      scanCache.set(pid, candidates);
      return candidates;
    };

    const summary: RescanSummary = { rescanned: models.length, risk_changed: 0, source_missing: 0, models: [] };

    for (const m of models) {
      const oldRisk = m.riskLevel as RiskLevel;
      const retriaged = triageAiModel(modelEntityToEntry(m));
      let finalRisk = retriaged;
      let sourceFound: boolean | null = null;

      if (m.sourceRef && m.projectId) {
        const candidates = await scanProject(m.projectId);
        if (candidates) {
          const cand = candidates.find((c) => c.filePath === m.sourceRef);
          if (cand) {
            sourceFound = true;
            finalRisk = RISK_ORDER[retriaged] >= RISK_ORDER[cand.riskHint] ? retriaged : cand.riskHint;
            // Refresh code-derived prompts.
            await this.prompts.delete({ modelId: m.id });
            for (const p of cand.prompts) {
              await this.prompts.save(this.prompts.create({
                id: uuidv4(),
                modelId: m.id,
                rawText: p.raw_text,
                promptType: p.prompt_type,
                injectionRisk: p.injection_risk,
                piiDetected: p.pii_detected,
              }));
            }
          } else {
            sourceFound = false;
            summary.source_missing += 1;
          }
        }
      }

      const riskChanged = finalRisk !== oldRisk;
      if (riskChanged) {
        m.riskLevel = finalRisk;
        m.updatedAt = new Date();
        await this.models.save(m);
        summary.risk_changed += 1;
      }
      // Record a ledger event only for material changes — a risk update, or a
      // source file that no longer flags as AI — to keep the audit trail clean.
      if (riskChanged || sourceFound === false) {
        await this.ledger.save(this.ledger.create({
          id: uuidv4(),
          modelId: m.id,
          eventType: 'MODEL_RESCANNED',
          eventData: { from: oldRisk, to: finalRisk, source_found: sourceFound },
          actor: user.email ?? 'dashboard_user',
          occurredAt: new Date(),
        }));
      }

      summary.models.push({
        model_id: m.id,
        name: m.name,
        old_risk: oldRisk,
        new_risk: finalRisk,
        risk_changed: riskChanged,
        source_found: sourceFound,
      });
    }

    return summary;
  }
}
