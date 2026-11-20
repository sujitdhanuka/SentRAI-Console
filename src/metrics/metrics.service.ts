import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AIModelEntity, DriftReportEntity } from '../database/entities';
import { DriftStatus } from '../common/enums';
import { modelEntityToEntry } from '../inventory/model.mapper';
import { frameworkBlockingGaps, validateEuAiAct, validateIso42001, validateNistRmf } from '../compliance/frameworks.validator';

const DRIFT_ALERT_STATES = new Set<string>([
  DriftStatus.WARNING,
  DriftStatus.CIRCUIT_BREAKER_TRIPPED,
  DriftStatus.HUMAN_REVIEW_REQUIRED,
]);

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
  ) {}

  async render(): Promise<string> {
    const models = await this.models.find({ where: { isActive: true } });
    const totalModels = models.length;

    let compliantCount = 0;
    let totalGaps = 0;
    for (const orm of models) {
      const entry = modelEntityToEntry(orm);
      const gaps =
        frameworkBlockingGaps(validateNistRmf(entry)).length +
        frameworkBlockingGaps(validateEuAiAct(entry)).length +
        frameworkBlockingGaps(validateIso42001(entry)).length;
      totalGaps += gaps;
      if (gaps === 0) compliantCount += 1;
    }

    // Latest drift status per model.
    const allDrifts = await this.drifts.find({ order: { computedAt: 'DESC' } });
    const latest = new Map<string, string>();
    for (const dr of allDrifts) {
      if (!latest.has(dr.modelId)) latest.set(dr.modelId, dr.status);
    }
    // NOTE: the Python original compared against lowercase strings that never
    // match the uppercase DriftStatus values, so it always reported 0. Fixed here.
    let driftAlerts = 0;
    for (const status of latest.values()) {
      if (DRIFT_ALERT_STATES.has(status)) driftAlerts += 1;
    }

    const lines = [
      '# HELP sentrai_models_total Total number of registered models.',
      '# TYPE sentrai_models_total gauge',
      `sentrai_models_total ${totalModels}`,
      '# HELP sentrai_compliant_models_total Models with no blocking gaps in the framework field checks (not a compliance assessment; name kept for existing dashboards).',
      '# TYPE sentrai_compliant_models_total gauge',
      `sentrai_compliant_models_total ${compliantCount}`,
      '# HELP sentrai_open_governance_gaps Total number of outstanding regulatory framework gaps.',
      '# TYPE sentrai_open_governance_gaps gauge',
      `sentrai_open_governance_gaps ${totalGaps}`,
      '# HELP sentrai_drift_alerts_total Total number of models with warnings or active drift.',
      '# TYPE sentrai_drift_alerts_total gauge',
      `sentrai_drift_alerts_total ${driftAlerts}`,
    ];
    return lines.join('\n') + '\n';
  }
}
