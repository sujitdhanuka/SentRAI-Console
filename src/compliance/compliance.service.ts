import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { AIModelEntity, DeploymentGateEventEntity, DriftReportEntity, ProjectEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { InventoryService } from '../inventory/inventory.service';
import { SummarizerService } from '../summarizer/summarizer.service';
import { FRAMEWORK_NAMES, frameworkReadiness, gapStatement } from './control-plain-english';

const FRAMEWORK_IDS = ['rbi_free_ai', 'nist_ai_rmf', 'eu_ai_act', 'iso_42001'] as const;
const HIGH_RISK = new Set(['HIGH', 'CRITICAL', 'PROHIBITED']);

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
  /** Shift-left signal from the CI pre-deployment gate ledger. */
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
    private readonly inventory: InventoryService,
    private readonly summarizer: SummarizerService,
  ) {}

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

    const components = [] as Record<string, any>[];
    const gaps = [] as Record<string, any>[];
    for (const m of models) {
      const report = await this.inventory.complianceCheck(m.id);
      const perFw: Array<[string, string, any]> = [
        ['rbi', 'RBI FREE-AI', report],
        ['nist', 'NIST AI RMF', report.nist_rmf],
        ['eu', 'EU AI Act', report.eu_ai_act],
        ['iso', 'ISO 42001', report.iso_42001],
      ];
      const frameworks: Record<string, { status: string }> = {};
      for (const [key, label, r] of perFw) {
        frameworks[key] = { status: r?.overall_pass ? 'ok' : 'gap' };
        for (const g of r?.blocking_gaps ?? []) {
          gaps.push({ model_id: m.id, framework: label, description: g, severity: severity(m.riskLevel) });
        }
      }
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
        last_red_team_date: m.lastRedTeamDate,
        next_audit_due: m.nextAuditDue,
        grievance_count: m.grievanceCount,
        has_evidence: (m.evidenceArtifacts?.length ?? 0) > 0,
        drift: driftUi(driftByModel.get(m.id)),
        frameworks,
      });
    }
    return { generated_at: new Date().toISOString(), components, gaps };
  }

  /**
   * Portfolio-level compliance rollup: runs every framework validator over every
   * (optionally project-scoped) model and aggregates pass rates, risk-tier
   * distribution, and the most common blocking gaps — in plain language.
   */
  async portfolio(user: CurrentUser, projectId?: string | null): Promise<PortfolioReport> {
    const qb = this.models.createQueryBuilder('m').where('m.isActive = 1');
    if (user.role !== Role.ADMIN && user.tenantId) {
      qb.innerJoin(ProjectEntity, 'p', 'p.id = m.projectId').andWhere('p.tenantId = :tid', { tid: user.tenantId });
    }
    if (projectId) qb.andWhere('m.projectId = :pid', { pid: projectId });
    const models = await qb.getMany();

    const fw: Record<string, { assessed: number; passing: number; open_gaps: number }> = {};
    for (const id of FRAMEWORK_IDS) fw[id] = { assessed: 0, passing: 0, open_gaps: 0 };
    const riskTiers: Record<string, number> = {};
    const gapCounts = new Map<string, { framework: string; control: string; name: string; count: number }>();
    let fullyCompliant = 0;
    let totalGaps = 0;
    let highRisk = 0;

    for (const m of models) {
      riskTiers[m.riskLevel] = (riskTiers[m.riskLevel] ?? 0) + 1;
      if (HIGH_RISK.has(m.riskLevel)) highRisk += 1;

      const report = await this.inventory.complianceCheck(m.id);
      const perFw: Array<[string, any]> = [
        ['rbi_free_ai', report], // the sutras report is the top-level object
        ['nist_ai_rmf', report.nist_rmf],
        ['eu_ai_act', report.eu_ai_act],
        ['iso_42001', report.iso_42001],
      ];

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
            const g = gapCounts.get(key) ?? { framework: fwId, control: code, name: c.name ?? c.sutra, count: 0 };
            g.count += 1;
            gapCounts.set(key, g);
          }
        }
      }
      if (allPass && perFw.every(([, r]) => r)) fullyCompliant += 1;
    }

    const total = models.length;
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
        : `${fullyCompliant} of ${total} models (${Math.round(rate * 100)}%) fully compliant across all four frameworks; ` +
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
      frameworks: FRAMEWORK_IDS.map((id) => ({
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
    };
  }

  /**
   * Draft the board-facing executive paragraph for a portfolio. Grounded in the
   * rollup's actual numbers — the model is given the computed statistics, not
   * asked to infer them — and persisted per project so the readiness report and
   * the console show the same text. Org-wide scope is returned but not stored.
   */
  async execNarrative(user: CurrentUser, projectId?: string | null) {
    const report = await this.portfolio(user, projectId);
    const s = report.summary;

    const portfolioStats = [
      `${s.total_models} models registered`,
      `${s.fully_compliant} fully compliant across all four frameworks (${Math.round(s.compliance_rate * 100)}%)`,
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
        `${s.headline} Across the four frameworks the portfolio shows ` +
        `${report.frameworks.map((f) => `${f.name} at ${Math.round(f.pass_rate * 100)}%`).join(', ')}. ` +
        `Most material gaps: ${topGaps}. Pre-deployment enforcement: ${ciMetrics}. ` +
        '(Auto-generated — review before board circulation.)',
      user?.email ?? 'dashboard_user',
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
