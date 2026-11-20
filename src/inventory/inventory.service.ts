import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { emitModelEvent, governanceHooks } from '../governance/hooks';
import { FrameworkScope, frameworkScopeForOrg, scopedVerdict, UNRESTRICTED_SCOPE } from '../compliance/framework-scope';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { ConfigService } from '@nestjs/config';
import { LessThan, Not } from 'typeorm';

import {
  AIIncidentEntity,
  AIModelEntity,
  BcpDrillEntity,
  BcpStateEntity,
  DriftReportEntity,
  ModelApprovalEntity,
  ModelLedgerEventEntity,
  OrganizationEntity,
  ProjectEntity,
  PromptEntity,
} from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { IncidentStatus, ModelLifecycleStage, RiskLevel, Role, SutraAlignment } from '../common/enums';
import { maskDict } from '../common/dpdp';
import { NotifierService } from '../common/notifier.service';
import { AIModelEntry, EvidenceArtifact, triageAiModel, floorRiskForSecurityFindings, explainTriageFactors } from '../domain/model-inventory';
import { authorizeTools } from '../domain/tool-authorization';
import { ValidationContext } from '../compliance/frameworks.validator';
import { modelEntityToEntry } from './model.mapper';
import { expandAndResolve, isDirectory } from '../common/fs-utils';
import { DiscoveredCandidate, scanDirectory } from '../discovery/codebase-scanner';
import { detectLlmConfig, isLlmCandidate, LlmConfigSummary, llmConfigForRecord } from '../discovery/llm-config-detector';
import { TreeSitterService } from '../discovery/tree-sitter-parser';
import { SummarizerService } from '../summarizer/summarizer.service';
import { GenerationQueueService } from './generation-queue.service';
import { SummarizationContext } from '../summarizer/summarizer.types';
import { redactSecrets } from '../summarizer/redact';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';
import {
  sutrasBlockingGaps,
  sutrasOverallPass,
  sutrasReportAsDict,
  validateSutrasCompliance,
} from '../compliance/sutras.validator';
import {
  frameworkBlockingGaps,
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
import { sourceLocationsOf } from '../discovery/source-locations';
import { latestSuccessfulDrill, latestSuccessfulDrills } from '../monitoring/bcp-drills';
import { gapLinesOf, heuristicPlan } from './remediation-plan';

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
export class InventoryService implements OnModuleInit {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(PromptEntity) private readonly prompts: Repository<PromptEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(BcpStateEntity) private readonly bcpStates: Repository<BcpStateEntity>,
    @InjectRepository(BcpDrillEntity) private readonly bcpDrills: Repository<BcpDrillEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(ModelApprovalEntity) private readonly approvals: Repository<ModelApprovalEntity>,
    private readonly treeSitter: TreeSitterService,
    private readonly notifier: NotifierService,
    private readonly config: ConfigService,
    private readonly summarizer: SummarizerService,
    private readonly genQueue: GenerationQueueService,
  ) {}

  /**
   * The queue holds only ids; the actual drafting lives here, so it is wired in
   * once at boot. Going through the same public methods the buttons call means
   * auto-generated content is identical to hand-triggered content — same
   * prompts, same provenance, same ledger events.
   */
  onModuleInit(): void {
    this.genQueue.setRunner(async (user, modelId, kind) => {
      if (kind === 'summary') await this.summarizeModel(user, modelId);
      else if (kind === 'risk_rationale') await this.draftRiskRationale(user, modelId);
      else await this.draftGapRemediation(user, modelId);
    });
  }

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

  /** Gather operational evidence for framework validators (Art-12, MEASURE-2.4, ...). */
  async buildValidationContext(modelId: string): Promise<ValidationContext> {
    const [ledgerEventCount, driftReportCount, lastDrift, overdueIncidentCount, bcpState, lastDrill] = await Promise.all([
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
      latestSuccessfulDrill(this.bcpDrills, modelId),
    ]);
    return {
      ledgerEventCount,
      driftReportCount,
      lastDriftAt: lastDrift?.computedAt ?? null,
      overdueIncidentCount,
      bcpConfigured: Boolean(bcpState),
      bcpDrillLastConducted: lastDrill,
      euHighRiskDomains: this.config.get<string[]>('euAiActHighRiskDomains'),
      // Governance E1.2: the organisation's enabled packs and risk appetite
      // (strictest wins). Only while the governance hooks are registered and
      // their flags are on; otherwise the validators use their defaults.
      ...(await this.governanceContext(modelId)),
    };
  }

  /** The organisation that owns a model (its project's tenant), for the external-AI policy (E3.8). */
  private async dataOrgs(modelId: string): Promise<Array<string | null>> {
    if (!governanceHooks.externalAiPolicy) return [];
    const model = await this.models.findOne({ where: { id: modelId }, select: ['id', 'projectId'] });
    const project = model?.projectId ? await this.projects.findOne({ where: { id: model.projectId }, select: ['id', 'tenantId'] }) : null;
    return project?.tenantId ? [project.tenantId] : [];
  }

  private async governanceContext(modelId: string): Promise<Pick<ValidationContext, 'packParams' | 'governance'>> {
    if (!governanceHooks.orgPackParams && !governanceHooks.modelGovernanceFacts) return {};
    const model = await this.models.findOne({ where: { id: modelId }, select: ['id', 'projectId'] });
    const project = model?.projectId ? await this.projects.findOne({ where: { id: model.projectId } }) : null;
    const orgId = project?.tenantId ?? null;
    const out: Pick<ValidationContext, 'packParams' | 'governance'> = {};
    const params = await governanceHooks.orgPackParams?.(orgId);
    if (params) out.packParams = params;
    const facts = await governanceHooks.modelGovernanceFacts?.(modelId, orgId);
    if (facts) out.governance = facts;
    return out;
  }

  /** `lastDrill` is the model's latest successful BCP drill (E0.4); pass it from
   *  latestSuccessfulDrills so the list agrees with the compliance check. */
  private async buildResponse(orm: AIModelEntity, triagedRisk?: RiskLevel, lastDrill: Date | null = null, scope: FrameworkScope = UNRESTRICTED_SCOPE): Promise<ModelResponse> {
    const verdict = await this.verdictFor(orm, lastDrill, scope);
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
      compliance_pass: verdict.pass,
      open_gap_count: verdict.gaps,
      use_case_description: orm.useCaseDescription,
      owner_team: orm.ownerTeam,
      board_policy_ref: orm.boardPolicyRef,
      autonomous_scope: orm.autonomousScope,
      last_red_team_date: orm.lastRedTeamDate,
      deployment_date: orm.deploymentDate ?? null,
      sutras_alignment: orm.sutrasAlignment ?? [],
      security_findings: orm.securityFindings ?? [],
      description_source: orm.descriptionSource ?? 'static',
      description_model: orm.descriptionModel ?? null,
      detection_signals: orm.detectionSignals ?? [],
      risk_rationale: orm.riskRationale ?? null,
      risk_rationale_source: orm.riskRationaleSource ?? null,
      risk_rationale_model: orm.riskRationaleModel ?? null,
      gap_remediation: orm.gapRemediation ?? null,
      gap_remediation_source: orm.gapRemediationSource ?? null,
      gap_remediation_model: orm.gapRemediationModel ?? null,
      // Every file this record covers, plus how the extra ones got here.
      source_refs: orm.sourceRefs ?? (orm.sourceRef ? [orm.sourceRef] : []),
      merge_history: orm.mergeHistory ?? [],
      // The same files with the line numbers where the model appears in each.
      source_locations: sourceLocationsOf(orm),
      // Static tool authorization (Pillar 2 — Control).
      detected_tools: orm.detectedTools ?? [],
      permitted_tools: orm.permittedTools ?? [],
      tool_authorization: authorizeTools(orm.permittedTools, orm.detectedTools),
      operational_state: orm.operationalState ?? 'ACTIVE',
      operational_state_reason: orm.operationalStateReason ?? null,
      operational_state_since: orm.operationalStateSince ? orm.operationalStateSince.toISOString() : null,
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
    const lastDrill = await latestSuccessfulDrill(this.bcpDrills, orm.id);
    return { ...(await this.buildResponse(orm, triaged, lastDrill, await this.frameworkScope(orm))), plan_warning: planWarning };
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
    const drills = await latestSuccessfulDrills(this.bcpDrills, rows.map((r) => r.id));
    // One scope lookup per organisation, not per model.
    const tenantOf = new Map<string, string | null>();
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter((p): p is string => Boolean(p)))];
    if (projectIds.length) for (const p of await this.projects.find({ where: { id: In(projectIds) }, select: ['id', 'tenantId'] })) tenantOf.set(p.id, p.tenantId ?? null);
    const scopes = new Map<string | null, FrameworkScope>();
    for (const t of new Set([...tenantOf.values(), null])) scopes.set(t, await frameworkScopeForOrg(t));
    const out: ModelResponse[] = [];
    for (const r of rows) out.push(await this.buildResponse(r, undefined, drills.get(r.id) ?? null, scopes.get(r.projectId ? tenantOf.get(r.projectId) ?? null : null)));
    return out;
  }

  private async getOrThrow(modelId: string): Promise<AIModelEntity> {
    const orm = await this.models.findOne({ where: { id: modelId } });
    if (!orm) throw new NotFoundException('Model not found');
    return orm;
  }

  /** Full response for a single model — used by the governance workspace to
   *  read tool authorization and operational state. */
  async getModel(modelId: string): Promise<ModelResponse> {
    const orm = await this.getOrThrow(modelId);
    return this.buildResponse(orm, undefined, await latestSuccessfulDrill(this.bcpDrills, orm.id), await this.frameworkScope(orm));
  }

  /**
   * Reads a bounded, secret-masked excerpt of the model's source — only used by
   * the AI summariser (the heuristic works from metadata). Defensive: returns
   * null if the file is gone (ephemeral workspace) or the path escapes the
   * project root. The secret masking happens *here*, before the text is handed
   * to any provider, so a plaintext credential can never reach an external API.
   */
  private async readMaskedSnippet(orm: AIModelEntity, aiEnabled: boolean): Promise<string | null> {
    try {
      if (!aiEnabled || !orm.projectId || !orm.sourceRef) return null;
      const project = await this.projects.findOne({ where: { id: orm.projectId } });
      if (!project?.rootDirectory) return null;
      const root = expandAndResolve(project.rootDirectory);
      const full = expandAndResolve(join(root, orm.sourceRef));
      if (full !== root && !full.startsWith(root + sep)) return null; // path-traversal guard
      if (!existsSync(full) || !statSync(full).isFile()) return null;
      const max = (this.config.get('aiSummarizer') as { maxSnippetChars: number })?.maxSnippetChars ?? 4000;
      return redactSecrets(readFileSync(full, 'utf-8')).slice(0, max);
    } catch {
      return null;
    }
  }

  /**
   * Regenerates a model's use-case description as a plain-language governance
   * summary. Persists it with provenance (source + model) so the UI can flag an
   * unreviewed AI/auto draft; a later human edit flips provenance to 'human'.
   */
  async summarizeModel(user: CurrentUser, modelId: string) {
    const orm = await this.getOrThrow(modelId);
    // Provider precedence is per-org: the caller's registered provider (AI
    // Settings) → env-level config → local heuristic.
    const dataOrgs = await this.dataOrgs(modelId);
    const aiEnabled = await this.summarizer.aiEnabledForOrg(user?.tenantId ?? null, dataOrgs);
    const ctx: SummarizationContext = {
      name: orm.name,
      modelType: orm.modelType,
      functionalArea: orm.functionalArea,
      existingDescription: orm.useCaseDescription || '',
      signals: orm.detectionSignals ?? [],
      domainTags: [],
      humanOversightRequired: orm.humanOversightRequired,
      hasHardcodedSecret: Boolean(orm.securityFindings?.length),
      snippet: await this.readMaskedSnippet(orm, aiEnabled),
    };
    const result = await this.summarizer.summarizeForOrg(user?.tenantId ?? null, ctx, user?.email ?? 'dashboard_user', dataOrgs);

    orm.useCaseDescription = result.text;
    orm.descriptionSource = result.source;
    orm.descriptionModel = result.model;
    orm.updatedAt = new Date();
    await this.models.save(orm);

    await this.recordLedger(
      modelId,
      'DESCRIPTION_SUMMARIZED',
      { source: result.source, model: result.model ?? 'n/a' },
      user?.email ?? 'dashboard_user',
    );

    return {
      model_id: modelId,
      summary: result.text,
      description_source: result.source,
      description_model: result.model,
      ai_enabled: result.source === 'ai',
      provider: result.provider,
    };
  }

  /**
   * Drafts an auditor-facing justification of the model's assigned risk level.
   * The AI (or heuristic) is grounded in the triage engine's ACTUAL factors —
   * explainTriageFactors mirrors the rules — so the rationale explains what the
   * engine did rather than letting an LLM guess. Persisted with provenance; a
   * later human edit via the governance form flips it to 'human'.
   */
  async draftRiskRationale(user: CurrentUser, modelId: string) {
    const orm = await this.getOrThrow(modelId);
    const entry = modelEntityToEntry(orm);
    const factors = explainTriageFactors(entry, orm.securityFindings?.length ?? 0);

    const result = await this.summarizer.draftForOrg(
      user?.tenantId ?? null,
      'risk_rationale',
      {
        name: orm.name,
        model_type: orm.modelType,
        functional_area: orm.functionalArea,
        risk_level: orm.riskLevel,
        triage_factors: factors.join('; '),
        security_findings: orm.securityFindings?.length
          ? orm.securityFindings.map((s) => `${s.type} (line ${s.line})`).join(', ')
          : 'none',
        human_oversight: String(orm.humanOversightRequired),
        autonomous_scope: orm.autonomousScope ?? 'none declared',
        existing_description: orm.useCaseDescription ?? '',
      },
      () =>
        `${orm.name} is classified ${orm.riskLevel} risk. Basis: ${factors.join('; ')}. ` +
        '(Auto-generated rationale — review and confirm before governance sign-off.)',
      user?.email ?? 'dashboard_user',
      await this.dataOrgs(modelId),
    );

    orm.riskRationale = result.text;
    orm.riskRationaleSource = result.source;
    orm.riskRationaleModel = result.model;
    orm.updatedAt = new Date();
    await this.models.save(orm);
    await this.recordLedger(modelId, 'RISK_RATIONALE_DRAFTED',
      { source: result.source, model: result.model ?? 'n/a', risk_level: orm.riskLevel },
      user?.email ?? 'dashboard_user');

    return {
      model_id: modelId,
      risk_rationale: result.text,
      risk_rationale_source: result.source,
      risk_rationale_model: result.model,
      ai_enabled: result.source === 'ai',
      provider: result.provider,
    };
  }

  /**
   * Proposes the model's autonomous scope from its code signals + masked
   * snippet — the boundary of independent action RBI FREE-AI Recommendation 16
   * requires for any model without human oversight. NOT persisted: it is a
   * proposal returned for the owner to review, edit, and confirm by saving
   * (which records the human-owned scope in the ledger). Without a configured
   * LLM it falls back to a structured prompt for the human to complete.
   */
  async draftAutonomousScope(user: CurrentUser, modelId: string) {
    const orm = await this.getOrThrow(modelId);
    const dataOrgs = await this.dataOrgs(modelId);
    const aiEnabled = await this.summarizer.aiEnabledForOrg(user?.tenantId ?? null, dataOrgs);

    const result = await this.summarizer.draftForOrg(
      user?.tenantId ?? null,
      'autonomous_scope',
      {
        name: orm.name,
        model_type: orm.modelType,
        functional_area: orm.functionalArea,
        signals: (orm.detectionSignals ?? []).join(', ') || 'none',
        human_oversight: String(orm.humanOversightRequired),
        existing_description: orm.useCaseDescription ?? '',
        snippet_block: (await this.readMaskedSnippet(orm, aiEnabled)) ?? '',
      },
      () =>
        orm.humanOversightRequired
          ? 'Fully supervised — a human reviews and approves outputs before they are acted on; no autonomous action.'
          : 'Operates without per-action human sign-off. Define the permitted actions, any step/tool limits, and the conditions under which it must escalate to a human. (Heuristic draft — no LLM configured; edit before saving.)',
      user?.email ?? 'dashboard_user',
      await this.dataOrgs(modelId),
    );

    await this.recordLedger(modelId, 'AUTONOMOUS_SCOPE_DRAFTED',
      { source: result.source, model: result.model ?? 'n/a' },
      user?.email ?? 'dashboard_user');

    return {
      model_id: modelId,
      autonomous_scope: result.text,
      ai_enabled: result.source === 'ai',
      provider: result.provider,
    };
  }

  /**
   * Drafts one actionable remediation step per open compliance gap, across all
   * four frameworks. NOT persisted on the model — the draft is returned for
   * human review; the UI can attach it as a 'remediation_plan' evidence
   * artifact once accepted, which is how it enters the compliance chain.
   */
  async draftGapRemediation(user: CurrentUser, modelId: string) {
    const orm = await this.getOrThrow(modelId);
    // The same evaluation the matrix and compliance-check serve, so the plan's
    // gap list can be compared with them later (see remediation-plan.ts).
    const gapLines = gapLinesOf(await this.complianceCheck(modelId));
    if (!gapLines.length) {
      return { model_id: modelId, open_gaps: 0, draft: null, message: 'No open compliance gaps — nothing to remediate.' };
    }

    const result = await this.summarizer.draftForOrg(
      user?.tenantId ?? null,
      'gap_remediation',
      {
        name: orm.name,
        model_type: orm.modelType,
        functional_area: orm.functionalArea,
        risk_level: orm.riskLevel,
        gaps: gapLines.join('\n'),
      },
      () => heuristicPlan(gapLines) ?? '',
      user?.email ?? 'dashboard_user',
      await this.dataOrgs(modelId),
    );

    // Persisted like the other generations so it survives a reload and can be
    // auto-populated on scan; attaching it as evidence remains a human step.
    orm.gapRemediation = result.text;
    orm.gapRemediationSource = result.source;
    orm.gapRemediationModel = result.model;
    orm.gapRemediationGaps = gapLines;
    orm.updatedAt = new Date();
    await this.models.save(orm);

    await this.recordLedger(modelId, 'REMEDIATION_PLAN_DRAFTED',
      { source: result.source, model: result.model ?? 'n/a', open_gaps: gapLines.length },
      user?.email ?? 'dashboard_user');

    return {
      model_id: modelId,
      open_gaps: gapLines.length,
      draft: result.text,
      draft_source: result.source,
      draft_model: result.model,
      ai_enabled: result.source === 'ai',
      provider: result.provider,
    };
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
    let governanceWarnings: string[] | null = null;
    const liveStages = [ModelLifecycleStage.DEPLOYED, ModelLifecycleStage.MONITORING];
    if (liveStages.includes(dto.stage)) {
      const missing = this.governanceGaps(orm);
      // Pillar 1 — Alignment: a MEDIUM/HIGH-risk model needs a recorded
      // review-board sign-off before it can go live. LOW-risk models keep the
      // lighter, self-service path (risk-proportionate governance).
      const isMedOrHigh = orm.riskLevel === RiskLevel.MEDIUM || orm.riskLevel === RiskLevel.HIGH;
      if (isMedOrHigh) {
        const approved = await this.approvals.count({ where: { modelId, status: 'APPROVED' } });
        if (approved === 0) {
          missing.push(
            'board_approval — an approved review-board sign-off is required before a ' +
              'MEDIUM/HIGH-risk model goes live (request one on the Alignment page)',
          );
        }
      }
      // Governance E1.3/E1.4: residual risk and impact-assessment gate, block or
      // warn per the organisation's settings for the model's tier.
      const gate = await governanceHooks.gateCheck?.(modelId);
      for (const f of gate?.block ?? []) missing.push(`${f.code} — ${f.message}`);
      if (gate?.warn.length) governanceWarnings = gate.warn.map((f) => `${f.code} — ${f.message}`);
      if (missing.length > 0) {
        throw new UnprocessableEntityException({
          message: `Model cannot move to ${dto.stage} until governance is complete.`,
          missing_fields: missing,
        });
      }
    }
    // Governance E3.4: decommissioning goes through the approved retirement workflow while it is on.
    if (dto.stage === ModelLifecycleStage.DECOMMISSIONED && orm.lifecycleStage !== ModelLifecycleStage.DECOMMISSIONED) {
      const blocked = await governanceHooks.retirementCheck?.(modelId);
      if (blocked) throw new UnprocessableEntityException({ message: blocked, missing_fields: ['retirement — complete the approved retirement workflow'] });
    }
    const prev = orm.lifecycleStage;
    orm.lifecycleStage = dto.stage;
    // The first time a model goes live, its deployment date is the day it was promoted (unless one was entered).
    if (dto.stage === ModelLifecycleStage.DEPLOYED && !orm.deploymentDate) orm.deploymentDate = new Date();
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
    return { model_id: modelId, stage: dto.stage, actor: dto.actor, ...(governanceWarnings ? { governance_warnings: governanceWarnings } : {}) };
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
    if (dto.deployment_date !== undefined && dto.deployment_date !== null) {
      const d = dto.deployment_date === '' ? null : parseDate(dto.deployment_date);
      if (dto.deployment_date !== '' && (!d || Number.isNaN(d.getTime()))) throw new BadRequestException('deployment_date must be a date');
      changes.deployment_date = [orm.deploymentDate ? new Date(orm.deploymentDate).toISOString() : null, d ? d.toISOString() : null];
      orm.deploymentDate = d;
    }
    if (dto.use_case_description !== undefined && dto.use_case_description !== null) {
      if (dto.use_case_description !== orm.useCaseDescription) {
        // A human edited/confirmed the text — provenance is now 'human'.
        orm.descriptionSource = 'human';
        orm.descriptionModel = null;
      }
      orm.useCaseDescription = dto.use_case_description;
    }
    if (dto.risk_rationale !== undefined && dto.risk_rationale !== null) {
      if (dto.risk_rationale !== orm.riskRationale) {
        // Ledger notes the provenance shift, not the full text (it can be long).
        changes.risk_rationale = [orm.riskRationaleSource ?? '(none)', 'human'];
        orm.riskRationaleSource = 'human';
        orm.riskRationaleModel = null;
      }
      orm.riskRationale = dto.risk_rationale;
    }
    if (dto.permitted_tools !== undefined && dto.permitted_tools !== null) {
      const next = [...new Set(dto.permitted_tools.map((t) => t.trim()).filter(Boolean))];
      const prev = orm.permittedTools ?? [];
      if (prev.join(',') !== next.join(',')) {
        changes.permitted_tools = [prev, next];
        orm.permittedTools = next;
      }
    }

    orm.updatedAt = new Date();

    // Re-triage with updated facts — closing gaps can raise or lower risk. But
    // an unremediated hardcoded secret keeps the model floored at HIGH, so an
    // unrelated edit can't quietly drop it back to LOW.
    const entry = modelEntityToEntry(orm);
    const newRisk = floorRiskForSecurityFindings(triageAiModel(entry), orm.securityFindings?.length ?? 0);
    if (newRisk !== (orm.riskLevel as RiskLevel)) {
      changes.risk_level = [orm.riskLevel, newRisk];
      orm.riskLevel = newRisk;
    }

    await this.models.save(orm);
    // Governance E1.3: a tier change is a material change that re-opens risk review.
    if (changes.risk_level) await emitModelEvent(orm.id, 'MATERIAL_CHANGE', { ref: `risk ${changes.risk_level[0]}→${changes.risk_level[1]}` });

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
    const compliance = sutrasReportAsDict(validateSutrasCompliance(finalEntry, ctx));
    compliance.nist_rmf = frameworkReportAsDict(validateNistRmf(finalEntry, ctx));
    compliance.eu_ai_act = frameworkReportAsDict(validateEuAiAct(finalEntry, ctx));
    compliance.iso_42001 = frameworkReportAsDict(validateIso42001(finalEntry, ctx));
    this.withFrameworkScope(compliance, await this.frameworkScope(orm));

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
    const res = sutrasReportAsDict(validateSutrasCompliance(entry, ctx));
    res.nist_rmf = frameworkReportAsDict(validateNistRmf(entry, ctx));
    res.eu_ai_act = frameworkReportAsDict(validateEuAiAct(entry, ctx));
    res.iso_42001 = frameworkReportAsDict(validateIso42001(entry, ctx));
    return this.withFrameworkScope(res, await this.frameworkScope(orm));
  }

  /**
   * The verdict the model list, model detail and project counts show: the
   * in-scope frameworks, evaluated with the same context as the compliance
   * check (the RBI Sutras with the drill date only, as before, without settings).
   */
  async verdictFor(orm: AIModelEntity, lastDrill: Date | null, scope: FrameworkScope): Promise<{ pass: boolean; gaps: number }> {
    const ctx = scope.restricted ? await this.buildValidationContext(orm.id) : { bcpDrillLastConducted: lastDrill };
    return scopedVerdict(modelEntityToEntry(orm), ctx, scope);
  }

  /** The report frameworks that apply to a model: its organisation's enabled packs (every one without settings). */
  async frameworkScope(orm: Pick<AIModelEntity, 'id' | 'projectId'>): Promise<FrameworkScope> {
    const project = orm.projectId ? await this.projects.findOne({ where: { id: orm.projectId }, select: ['id', 'tenantId'] }) : null;
    return frameworkScopeForOrg(project?.tenantId ?? null);
  }

  /**
   * Mark which frameworks apply. Reports for switched-off packs stay in the
   * response (nothing is deleted) but every consumer reads frameworks_in_scope
   * and neither shows nor counts the others.
   */
  private withFrameworkScope(res: Record<string, any>, scope: FrameworkScope): Record<string, any> {
    res.frameworks_in_scope = scope.frameworks;
    res.frameworks_not_in_scope = scope.excluded;
    res.packs_in_scope = scope.pack_ids;
    return res;
  }

  /** Attach an evidence artifact (bias-test report, red-team report, ...). */
  async addEvidence(modelId: string, dto: { type: string; ref: string; description?: string; document_id?: string }, actor: string) {
    const orm = await this.getOrThrow(modelId);
    const artifact: EvidenceArtifact = {
      type: dto.type,
      ref: dto.ref,
      description: dto.description,
      added_at: new Date().toISOString(),
    };
    // Governance E1.8: link the artifact to a controlled document (version + hash) when document control is on.
    if (dto.document_id && governanceHooks.evidenceDocument) {
      const doc = await governanceHooks.evidenceDocument(modelId, dto.document_id);
      if (doc) Object.assign(artifact, { document_id: doc.document_id, document_version: doc.version, document_hash: doc.hash });
    }
    orm.evidenceArtifacts = [...(orm.evidenceArtifacts ?? []), artifact];
    orm.updatedAt = new Date();
    await this.models.save(orm);
    await this.recordLedger(modelId, 'EVIDENCE_ATTACHED', { type: dto.type, ref: dto.ref }, actor);
    // Governance E1.3: new red-team results re-open the model's risk review.
    if (dto.type === 'red_team') await emitModelEvent(modelId, 'RED_TEAM_FINDING', { ref: dto.ref });
    return { model_id: modelId, evidence_count: orm.evidenceArtifacts.length, artifact };
  }

  async listEvidence(modelId: string) {
    const orm = await this.getOrThrow(modelId);
    return { model_id: modelId, evidence: orm.evidenceArtifacts ?? [] };
  }

  /**
   * Ingest behavioral-eval-harness output as a typed evidence artifact (Pillar 1
   * — Alignment). Every harness (promptfoo, garak, PyRIT, custom suites) reports
   * pass/total counts; we normalise those into a pass-rate and a `behavioral_eval`
   * artifact with the failed checks and metrics preserved, so a governance
   * reviewer sees behavioral test *results*, not just a link. This is what turns
   * "we ran evals" into evidence the compliance chain can point to.
   */
  async ingestEvalEvidence(
    modelId: string,
    dto: { suite: string; passed: number; total: number; report_ref?: string; failed_checks?: string[]; metrics?: Record<string, number>; actor: string },
  ) {
    const orm = await this.getOrThrow(modelId);
    const total = Math.max(0, Math.trunc(dto.total));
    const passed = Math.min(Math.max(0, Math.trunc(dto.passed)), total || dto.passed);
    if (total <= 0) {
      throw new UnprocessableEntityException('total must be a positive number of checks.');
    }
    const passRate = Math.round((passed / total) * 1000) / 10; // one decimal %
    const passedAll = passed >= total;
    const failed = dto.failed_checks?.filter((f) => f?.trim()).map((f) => f.trim()) ?? [];

    const artifact: EvidenceArtifact = {
      type: 'behavioral_eval',
      ref: dto.report_ref?.trim() || `${dto.suite}:${passed}/${total}`,
      description:
        `${dto.suite} — ${passed}/${total} checks passed (${passRate}%)` +
        (passedAll ? ' · all passed' : failed.length ? ` · failed: ${failed.slice(0, 8).join(', ')}` : ' · has failures'),
      added_at: new Date().toISOString(),
      data: {
        suite: dto.suite,
        passed,
        total,
        pass_rate: passRate,
        passed_all: passedAll,
        failed_checks: failed,
        metrics: dto.metrics ?? {},
      },
    };
    orm.evidenceArtifacts = [...(orm.evidenceArtifacts ?? []), artifact];
    orm.updatedAt = new Date();
    await this.models.save(orm);

    await this.recordLedger(
      modelId,
      'EVAL_EVIDENCE_INGESTED',
      { suite: dto.suite, passed, total, pass_rate: passRate, passed_all: passedAll },
      dto.actor,
    );

    return {
      model_id: modelId,
      suite: dto.suite,
      passed,
      total,
      pass_rate: passRate,
      passed_all: passedAll,
      failed_checks: failed,
      evidence_count: orm.evidenceArtifacts.length,
      artifact,
    };
  }

  /**
   * Ingest an adversarial / red-team report (Pillar 4 — Security). `failures`
   * are probes that breached the model. Stores a typed `red_team` evidence
   * artifact with the parsed result AND stamps the model's last-red-team date,
   * so a single ingest both records the adversarial evidence and satisfies the
   * red-team governance control (which the CI gate and validators check). A
   * report that shows breaches is notified as a security signal.
   */
  async ingestAdversarialEvidence(
    modelId: string,
    dto: { suite: string; total_probes: number; failures: number; categories?: string[]; report_ref?: string; actor: string },
  ) {
    const orm = await this.getOrThrow(modelId);
    const total = Math.max(0, Math.trunc(dto.total_probes));
    if (total <= 0) throw new UnprocessableEntityException('total_probes must be a positive number.');
    const failures = Math.min(Math.max(0, Math.trunc(dto.failures)), total);
    const resistRate = Math.round(((total - failures) / total) * 1000) / 10; // % probes resisted
    const breached = failures > 0;
    const categories = dto.categories?.filter((c) => c?.trim()).map((c) => c.trim()) ?? [];

    const artifact: EvidenceArtifact = {
      type: 'red_team',
      ref: dto.report_ref?.trim() || `${dto.suite}:${failures}/${total} breached`,
      description:
        `${dto.suite} adversarial — ${total} probes, ${failures} breach(es) (${resistRate}% resisted)` +
        (categories.length ? ` · ${categories.join(', ')}` : ''),
      added_at: new Date().toISOString(),
      data: { suite: dto.suite, total_probes: total, failures, resist_rate: resistRate, breached, categories },
    };
    orm.evidenceArtifacts = [...(orm.evidenceArtifacts ?? []), artifact];
    orm.lastRedTeamDate = new Date(); // ingesting adversarial evidence satisfies the red-team control
    orm.updatedAt = new Date();
    await this.models.save(orm);

    await this.recordLedger(
      modelId,
      'ADVERSARIAL_EVIDENCE_INGESTED',
      { suite: dto.suite, total_probes: total, failures, resist_rate: resistRate, breached },
      dto.actor,
    );
    if (breached) {
      await this.notifier.notify('adversarial_breach', {
        model_id: modelId, model_name: orm.name, suite: dto.suite, failures, total_probes: total, categories,
      });
    }

    return {
      model_id: modelId,
      suite: dto.suite,
      total_probes: total,
      failures,
      resist_rate: resistRate,
      breached,
      categories,
      last_red_team_date: orm.lastRedTeamDate.toISOString(),
      evidence_count: orm.evidenceArtifacts.length,
      artifact,
    };
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
    const llmCache = new Map<string, LlmConfigSummary | null>();
    const scanProject = async (pid: string): Promise<DiscoveredCandidate[] | null> => {
      if (scanCache.has(pid)) return scanCache.get(pid)!;
      const project = await this.projects.findOne({ where: { id: pid } });
      let candidates: DiscoveredCandidate[] | null = null;
      let llm: LlmConfigSummary | null = null;
      if (project && isDirectory(project.rootDirectory)) {
        const root = expandAndResolve(project.rootDirectory);
        candidates = scanDirectory(root, this.treeSitter);
        try { llm = detectLlmConfig(root); } catch { llm = null; }
      }
      scanCache.set(pid, candidates);
      llmCache.set(pid, llm);
      return candidates;
    };

    const summary: RescanSummary = {
      rescanned: models.length, risk_changed: 0, source_missing: 0, models: [], generations_queued: 0,
    };

    for (const m of models) {
      const oldRisk = m.riskLevel as RiskLevel;
      const retriaged = triageAiModel(modelEntityToEntry(m));
      let finalRisk = retriaged;
      let sourceFound: boolean | null = null;
      let toolsChanged = false;

      if (m.sourceRef && m.projectId) {
        const candidates = await scanProject(m.projectId);
        if (candidates) {
          const cand = candidates.find((c) => c.filePath === m.sourceRef);
          if (cand) {
            sourceFound = true;
            finalRisk = RISK_ORDER[retriaged] >= RISK_ORDER[cand.riskHint] ? retriaged : cand.riskHint;
            // Refresh detected tools/capabilities (Pillar 2 — Control).
            const beforeTools = (m.detectedTools ?? []).join(',');
            m.detectedTools = [...new Set([...(m.detectedTools ?? []), ...cand.tools])];
            toolsChanged = beforeTools !== (m.detectedTools ?? []).join(',');
            // Refresh where the LLM models are named or stored.
            const llm = llmCache.get(m.projectId) ?? null;
            if (llm && isLlmCandidate(cand)) {
              const next = llmConfigForRecord(llm, m.sourceRefs ?? [m.sourceRef]);
              const strip = (v: any) => JSON.stringify(v ? { ...v, scanned_at: undefined } : null);
              if (strip(next) !== strip(m.llmConfig)) { m.llmConfig = next; toolsChanged = true; }
            }
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
      if (riskChanged) m.riskLevel = finalRisk;
      if (riskChanged || toolsChanged) {
        m.updatedAt = new Date();
        await this.models.save(m);
        if (riskChanged) summary.risk_changed += 1;
        if (riskChanged) await emitModelEvent(m.id, 'MATERIAL_CHANGE', { ref: `re-scan ${oldRisk}→${finalRisk}` });
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

    // Backfill any generation a model is still missing. Idempotent by design:
    // models that already have all three are skipped, so a routine re-scan
    // costs nothing and only older records get topped up.
    summary.generations_queued = await this.genQueue.enqueueMissing(user, models.map((m) => m.id));

    return summary;
  }
}
