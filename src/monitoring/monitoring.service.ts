import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AIModelEntity, DriftReportEntity } from '../database/entities';
import { DriftStatus } from '../common/enums';
import { activateBcp, deactivateBcp, driftSummary, evaluateDrift } from '../domain/monitoring';
import { BcpStateStore } from './bcp-state.store';
import { getGpuUtilization } from './gpu-monitor';
import { BcpActivateDto, DriftEvaluationDto, DriftReportResponse } from './monitoring.dto';

@Injectable()
export class MonitoringService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
    private readonly bcp: BcpStateStore,
  ) {}

  async evaluateDrift(dto: DriftEvaluationDto): Promise<DriftReportResponse> {
    const model = await this.models.findOne({ where: { id: dto.model_id } });
    if (!model) throw new NotFoundException('Model not found');

    const report = evaluateDrift(
      dto.model_id,
      dto.training_scores,
      dto.live_scores,
      dto.baseline_accuracy,
      dto.current_accuracy,
    );

    await this.drifts.save(this.drifts.create({
      id: uuidv4(),
      modelId: dto.model_id,
      computedAt: report.computedAt,
      psiScore: report.psiScore,
      wassersteinDistance: report.wassersteinDistance,
      accuracyDelta: report.accuracyDelta,
      status: report.status,
      circuitBreakerActive: report.circuitBreakerActive,
      humanReviewTicket: report.humanReviewTicket,
      remediationAction: report.remediationAction,
    }));

    if (report.circuitBreakerActive) {
      const state = this.bcp.getOrCreate(dto.model_id);
      if (!state.fallbackActive) {
        activateBcp(state, `Circuit breaker: PSI=${report.psiScore.toFixed(3)}`, 'RULES_ENGINE_v2');
      }
    }

    return {
      model_id: report.modelId,
      computed_at: report.computedAt,
      psi_score: report.psiScore,
      wasserstein_distance: report.wassersteinDistance,
      accuracy_delta: report.accuracyDelta,
      status: report.status,
      circuit_breaker_active: report.circuitBreakerActive,
      human_review_ticket: report.humanReviewTicket,
      remediation_action: report.remediationAction,
      summary: driftSummary(report),
    };
  }

  async driftHistory(modelId: string, limit = 30): Promise<DriftReportResponse[]> {
    const rows = await this.drifts.find({
      where: { modelId },
      order: { computedAt: 'DESC' },
      take: limit,
    });
    return rows.map((r) => ({
      model_id: r.modelId,
      computed_at: r.computedAt,
      psi_score: r.psiScore,
      wasserstein_distance: r.wassersteinDistance,
      accuracy_delta: r.accuracyDelta,
      status: r.status as DriftStatus,
      circuit_breaker_active: r.circuitBreakerActive,
      human_review_ticket: r.humanReviewTicket,
      remediation_action: r.remediationAction,
      summary: `[${r.status}] PSI=${r.psiScore.toFixed(4)}`,
    }));
  }

  async activateBcp(modelId: string, dto: BcpActivateDto) {
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');

    const state = this.bcp.getOrCreate(modelId);
    activateBcp(state, dto.reason, dto.rules_engine_ref ?? null);
    return {
      model_id: modelId,
      bcp_active: true,
      reason: dto.reason,
      rules_engine: dto.rules_engine_ref ?? null,
      activated_at: state.fallbackActivatedAt ? state.fallbackActivatedAt.toISOString() : null,
    };
  }

  deactivateBcp(modelId: string) {
    const state = this.bcp.get(modelId);
    if (state) deactivateBcp(state);
    return { model_id: modelId, bcp_active: false };
  }

  bcpStatus(modelId: string) {
    const state = this.bcp.get(modelId);
    if (!state) return { model_id: modelId, bcp_active: false };
    return {
      model_id: modelId,
      bcp_active: state.fallbackActive,
      reason: state.fallbackReason,
      activated_at: state.fallbackActivatedAt ? state.fallbackActivatedAt.toISOString() : null,
      rules_engine: state.rulesEngineRef,
      human_sample_pct: state.humanSamplePct,
    };
  }

  gpuStatus() {
    return { gpus: getGpuUtilization() };
  }
}
