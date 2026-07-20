import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { AIModelEntity, DeploymentGateEventEntity, ProjectEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { InventoryService } from '../inventory/inventory.service';
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
    private readonly inventory: InventoryService,
  ) {}

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
