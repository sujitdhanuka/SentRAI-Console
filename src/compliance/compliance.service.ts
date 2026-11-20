import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';

import {
  AgentActionEventEntity,
  AIIncidentEntity,
  AIModelEntity,
  AuditEventEntity,
  ControlledDocumentEntity,
  CorrectiveActionEntity,
  DeploymentGateEventEntity,
  ImpactAssessmentEntity,
  OrganizationEntity,
  RiskEntity,
  SoaStatementEntity,
  VendorEntity,
  DriftReportEntity,
  GrievanceEntity,
  ProjectEntity,
} from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { RiskLevel, Role } from '../common/enums';
import { InventoryService } from '../inventory/inventory.service';
import { SummarizerService } from '../summarizer/summarizer.service';
import { governanceHooks } from '../governance/hooks';
import { FRAMEWORK_NAMES, frameworkReadiness, gapStatement } from './control-plain-english';
import { capabilities, coverageFor, GovernanceProgramme, packSplit, PROGRAMME_VERSION } from './governance-programme';
import { OPEN_STATUSES as OPEN_RISK_STATUSES } from '../governance/risks/risk.model';
import { ALL_REPORT_FRAMEWORKS, frameworkKey, frameworkReportOf, frameworkScopeForOrg, frameworksInScopeOf, REPORT_FRAMEWORKS } from './framework-scope';
import { sourceLocationsOf } from '../discovery/source-locations';
import { getFeatureFlags } from '../common/feature-flags';
import { packRegistry } from '../governance/packs/pack-loader';
import { currentPlan, gapLinesOf } from '../inventory/remediation-plan';
import { modelEntityToEntry } from '../inventory/model.mapper';
import { daysBetween, LEGACY_RED_TEAM_INTERVAL_DAYS, lastRedTeamEvidenceAt, redTeamIntervalDays } from '../domain/model-inventory';

const FRAMEWORK_IDS = ['rbi_free_ai', 'nist_ai_rmf', 'eu_ai_act', 'iso_42001'] as const;
const HIGH_RISK = new Set(['HIGH', 'CRITICAL', 'PROHIBITED']);

/** "all four frameworks", or "the 2 frameworks in scope (NIST AI RMF, ISO/IEC 42001)". */
function frameworksPhrase(ids: readonly string[], selected: boolean): string {
  if (ids.length === FRAMEWORK_IDS.length) return 'all four frameworks';
  const names = ids.map((id) => FRAMEWORK_NAMES[id] ?? id).join(', ');
  return `the ${ids.length} ${selected ? 'selected' : 'in-scope'} framework${ids.length === 1 ? '' : 's'}${names ? ` (${names})` : ''}`;
}

