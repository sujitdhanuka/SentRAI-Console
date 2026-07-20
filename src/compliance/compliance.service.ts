import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AIModelEntity, ProjectEntity } from '../database/entities';
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
}

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
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
    };
  }
}
