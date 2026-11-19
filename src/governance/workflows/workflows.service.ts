/**
 * Workflow status (User Guide Part B, W0 to W12) for an organisation or a
 * model. The facts come from the same places as the compliance check, the
 * deploy gate and the readiness report:
 *  - model controls: the pack engine on every pack in force for the
 *    organisation, with the validation context the compliance check builds;
 *  - organisation controls: the ORG clauses, with the AIMS facts;
 *  - the deploy gate (residual risk, FINAL impact assessment) and the
 *    governance facts the controls read (risk register, validation, TEVV...);
 *  - the records themselves (approvals, audits, drills, incidents...).
 * Nothing here writes: a step is done only when its records say so.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';

import { RiskLevel, Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { scopedVerdict } from '../../compliance/framework-scope';
import {
  AIAuditTrailEntity,
  AIIncidentEntity,
  AIModelEntity,
  AiProviderConfigEntity,
  AttestationCampaignEntity,
  AttestationItemEntity,
  ControlledDocumentEntity,
  CorrectiveActionEntity,
  DatasetEntity,
  DeploymentGateEventEntity,
  GovernanceSettingsEntity,
  GrievanceEntity,
  ImpactAssessmentEntity,
  IntegrationEndpointEntity,
  ModelApprovalEntity,
  ModelCardEntity,
  ModelRetirementEntity,
  OrganizationEntity,
  ProjectEntity,
  RiskActionEntity,
  RiskEntity,
  SoaStatementEntity,
  ThreatModelEntity,
  TrainingCourseEntity,
  UserEntity,
} from '../../database/entities';
import { RED_TEAM_INTERVAL_DAYS } from '../../domain/model-inventory';
import { InventoryService } from '../../inventory/inventory.service';
import { modelEntityToEntry } from '../../inventory/model.mapper';
import { AimsService, ORG_ENTRY } from '../aims/aims.service';
import { modelForUser, orgScope } from '../governance-access';
import { governanceHooks } from '../hooks';
import { evaluatePack, resolveForPacks } from '../packs/pack-engine';
import { packRegistry } from '../packs/pack-loader';
import { PacksService } from '../packs/packs.service';
import { scopedOrgModels } from '../phase2-util';
import { lastRedTeam } from '../redteam/redteam-audit.service';
import { JURISDICTIONS } from '../settings/settings.model';
import { GovernanceSettingsService, SETTINGS_EDITORS } from '../settings/settings.service';
import {
  ControlOutcome,
  evaluateWorkflow,
  externalFrom,
  MODEL_STAGES,
  ModelFacts,
  ORG_STAGES,
  OrgFacts,
  REGION_PACKS,
  WorkflowView,
} from './workflow-catalogue';

const OPEN_GRIEVANCE = ['RECEIVED', 'ACKNOWLEDGED', 'INVESTIGATING'];
const PASSED_DRILL = ['PASSED', 'PASSED_WITH_FINDINGS'];
const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(GovernanceSettingsEntity) private readonly settingsRows: Repository<GovernanceSettingsEntity>,
    @InjectRepository(IntegrationEndpointEntity) private readonly integrations: Repository<IntegrationEndpointEntity>,
    @InjectRepository(AiProviderConfigEntity) private readonly providers: Repository<AiProviderConfigEntity>,
    @InjectRepository(ControlledDocumentEntity) private readonly documents: Repository<ControlledDocumentEntity>,
    @InjectRepository(SoaStatementEntity) private readonly soas: Repository<SoaStatementEntity>,
    @InjectRepository(TrainingCourseEntity) private readonly courses: Repository<TrainingCourseEntity>,
    @InjectRepository(DeploymentGateEventEntity) private readonly gateEvents: Repository<DeploymentGateEventEntity>,
    @InjectRepository(AttestationCampaignEntity) private readonly campaigns: Repository<AttestationCampaignEntity>,
    @InjectRepository(AttestationItemEntity) private readonly attestItems: Repository<AttestationItemEntity>,
    @InjectRepository(DatasetEntity) private readonly datasets: Repository<DatasetEntity>,
    @InjectRepository(ImpactAssessmentEntity) private readonly impacts: Repository<ImpactAssessmentEntity>,
    @InjectRepository(RiskEntity) private readonly risks: Repository<RiskEntity>,
    @InjectRepository(RiskActionEntity) private readonly riskActions: Repository<RiskActionEntity>,
    @InjectRepository(ModelApprovalEntity) private readonly approvals: Repository<ModelApprovalEntity>,
    @InjectRepository(ThreatModelEntity) private readonly threatModels: Repository<ThreatModelEntity>,
    @InjectRepository(AIAuditTrailEntity) private readonly audits: Repository<AIAuditTrailEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(CorrectiveActionEntity) private readonly actions: Repository<CorrectiveActionEntity>,
    @InjectRepository(GrievanceEntity) private readonly grievances: Repository<GrievanceEntity>,
    @InjectRepository(ModelRetirementEntity) private readonly retirements: Repository<ModelRetirementEntity>,
    @InjectRepository(ModelCardEntity) private readonly cards: Repository<ModelCardEntity>,
    private readonly inventory: InventoryService,
    private readonly packs: PacksService,
    private readonly settings: GovernanceSettingsService,
    private readonly aims: AimsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private flagFn() {
    const f = this.flags.flags as unknown as Record<string, boolean>;
    return (k: string) => !!f[k];
  }

  /** Packs in force and their resolved parameters for an organisation. */
  private async packContext(orgId: string | null, now: Date) {
    const ctx = await this.packs.contextFor(orgId, now);
    const loaded = packRegistry().activeAt(now).filter((p) => ctx.packIds.includes(p.definition.id));
    return { packIds: ctx.packIds, loaded, params: resolveForPacks(loaded, ctx.extraSources) };
  }

  /** Jurisdiction and packs, for the header chip and the first-run prompt. */
  private async jurisdiction(user: CurrentUser, orgId: string, packIds: string[]) {
    const on = this.flags.isEnabled('governanceSettings');
    const s = on ? await this.settings.inForce(orgId) : null;
    const catalog = packRegistry().activeAt().map((p) => ({ pack_id: p.definition.id, name: p.definition.name, baseline: !!p.definition.baseline, region: p.definition.region ?? null }));
    return {
      settings_available: on,
      primary: s?.settings.primaryJurisdiction ?? null,
      enabled_packs: s?.settings.enabledPacks ?? [],
      version: s?.version ?? 0,
      is_default: s ? s.isDefault : true,
      can_edit: on && SETTINGS_EDITORS.includes(user.role as Role) && user.tenantId === orgId,
      packs_in_force: packIds,
      catalog,
      jurisdictions: JURISDICTIONS,
    };
  }

  /* -------------------------------------------------------- organisation */

  private async orgFacts(orgId: string, now: Date): Promise<OrgFacts> {
    const flags = this.flagFn();
    const { packIds, loaded, params } = await this.packContext(orgId, now);

    // ORG controls: the same evaluation as AIMS › Controls and the readiness report.
    const controls = new Map<string, ControlOutcome>();
    let aimsFacts: Record<string, any> | null = null;
    if (flags('aims')) {
      aimsFacts = await this.aims.orgFacts(orgId);
      for (const p of loaded) {
        const ev = evaluatePack(p, ORG_ENTRY, { org: aimsFacts } as any, { flags: this.flags.flags, params, now, scope: 'ORG' });
        mergeClauses(controls, p.definition.id, ev.clauses);
      }
    }
    const extra = aimsFacts ?? ((await governanceHooks.extraOrgFacts?.(orgId)) ?? {});

    const [org, users, history, integrations, aiProviders, documents, soa, trainingCourses, projects] = await Promise.all([
      this.orgs.findOne({ where: { id: orgId } }),
      this.users.find({ where: { tenantId: orgId, isActive: true }, select: ['id', 'role'] }),
      flags('governanceSettings') ? this.settingsRows.find({ where: { orgId }, select: ['id', 'changes'] }) : Promise.resolve([]),
      flags('incidentExtensions') ? this.integrations.count({ where: { orgId, enabled: true } }) : Promise.resolve(0),
      this.providers.count({ where: { tenantId: orgId, enabled: true } }),
      flags('documentControl') ? this.documents.count({ where: { orgId } }) : Promise.resolve(0),
      flags('soa') ? this.soas.findOne({ where: { orgId }, order: { version: 'DESC' } }) : Promise.resolve(null),
      flags('training') ? this.courses.count({ where: { orgId, active: true } }) : Promise.resolve(0),
      this.projects.find({ where: { tenantId: orgId } }),
    ]);

    const roles: Record<string, number> = {};
    for (const u of users) roles[u.role] = (roles[u.role] ?? 0) + 1;

    let settings: OrgFacts['settings'] = null;
    if (flags('governanceSettings')) {
      const s = await this.settings.inForce(orgId);
      const changedFields = new Set<string>();
      for (const r of history) for (const c of (r.changes ?? []) as Array<{ field: string }>) changedFields.add(String(c.field));
      const peopleItemsOpen = Object.values(s.settings.peopleItems ?? {}).filter((v: any) => v?.mode === 'CUSTOMER' && !v.owner).length;
      settings = { isDefault: s.isDefault, version: s.version, primaryJurisdiction: s.settings.primaryJurisdiction, changedFields, peopleItemsOpen };
    }

    const projectIds = projects.map((p) => p.id);
    const models = projectIds.length ? await this.models.find({ where: { projectId: In(projectIds), isActive: true } }) : [];
    const refs = new Map<string, Set<string>>();
    for (const m of models) {
      const set = refs.get(m.projectId ?? '') ?? new Set<string>();
      for (const r of [m.sourceRef, ...(m.sourceRefs ?? [])]) if (r) set.add(r);
      refs.set(m.projectId ?? '', set);
    }
    const pendingCandidates = projects.reduce((n, p) => {
      const cands: any[] = (p.lastScanResult as any)?.candidates ?? [];
      const known = refs.get(p.id) ?? new Set<string>();
      return n + cands.filter((c) => c?.file_path && !known.has(c.file_path)).length;
    }, 0);
    const ciEvents = projectIds.length ? await this.gateEvents.count({ where: { projectId: In(projectIds) } }) : 0;
    const narratives = projects.map((p) => toDate(p.execNarrativeAt)).filter((d): d is Date => !!d);

    const campaigns = await this.campaigns.find({ where: { tenantId: orgId }, order: { createdAt: 'DESC' } });
    const datasetsPastRetention = flags('dataRegister')
      ? (await this.datasets.find({ where: { orgId, deletionStatus: Not('DELETED') }, select: ['id', 'retentionUntil', 'deletionStatus'] }))
        .filter((d) => d.deletionStatus !== 'ORDERED' && d.retentionUntil && d.retentionUntil.getTime() < now.getTime()).length
      : null;

    const rec = aimsFacts?.records ?? {};
    const fr = extra.frameworkReview;
    const disc = extra.disclosures;
    return {
      now, flags, packs: packIds, controls,
      org: { id: orgId, accountableOfficial: !!org?.accountableOfficialUserId, board: !!org?.governanceBoard?.length },
      roles,
      settings,
      integrations,
      aiProviders,
      aims: aimsFacts ? {
        policyApproved: (rec.POLICY?.approved ?? 0) > 0,
        policyOverdue: !!aimsFacts.policy?.overdue,
        scopeApproved: (rec.SCOPE?.approved ?? 0) > 0,
        objectives: rec.OBJECTIVE?.approved ?? 0,
        mgmtReviewAt: toDate(aimsFacts.lastMgmtReviewAt),
      } : null,
      documents,
      soaApprovedAt: soa?.approvedAt ?? null,
      trainingCourses,
      frameworkReview: fr ? { lastReviewAt: toDate(fr.lastReviewAt), nextDueAt: toDate(fr.nextDueAt), overdue: !!fr.overdue } : null,
      projects: {
        total: projects.length,
        withCode: projects.filter((p) => !!p.codebaseSource || !!p.lastScannedAt).length,
        scanned: projects.filter((p) => !!p.lastScannedAt).length,
        pendingCandidates,
        ciEvents,
        boardNarrativeAt: narratives.length ? new Date(Math.max(...narratives.map((d) => d.getTime()))) : null,
      },
      models: { total: models.length, missingOwnerOrPolicy: models.filter((m) => !m.ownerTeam?.trim() || !m.boardPolicyRef?.trim()).length },
      attestation: {
        open: campaigns.filter((c) => c.status === 'OPEN').length,
        lastOpenedAt: campaigns[0]?.createdAt ?? null,
        cadenceDays: campaigns[0]?.cadenceDays ?? null,
      },
      datasetsPastRetention,
      transparencyPublishedAt: toDate(disc?.transparencyPublishedAt),
      transparencyOverdue: !!disc?.reviewOverdue,
    };
  }

  private async orgView(orgId: string, now: Date): Promise<WorkflowView> {
    return evaluateWorkflow('org', ORG_STAGES, await this.orgFacts(orgId, now));
  }

  async org(user: CurrentUser, requestedOrg?: string) {
    const orgId = orgScope(user, requestedOrg);
    const now = new Date();
    const { packIds } = await this.packContext(orgId, now);
    const view = await this.orgView(orgId, now);
    return { org_id: orgId, evaluated_at: now.toISOString(), jurisdiction: await this.jurisdiction(user, orgId, packIds), ...view };
  }

  /* --------------------------------------------------------------- model */

  private async modelFacts(model: AIModelEntity, orgId: string | null, now: Date): Promise<ModelFacts> {
    const flags = this.flagFn();
    const { packIds, loaded, params } = await this.packContext(orgId, now);
    const entry = modelEntityToEntry(model);
    const ctx = await this.inventory.buildValidationContext(model.id);
    const scope = await this.inventory.frameworkScope(model);

    // Model controls: the same evaluation as the compliance check and the readiness report.
    const controls = new Map<string, ControlOutcome>();
    for (const p of loaded) {
      const ev = evaluatePack(p, entry, ctx, { flags: this.flags.flags, params, now });
      mergeClauses(controls, p.definition.id, ev.clauses);
    }
    const openGaps = scopedVerdict(entry, ctx, scope).gaps;

    const riskIds = flags('riskRegister') ? (await this.risks.find({ where: { scopeType: 'MODEL', scopeId: model.id }, select: ['id'] })).map((r) => r.id) : [];
    const [gate, ia, riskActions, approval, threatModel, audit, incidents, grievances, retirement, card, attestation, ciLatest] = await Promise.all([
      governanceHooks.gateCheck ? governanceHooks.gateCheck(model.id) : Promise.resolve(null),
      flags('impactAssessment') ? this.impacts.findOne({ where: { modelId: model.id, status: Not('SUPERSEDED') }, order: { version: 'DESC' } }) : Promise.resolve(null),
      riskIds.length ? this.riskActions.count({ where: { riskId: In(riskIds) } }) : Promise.resolve(0),
      this.approvals.findOne({ where: { modelId: model.id }, order: { createdAt: 'DESC' } }),
      flags('aiSecurity') ? this.threatModels.findOne({ where: { modelId: model.id }, order: { version: 'DESC' } }) : Promise.resolve(null),
      this.audits.findOne({ where: { modelId: model.id }, order: { createdAt: 'DESC' } }),
      this.incidents.find({ where: { modelId: model.id } }),
      this.grievances.find({ where: { modelId: model.id, status: In(OPEN_GRIEVANCE) }, select: ['id', 'slaDueAt'] }),
      flags('tevv') ? this.retirements.findOne({ where: { modelId: model.id }, order: { requestedAt: 'DESC' } }) : Promise.resolve(null),
      flags('modelCards') ? this.cards.findOne({ where: { modelId: model.id }, order: { version: 'DESC' } }) : Promise.resolve(null),
      this.attestItems.findOne({ where: { modelId: model.id }, order: { createdAt: 'DESC' } }),
      model.projectId ? this.gateEvents.findOne({ where: { projectId: model.projectId }, order: { occurredAt: 'DESC' } }) : Promise.resolve(null),
    ]);
    const incidentIds = incidents.map((i) => i.id);
    const withAction = new Set(
      incidentIds.length && flags('correctiveActions')
        ? (await this.actions.find({ where: { source: 'INCIDENT', sourceId: In(incidentIds) }, select: ['id', 'sourceId'] })).map((a) => a.sourceId)
        : [],
    );

    const band = model.riskLevel === RiskLevel.HIGH || model.riskLevel === RiskLevel.CRITICAL || model.riskLevel === ('PROHIBITED' as RiskLevel) ? 'HIGH' : model.riskLevel === RiskLevel.MEDIUM ? 'MEDIUM' : 'LOW';
    const redTeamIntervalDays = Number(params.values[`redTeamIntervalDays.${band}`] ?? RED_TEAM_INTERVAL_DAYS[band]);
    const p = (model.contextProfile ?? null) as Record<string, any> | null;
    return {
      now, flags, packs: packIds, controls,
      m: {
        id: model.id, name: model.name, riskLevel: model.riskLevel, modelType: model.modelType, lifecycleStage: model.lifecycleStage, projectId: model.projectId ?? null,
        ownerTeam: model.ownerTeam ?? null, ownerUserId: (model as any).ownerUserId ?? null, riskRationale: (model as any).riskRationale ?? null,
        sutras: (model.sutrasAlignment ?? []) as string[], humanOversight: model.humanOversightRequired ?? null, boardPolicyRef: model.boardPolicyRef ?? null,
        lastRedTeamDate: lastRedTeam(model), nextAuditDue: toDate(model.nextAuditDue), gapRemediation: (model as any).gapRemediation ?? null,
        evidenceTypes: ((model as any).evidenceArtifacts ?? []).map((a: any) => a?.type).filter(Boolean),
        detectedTools: ((model as any).detectedTools ?? []) as string[], permittedTools: ((model as any).permittedTools ?? []) as string[],
        contextProfile: p, mrmInScope: (model as any).mrmInScope ?? null,
      },
      gov: ctx.governance ?? {},
      gate: gate ? { mode: gate.mode, tier: gate.tier, block: gate.block, warn: gate.warn } : null,
      openGaps,
      ia: ia ? { status: ia.status, version: ia.version, materiality: ia.materiality, signedAt: ia.signedAt } : null,
      riskActions,
      approval: approval ? { status: approval.status, targetStage: approval.targetStage } : null,
      threatModel: threatModel ? { status: threatModel.status } : null,
      securityEvaluations: 0,
      audit: audit ? { at: audit.createdAt, verdict: audit.overallVerdict ?? null } : null,
      driftAt: toDate(ctx.lastDriftAt),
      drillPassedAt: toDate(ctx.bcpDrillLastConducted),
      incidents: incidents.map((i) => ({
        severity: i.severity, status: i.status, signedOff: !!i.seniorSignOffAt, notified: !!i.affectedPartiesNotifiedAt || !!(i.governanceExt as any)?.notice?.notRequiredReason,
        ticket: !!i.externalTicketRef, correctiveAction: withAction.has(i.id),
      })),
      grievances: { open: grievances.length, pastSla: grievances.filter((g) => g.slaDueAt && g.slaDueAt.getTime() < now.getTime()).length },
      retirement: retirement ? { status: retirement.status } : null,
      card: card ? { status: card.status } : null,
      attestation: attestation ? { status: attestation.status } : null,
      ciLatest: ciLatest ? { verdict: ciLatest.verdict === 'pass' ? 'PASS' : 'FAIL', overridden: !!ciLatest.overriddenBy } : null,
      redTeamIntervalDays,
    };
  }

  async model(user: CurrentUser, modelId: string) {
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    const now = new Date();
    const facts = await this.modelFacts(model, orgId, now);
    const orgView = orgId ? await this.orgView(orgId, now) : null;
    const view = evaluateWorkflow('model', MODEL_STAGES, facts, orgView ? externalFrom(orgView) : new Map());
    // Organisation blockers that hold this model back (the board policy, for one).
    const orgBlockers = orgView ? orgView.blockers.filter((b) => ['w0-2', 'w0-7'].includes(b.step_id)) : [];
    return {
      org_id: orgId,
      model: { id: model.id, name: model.name, risk_level: model.riskLevel, lifecycle_stage: model.lifecycleStage, model_type: model.modelType, project_id: model.projectId },
      evaluated_at: now.toISOString(),
      jurisdiction: orgId ? await this.jurisdiction(user, orgId, facts.packs) : null,
      ...view,
      org_blockers: orgBlockers,
    };
  }

  /** Progress per model for the picker (in the selected project when one is chosen). */
  async modelSummaries(user: CurrentUser, requestedOrg?: string) {
    const orgId = orgScope(user, requestedOrg);
    const now = new Date();
    const orgView = await this.orgView(orgId, now);
    const ext = externalFrom(orgView);
    const out: Array<Record<string, any>> = [];
    for (const m of await scopedOrgModels(this.models, this.projects, orgId)) {
      const v = evaluateWorkflow('model', MODEL_STAGES, await this.modelFacts(m, orgId, now), ext);
      out.push({
        model_id: m.id, name: m.name, risk_level: m.riskLevel, lifecycle_stage: m.lifecycleStage, project_id: m.projectId,
        done: v.done, total: v.total, blockers: v.blockers.length, next: v.next ? { step: v.next.step, title: v.next.title } : null,
      });
    }
    return { org_id: orgId, evaluated_at: now.toISOString(), models: out };
  }
}

/** Fold clause results into one outcome per control (a failure in any pack wins). */
function mergeClauses(into: Map<string, ControlOutcome>, packId: string, clauses: Array<{ controlId: string; code: string; passed: boolean; notAssessed: boolean; gap: string }>) {
  for (const c of clauses) {
    const row = into.get(c.controlId) ?? { passed: true, notAssessed: true, gaps: [], clauses: [] };
    if (!c.notAssessed) {
      row.notAssessed = false;
      row.passed = row.passed && c.passed;
      if (!c.passed && c.gap) row.gaps.push(c.gap);
    }
    row.clauses.push(`${packId}:${c.code}`);
    into.set(c.controlId, row);
  }
}

export { REGION_PACKS };