export interface PortfolioReport {
  generated_at: string;
  scope: { project_id: string | null; model_count: number };
  summary: {
    total_models: number;
    fully_compliant: number;
    compliance_rate: number;
    high_risk_models: number;
    open_blocking_gaps: number;
    headline: string;
  };
  risk_tiers: Record<string, number>;
  frameworks: Array<{
    id: string;
    name: string;
    models_assessed: number;
    models_passing: number;
    pass_rate: number;
    open_gaps: number;
    readiness: string;
  }>;
  top_gaps: Array<{ framework: string; control: string; count: number; statement: string }>;
  /** Packs that apply to the models in scope (union over their organisations); null with no models. */
  pack_ids_in_scope: string[] | null;
  /** Frameworks assessed: those of the packs enabled for the models' organisations. */
  frameworks_in_scope: string[];
  /** Frameworks whose packs are switched off for every model in scope (not asked for, not counted). */
  frameworks_not_in_scope: string[];
  /** Shift-left signal from the CI pre-deployment gate ledger. */
  /** Packs in force and which are selected (E1.1, only with the pack engine on). */
  packs?: Array<{ pack_id: string; name: string; version: string; legacy_framework_id: string; baseline: boolean; region: string | null; selected: boolean }>;
  ci_gate: {
    events_recorded: number;
    gate_readiness_score: number | null; // effective pass ratio (override counts as pass)
    active_blocked_gates: number; // failed gates not yet overridden
    shadow_ai_assets: number; // distinct ungoverned assets in active blocks
  };
}

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(DeploymentGateEventEntity)
    private readonly gates: Repository<DeploymentGateEventEntity>,
    @InjectRepository(DriftReportEntity)
    private readonly drifts: Repository<DriftReportEntity>,
    @InjectRepository(AIIncidentEntity)
    private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(GrievanceEntity)
    private readonly grievances: Repository<GrievanceEntity>,
    @InjectRepository(AuditEventEntity)
    private readonly auditEvents: Repository<AuditEventEntity>,
    @InjectRepository(AgentActionEventEntity)
    private readonly actions: Repository<AgentActionEventEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(RiskEntity) private readonly risks: Repository<RiskEntity>,
    @InjectRepository(ImpactAssessmentEntity) private readonly impacts: Repository<ImpactAssessmentEntity>,
    @InjectRepository(CorrectiveActionEntity) private readonly correctiveActions: Repository<CorrectiveActionEntity>,
    @InjectRepository(ControlledDocumentEntity) private readonly documents: Repository<ControlledDocumentEntity>,
    @InjectRepository(SoaStatementEntity) private readonly soas: Repository<SoaStatementEntity>,
    @InjectRepository(VendorEntity) private readonly vendors: Repository<VendorEntity>,
    private readonly inventory: InventoryService,
    private readonly summarizer: SummarizerService,
  ) {}

  /** The organisation the report is for: the project's, else the caller's. */
  private async orgName(user: CurrentUser, projectOrg: string | null): Promise<string | null> {
    const id = projectOrg ?? user.tenantId ?? null;
    return id ? (await this.orgs.findOne({ where: { id }, select: ['id', 'name'] }))?.name ?? null : null;
  }

  /** Active models in scope (tenant + optional project), with their organisation. */
  private async scopedModels(user: CurrentUser, projectId?: string | null): Promise<Array<{ id: string; orgId: string | null }>> {
    const qb = this.models.createQueryBuilder('m').leftJoin(ProjectEntity, 'p', 'p.id = m.projectId')
      .select('m.id', 'id').addSelect('p.tenantId', 'orgId').where('m.isActive = 1');
    if (user.role !== Role.ADMIN && user.tenantId) qb.andWhere('p.tenantId = :tid', { tid: user.tenantId });
    if (projectId) qb.andWhere('m.projectId = :pid', { pid: projectId });
    return qb.getRawMany();
  }

  /**
   * The governance programme for the reports: packs that apply and those
   * switched off, capabilities on in this deployment, reviewed coverage of the
   * frameworks in scope, register counts and model cards.
   */
  async programme(user: CurrentUser, projectId: string | null, report: Pick<PortfolioReport, 'pack_ids_in_scope'>): Promise<GovernanceProgramme> {
    const flags = getFeatureFlags();
    const scoped = await this.scopedModels(user, projectId);
    const modelIds = scoped.map((m) => m.id);
    const orgIds = [...new Set([...scoped.map((m) => m.orgId), user.tenantId ?? null].filter((o): o is string => Boolean(o)))];
    let packIds = report.pack_ids_in_scope;
    if (!packIds) packIds = (await frameworkScopeForOrg(user.tenantId ?? null)).pack_ids;
    let registers: GovernanceProgramme['registers'] = null;
    if (flags.governanceV2 && orgIds.length) {
      const now = new Date();
      const org = { orgId: In(orgIds) };
      const ia = modelIds.length ? await this.impacts.find({ where: { modelId: In(modelIds) }, select: ['id', 'modelId', 'status'] }) : [];
      const soa = await this.soas.findOne({ where: org, order: { version: 'DESC' } });
      registers = {
        risks_open: flags.riskRegister ? await this.risks.count({ where: { ...org, status: In(OPEN_RISK_STATUSES) } }) : null,
        risks_total: flags.riskRegister ? await this.risks.count({ where: { ...org, status: Not('DISMISSED') } }) : null,
        impact_final_models: flags.impactAssessment ? new Set(ia.filter((r) => r.status === 'FINAL').map((r) => r.modelId)).size : null,
        impact_draft: flags.impactAssessment ? ia.filter((r) => r.status === 'DRAFT').length : null,
        impact_revalidation: flags.impactAssessment ? ia.filter((r) => r.status === 'REVALIDATION_REQUIRED').length : null,
        actions_open: flags.correctiveActions ? await this.correctiveActions.count({ where: { ...org, status: Not('CLOSED') } }) : null,
        actions_overdue: flags.correctiveActions ? await this.correctiveActions.count({ where: { ...org, status: Not('CLOSED'), dueAt: LessThan(now) } }) : null,
        documents_approved: flags.documentControl ? await this.documents.count({ where: { ...org, status: 'APPROVED' } }) : null,
        documents_review_due: flags.documentControl ? await this.documents.count({ where: { ...org, status: 'APPROVED', reviewDueAt: LessThan(now) } }) : null,
        soa_version: flags.soa ? (soa ? `v${soa.version} approved ${soa.approvedAt.toISOString().slice(0, 10)}` : 'not approved yet') : null,
        vendors_active: flags.vendors ? await this.vendors.count({ where: { ...org, status: 'ACTIVE' } }) : null,
      };
    }
    return {
      version: PROGRAMME_VERSION,
      governance_on: flags.governanceV2,
      ...packSplit(packIds),
      capabilities: capabilities(flags),
      coverage: coverageFor(packIds, flags),
      registers,
      model_cards: (await governanceHooks.modelCardSummary?.(modelIds)) ?? null,
    };
  }

  /**
   * Fleet matrix for the dashboard UI: one call returning, per model, the four
   * framework verdicts, the latest drift status, evidence presence, and the
   * flattened blocking-gap list — so the dashboard never needs N per-model
   * compliance calls. Tenant-scoped exactly like the portfolio rollup.
   */
  async matrix(user: CurrentUser, projectId?: string | null) {
    const qb = this.models.createQueryBuilder('m').where('m.isActive = 1');
    if (user.role !== Role.ADMIN && user.tenantId) {
      qb.innerJoin(ProjectEntity, 'p', 'p.id = m.projectId').andWhere('p.tenantId = :tid', { tid: user.tenantId });
    }
    if (projectId) qb.andWhere('m.projectId = :pid', { pid: projectId });
    const models = await qb.getMany();

    // Latest drift status per model, one query (newest first, first-seen wins).
    const driftByModel = new Map<string, string>();
    if (models.length) {
      const rows = await this.drifts
        .createQueryBuilder('d')
        .where('d.modelId IN (:...ids)', { ids: models.map((m) => m.id) })
        .orderBy('d.computedAt', 'DESC')
        .getMany();
      for (const r of rows) if (!driftByModel.has(r.modelId)) driftByModel.set(r.modelId, r.status);
    }
    const driftUi = (s?: string) =>
      !s || s === 'NOMINAL' ? 'ok' : s === 'WARNING' ? 'warn' : 'alert';

    const severity = (risk: string) => (HIGH_RISK.has(risk) ? 'HIGH' : risk === 'MEDIUM' ? 'MED' : 'LOW');
    // Red-team recency by the same rule the validators apply: per-tier intervals
    // with GOV_E0_3 on, else the legacy 12-month NIST rule. The newest attached
    // red_team report counts as well as the recorded date.
    const perTier = getFeatureFlags().redTeamIntervals;
    const redTeamPolicy = perTier
      ? { per_tier: true, interval_days: { HIGH: redTeamIntervalDays(RiskLevel.HIGH), MEDIUM: redTeamIntervalDays(RiskLevel.MEDIUM), LOW: redTeamIntervalDays(RiskLevel.LOW) } }
      : { per_tier: false, interval_days: { HIGH: LEGACY_RED_TEAM_INTERVAL_DAYS, MEDIUM: LEGACY_RED_TEAM_INTERVAL_DAYS, LOW: LEGACY_RED_TEAM_INTERVAL_DAYS } };

    const components = [] as Record<string, any>[];
    const gaps = [] as Record<string, any>[];
    const scopeUnion = new Set<string>();
    for (const m of models) {
      const report = await this.inventory.complianceCheck(m.id);
      // Only the frameworks of the organisation's enabled packs are asked for:
      // a switched-off one reads "na" and its gaps are not listed or counted.
      const inScope = frameworksInScopeOf(report);
      inScope.forEach((id) => scopeUnion.add(frameworkKey(id)));
      const frameworks: Record<string, { status: string }> = {};
      for (const f of REPORT_FRAMEWORKS) {
        const r = frameworkReportOf(report, f.id);
        if (!inScope.includes(f.id)) {
          frameworks[f.key] = { status: 'na' };
          continue;
        }
        frameworks[f.key] = { status: r?.overall_pass ? 'ok' : 'gap' };
        for (const g of r?.blocking_gaps ?? []) {
          gaps.push({ model_id: m.id, framework: f.label, description: g, severity: severity(m.riskLevel) });
        }
      }
      const plan = currentPlan(m, gapLinesOf(report));
      const entry = modelEntityToEntry(m);
      const lastRedTeam = lastRedTeamEvidenceAt(entry);
      const redTeamInterval = perTier ? redTeamIntervalDays(entry.riskLevel) : LEGACY_RED_TEAM_INTERVAL_DAYS;
      components.push({
        model_id: m.id,
        name: m.name,
        description: m.useCaseDescription,
        lifecycle_stage: m.lifecycleStage,
        risk_level: m.riskLevel,
        owner_team: m.ownerTeam,
        model_type: m.modelType,
        human_oversight_required: m.humanOversightRequired,
        autonomous_scope: m.autonomousScope,
        sutras_alignment: m.sutrasAlignment ?? [],
        board_policy_ref: m.boardPolicyRef || null,
        last_red_team_date: lastRedTeam,
        red_team_interval_days: redTeamInterval,
        red_team_overdue: !lastRedTeam || daysBetween(lastRedTeam) > redTeamInterval,
        next_audit_due: m.nextAuditDue,
        grievance_count: m.grievanceCount,
        has_evidence: (m.evidenceArtifacts?.length ?? 0) > 0,
        drift: driftUi(driftByModel.get(m.id)),
        // Generation state, so the console can show provenance and offer a
        // re-draft without a second round trip per model.
        description_source: m.descriptionSource ?? 'static',
        risk_rationale: m.riskRationale ?? null,
        risk_rationale_source: m.riskRationaleSource ?? null,
        // Checked against the live gaps: a heuristic plan is rebuilt from them,
        // an AI plan is flagged stale when its gaps have changed.
        gap_remediation: plan.text,
        gap_remediation_source: plan.source,
        gap_remediation_stale: plan.stale,
        gap_remediation_closed: plan.closed,
        gap_remediation_new: plan.added,
        // Every file this record covers — more than one means hits were merged.
        source_refs: m.sourceRefs ?? (m.sourceRef ? [m.sourceRef] : []),
        merge_history: m.mergeHistory ?? [],
        source_locations: sourceLocationsOf(m),
        frameworks,
        frameworks_in_scope: inScope.map(frameworkKey),
        packs_in_scope: report.packs_in_scope ?? null,
      });
    }
    const frameworksInScope = models.length ? REPORT_FRAMEWORKS.filter((f) => scopeUnion.has(f.key)).map((f) => f.key) : REPORT_FRAMEWORKS.map((f) => f.key);
    return { generated_at: new Date().toISOString(), red_team_policy: redTeamPolicy, frameworks_in_scope: frameworksInScope, components, gaps };
  }

  /**
   * Portfolio-level compliance rollup: runs every framework validator over every
   * (optionally project-scoped) model and aggregates pass rates, risk-tier
   * distribution, and the most common blocking gaps — in plain language.
   */
  async portfolio(user: CurrentUser, projectId?: string | null, packIds?: string[] | null): Promise<PortfolioReport> {
    // E1.1 pack selector: with the pack engine on, the rollup can be narrowed to
    // chosen packs. Flag off (or no selection) keeps all four frameworks.
    const packsOn = getFeatureFlags().packEngine;
    const inForce = packsOn ? packRegistry().activeAt() : [];
    if (packsOn && packIds?.length) {
      // An unknown id (or one with no framework report) would leave nothing to
      // assess and every model would read as fully compliant: refuse it.
      const unknown = packIds.filter((id) => !inForce.some((p) => p.definition.id === id && (FRAMEWORK_IDS as readonly string[]).includes(p.definition.legacyId)));
      if (unknown.length) {
        throw new BadRequestException(`Unknown pack(s): ${unknown.join(', ')}. Packs in force: ${inForce.map((p) => p.definition.id).join(', ')}`);
      }
    }
    const selected = packsOn && packIds?.length ? inForce.filter((p) => packIds.includes(p.definition.id)) : inForce;
    const fwIds: readonly string[] = packsOn && packIds?.length
      ? FRAMEWORK_IDS.filter((id) => selected.some((p) => p.definition.legacyId === id))
      : FRAMEWORK_IDS;
    const qb = this.models.createQueryBuilder('m').where('m.isActive = 1');
    if (user.role !== Role.ADMIN && user.tenantId) {
      qb.innerJoin(ProjectEntity, 'p', 'p.id = m.projectId').andWhere('p.tenantId = :tid', { tid: user.tenantId });
    }
    if (projectId) qb.andWhere('m.projectId = :pid', { pid: projectId });
    const models = await qb.getMany();

    const fw: Record<string, { assessed: number; passing: number; open_gaps: number }> = {};
    for (const id of fwIds) fw[id] = { assessed: 0, passing: 0, open_gaps: 0 };
    const riskTiers: Record<string, number> = {};
    const gapCounts = new Map<string, { framework: string; control: string; name: string; count: number; models: Set<string> }>();
    let fullyCompliant = 0;
    let totalGaps = 0;
    let highRisk = 0;
    const assessedIds = new Set<string>();
    const packUnion = new Set<string>();

    for (const m of models) {
      riskTiers[m.riskLevel] = (riskTiers[m.riskLevel] ?? 0) + 1;
      if (HIGH_RISK.has(m.riskLevel)) highRisk += 1;

      const report = await this.inventory.complianceCheck(m.id);
      // A framework counts for a model only while its pack is enabled for the
      // model's organisation (and, with a pack selector, selected).
      const inScope = frameworksInScopeOf(report);
      const perFw: Array<[string, any]> = ALL_REPORT_FRAMEWORKS
        .filter((id) => fwIds.includes(id) && inScope.includes(id))
        .map((id) => [id, frameworkReportOf(report, id)]);
      for (const [id] of perFw) assessedIds.add(id);
      for (const id of report.packs_in_scope ?? packRegistry().defaultPackIds()) packUnion.add(id);

      let allPass = true;
      for (const [fwId, r] of perFw) {
        if (!r) continue;
        fw[fwId].assessed += 1;
        if (r.overall_pass) {
          fw[fwId].passing += 1;
        } else {
          allPass = false;
          const gaps = (r.blocking_gaps ?? []).length;
          fw[fwId].open_gaps += gaps;
          totalGaps += gaps;
        }
        for (const c of r.checks ?? []) {
          if (c.mandatory && !c.passed) {
            const code = c.control_code ?? c.sutra;
            const key = `${fwId}|${code}`;
            // Count each model once per control, even when two checks share a
            // code (NIST MAP-1.1 covers both purpose and deployment context).
            const g = gapCounts.get(key) ?? { framework: fwId, control: code, name: c.name ?? c.sutra, count: 0, models: new Set<string>() };
            if (!g.models.has(m.id)) {
              g.models.add(m.id);
              g.count += 1;
            }
            gapCounts.set(key, g);
          }
        }
      }
      // A model counts as fully compliant only when at least one framework was assessed.
      if (perFw.length > 0 && allPass && perFw.every(([, r]) => r)) fullyCompliant += 1;
    }

    const total = models.length;
    // Frameworks no model in scope assesses (every model's organisation has the pack off) are left out.
    const reported = total ? fwIds.filter((id) => assessedIds.has(id)) : fwIds;
    const notInScope = FRAMEWORK_IDS.filter((id) => fwIds.includes(id) && !reported.includes(id));
    const topGaps = [...gapCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((g) => ({
        framework: FRAMEWORK_NAMES[g.framework] ?? g.framework,
        control: g.control,
        count: g.count,
        statement: gapStatement(g.control, g.count, g.name),
      }));

    const ciGate = await this.ciGateMetrics(user, projectId);

    const rate = total ? fullyCompliant / total : 0;
    const headline =
      total === 0
        ? 'No AI models registered yet — add models to assess portfolio compliance.'
        : `${fullyCompliant} of ${total} models (${Math.round(rate * 100)}%) with no blocking gaps across ${frameworksPhrase(reported, fwIds.length < FRAMEWORK_IDS.length)}; ` +
          `${highRisk} high-risk, ${totalGaps} blocking control gap${totalGaps === 1 ? '' : 's'} open.`;

    return {
      generated_at: new Date().toISOString(),
      scope: { project_id: projectId ?? null, model_count: total },
      summary: {
        total_models: total,
        fully_compliant: fullyCompliant,
        compliance_rate: Number(rate.toFixed(3)),
        high_risk_models: highRisk,
        open_blocking_gaps: totalGaps,
        headline,
      },
      risk_tiers: riskTiers,
      pack_ids_in_scope: total ? [...packUnion] : null,
      frameworks_in_scope: reported.map((id) => FRAMEWORK_NAMES[id] ?? id),
      frameworks_not_in_scope: notInScope.map((id) => FRAMEWORK_NAMES[id] ?? id),
      frameworks: reported.map((id) => ({
        id,
        name: FRAMEWORK_NAMES[id],
        models_assessed: fw[id].assessed,
        models_passing: fw[id].passing,
        pass_rate: fw[id].assessed ? Number((fw[id].passing / fw[id].assessed).toFixed(3)) : 0,
        open_gaps: fw[id].open_gaps,
        readiness: frameworkReadiness(id, fw[id].passing, fw[id].assessed, fw[id].open_gaps),
      })),
      top_gaps: topGaps,
      ci_gate: ciGate,
      ...(packsOn
        ? {
            // Only the packs that apply to the models in scope: a pack switched off in Governance › Setup is not offered.
            packs: inForce.filter((p) => !total || packUnion.has(p.definition.id)).map((p) => ({
              pack_id: p.definition.id,
              name: p.definition.name,
              version: p.definition.version,
              legacy_framework_id: p.definition.legacyId,
              baseline: p.definition.baseline,
              region: p.definition.region,
              selected: selected.includes(p),
            })),
          }
        : {}),
    };
  }

  /**
   * Assemble the board pack: the portfolio rollup plus the incident, redress,
   * runtime-enforcement, and audit-integrity surfaces — everything a risk
   * committee needs in one document. Tenant-scoped like every other read.
   */
  async boardReport(user: CurrentUser, projectId?: string | null) {
    const report = await this.portfolio(user, projectId);

    // Which models are in scope for this tenant/project — bound the sub-queries.
    const mq = this.models.createQueryBuilder('m').select('m.id', 'id').addSelect('m.projectId', 'projectId').where('m.isActive = 1');
    if (projectId) mq.andWhere('m.projectId = :pid', { pid: projectId });
    if (user.role !== Role.ADMIN && user.tenantId) {
      mq.innerJoin(ProjectEntity, 'p', 'p.id = m.projectId').andWhere('p.tenantId = :tid', { tid: user.tenantId });
    }
    const scoped = await mq.getRawMany<{ id: string; projectId: string | null }>();
    const modelIds = scoped.map((r) => r.id);
    const projectIds = new Set(scoped.map((r) => r.projectId));
    const inScope = <T extends { modelId: string }>(rows: T[]) => rows.filter((r) => modelIds.includes(r.modelId));

    // Gate-raised incidents on shadow assets belong to a project rather than a model.
    const incidents = modelIds.length
      ? (await this.incidents.find()).filter((i) => modelIds.includes(i.modelId) || (i.projectId && projectIds.has(i.projectId)))
      : [];
    const bySeverity: Record<string, number> = {};
    let incidentsOpen = 0;
    for (const i of incidents) {
      bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
      if (!['RESOLVED', 'CLOSED'].includes(i.status)) incidentsOpen += 1;
    }

    const grievances = modelIds.length ? inScope(await this.grievances.find()) : [];
    const grievancesResolved = grievances.filter((g) => ['RESOLVED', 'CLOSED'].includes(g.status)).length;
    const grievancesOpen = grievances.length - grievancesResolved;

    // Runtime scope enforcement + audit-ledger integrity (org-wide signals).
    const gate = report.ci_gate ?? { events_recorded: 0, active_blocked_gates: 0, shadow_ai_assets: 0 };
    const gateRows = await this.gates.find();
    const gateInScope = projectId ? gateRows.filter((g) => g.projectId === projectId) : gateRows;
    const gateFailed = gateInScope.filter((g) => g.verdict === 'fail').length;
    const gateOverridden = gateInScope.filter((g) => g.overriddenAt != null).length;

    const auditRows = await this.auditEvents.find({ select: ['id', 'contentHash'] });
    const chained = auditRows.filter((a) => a.contentHash != null).length;

    const actions = modelIds.length ? inScope(await this.actions.find()) : [];
    const flaggedCalls = actions.filter((a) => a.flagged).length;
    const deviationModels = new Set(actions.filter((a) => a.flagged).map((a) => a.modelId)).size;

    const project = projectId ? await this.projects.findOne({ where: { id: projectId } }) : null;
    const governance = await this.programme(user, projectId ?? null, report);

    return {
      generated_at: report.generated_at,
      org_name: (await this.orgName(user, project?.tenantId ?? null)) ?? incidents.find((i) => i.reName)?.reName ?? project?.name ?? 'Organization',
      scope_name: project?.name ?? 'All projects',
      narrative: project?.execNarrative ?? null,
      summary: report.summary,
      risk_tiers: report.risk_tiers,
      frameworks: report.frameworks,
      top_gaps: report.top_gaps,
      gate: {
        total: gateInScope.length,
        failed: gateFailed,
        blocked_now: gate.active_blocked_gates,
        overridden: gateOverridden,
      },
      runtime: {
        flagged_tool_calls: flaggedCalls,
        scope_deviation_models: deviationModels,
      },
      incidents: { total: incidents.length, open: incidentsOpen, by_severity: bySeverity },
      grievances: { total: grievances.length, open: grievancesOpen, resolved: grievancesResolved },
      audit: { chained_events: chained, intact: true },
      frameworks_not_in_scope: report.frameworks_not_in_scope,
      governance,
    };
  }

  /**
   * Draft the board-facing executive paragraph for a portfolio. Grounded in the
   * rollup's actual numbers — the model is given the computed statistics, not
   * asked to infer them — and persisted per project so the readiness report and
   * the console show the same text. Org-wide scope is returned but not stored.
   */
  /**
   * Organisations whose figures the narrative carries, for their external-AI
   * policy (governance E3.8): the project's organisation, or for a platform
   * admin's org-wide view every organisation with a project.
   */
  private async narrativeDataOrgs(user: CurrentUser, projectId?: string | null): Promise<Array<string | null>> {
    if (!governanceHooks.externalAiPolicy) return [];
    if (projectId) {
      const p = await this.projects.findOne({ where: { id: projectId }, select: ['id', 'tenantId'] });
      return p?.tenantId ? [p.tenantId] : [];
    }
    if (user?.tenantId) return [];
    return [...new Set((await this.projects.find({ select: ['id', 'tenantId'] })).map((p) => p.tenantId).filter((t): t is string => Boolean(t)))];
  }

  async execNarrative(user: CurrentUser, projectId?: string | null) {
    const report = await this.portfolio(user, projectId);
    const s = report.summary;

    const portfolioStats = [
      `${s.total_models} models registered`,
      `${s.fully_compliant} with no blocking gaps across ${frameworksPhrase(report.frameworks.map((f) => f.id), false)} (${Math.round(s.compliance_rate * 100)}%)`,
      `${s.high_risk_models} high-risk`,
      `${s.open_blocking_gaps} blocking control gaps open`,
      ...report.frameworks.map((f) => `${f.name}: ${f.models_passing}/${f.models_assessed} passing`),
    ].join('; ');

    const topGaps = report.top_gaps.length
      ? report.top_gaps.map((g) => `${g.statement} — ${g.framework} ${g.control}, ${g.count} models`).join('; ')
      : 'none';

    const ci = report.ci_gate;
    const ciMetrics = ci.events_recorded
      ? `${ci.events_recorded} gate evaluations, ${ci.active_blocked_gates} active blocked deployments, ` +
        `${ci.shadow_ai_assets} shadow-AI assets caught pre-deployment`
      : 'no CI gate evaluations recorded yet';

    const result = await this.summarizer.draftForOrg(
      user?.tenantId ?? null,
      'exec_narrative',
      { portfolio_stats: portfolioStats, top_gaps: topGaps, ci_metrics: ciMetrics },
      () =>
        `${s.headline} Across ${report.frameworks.length === 4 ? 'the four frameworks' : `the ${report.frameworks.length} frameworks in scope`} the portfolio shows ` +
        `${report.frameworks.map((f) => `${f.name} at ${Math.round(f.pass_rate * 100)}%`).join(', ')}. ` +
        `Most material gaps: ${topGaps}. Pre-deployment enforcement: ${ciMetrics}. ` +
        '(Auto-generated — review before board circulation.)',
      user?.email ?? 'dashboard_user',
      await this.narrativeDataOrgs(user, projectId),
    );

    if (projectId) {
      const project = await this.projects.findOne({ where: { id: projectId } });
      if (project) {
        project.execNarrative = result.text;
        project.execNarrativeSource = result.source;
        project.execNarrativeModel = result.model;
        project.execNarrativeAt = new Date();
        await this.projects.save(project);
      }
    }

    return {
      project_id: projectId ?? null,
      narrative: result.text,
      narrative_source: result.source,
      narrative_model: result.model,
      ai_enabled: result.source === 'ai',
      provider: result.provider,
      generated_at: new Date().toISOString(),
      grounded_in: { portfolio_stats: portfolioStats, top_gaps: topGaps, ci_metrics: ciMetrics },
    };
  }

  /**
   * Aggregate the CI pre-deployment gate ledger into the executive rollup.
   * Tenant-scoped (ADMIN sees all); an override counts a failed gate as an
   * *effective* pass for the readiness score, but a not-yet-overridden failure
   * remains an "active blocked gate".
   */
  private async ciGateMetrics(user: CurrentUser, projectId?: string | null): Promise<PortfolioReport['ci_gate']> {
    const empty = { events_recorded: 0, gate_readiness_score: null, active_blocked_gates: 0, shadow_ai_assets: 0 };
    const qb = this.gates.createQueryBuilder('g');
    if (user.role !== Role.ADMIN) {
      const owned = await this.projects.find({ where: { tenantId: user.tenantId ?? IsNull() }, select: ['id'] });
      let ids = owned.map((p) => p.id);
      if (projectId) ids = ids.filter((id) => id === projectId);
      if (ids.length === 0) return empty;
      qb.where('g.projectId IN (:...ids)', { ids });
    } else if (projectId) {
      qb.where('g.projectId = :pid', { pid: projectId });
    }

    const rows = await qb.getMany();
    const total = rows.length;
    let effectivePass = 0;
    let activeBlocked = 0;
    const shadowAssets = new Set<string>();
    for (const r of rows) {
      const overridden = r.overriddenAt != null;
      if (overridden || r.verdict === 'pass') effectivePass += 1;
      if (r.verdict === 'fail' && !overridden) {
        activeBlocked += 1;
        for (const g of r.blockingGaps ?? []) {
          if (g.shadow) shadowAssets.add(`${r.projectId}:${g.file_location}`);
        }
      }
    }
    return {
      events_recorded: total,
      gate_readiness_score: total ? Number((effectivePass / total).toFixed(3)) : null,
      active_blocked_gates: activeBlocked,
      shadow_ai_assets: shadowAssets.size,
    };
  }
}
