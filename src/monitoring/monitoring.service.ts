import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AIModelEntity, DriftReportEntity, ScoreWindowEntity } from '../database/entities';
import { DriftStatus, RiskLevel } from '../common/enums';
import { NotifierService } from '../common/notifier.service';
import { activateBcp, deactivateBcp, driftSummary, evaluateDrift } from '../domain/monitoring';
import { BcpStateStore } from './bcp-state.store';
import { getGpuUtilization } from './gpu-monitor';
import { BcpActivateDto, DriftEvaluationDto, DriftReportResponse, ScoreIngestDto } from './monitoring.dto';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
    @InjectRepository(ScoreWindowEntity) private readonly windows: Repository<ScoreWindowEntity>,
    private readonly bcp: BcpStateStore,
    private readonly notifier: NotifierService,
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
      const state = await this.bcp.getOrCreate(dto.model_id);
      if (!state.fallbackActive) {
        activateBcp(state, `Circuit breaker: PSI=${report.psiScore.toFixed(3)}`, 'RULES_ENGINE_v2');
        await this.bcp.save(state);
        await this.notifier.notify('circuit_breaker_tripped', {
          model_id: dto.model_id,
          model_name: model.name,
          psi_score: report.psiScore,
          accuracy_delta: report.accuracyDelta,
          human_review_ticket: report.humanReviewTicket,
        });
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

  /** Store an inference score window pushed by a serving system (REC 16). */
  async ingestScores(modelId: string, dto: ScoreIngestDto) {
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');

    if (dto.kind === 'reference') {
      // A new reference window supersedes previous ones.
      await this.windows.delete({ modelId, kind: 'reference' });
    }
    const row = await this.windows.save(this.windows.create({
      id: uuidv4(),
      modelId,
      kind: dto.kind,
      scores: dto.scores,
      accuracy: dto.accuracy ?? null,
      capturedAt: new Date(),
      evaluated: dto.kind === 'reference', // only live windows queue for evaluation
    }));
    return {
      window_id: row.id,
      model_id: modelId,
      kind: row.kind,
      sample_count: dto.scores.length,
      captured_at: row.capturedAt.toISOString(),
    };
  }

  /**
   * Evaluate every un-evaluated live window against its model's reference
   * window. Called by the hourly monitoring cron; returns evaluation count.
   */
  async evaluatePendingWindows(): Promise<{ evaluated: number; tripped: number }> {
    const pending = await this.windows.find({ where: { kind: 'live', evaluated: false } });
    let evaluated = 0;
    let tripped = 0;

    const byModel = new Map<string, ScoreWindowEntity[]>();
    for (const w of pending) {
      const list = byModel.get(w.modelId) ?? [];
      list.push(w);
      byModel.set(w.modelId, list);
    }

    for (const [modelId, wins] of byModel) {
      const reference = await this.windows.findOne({ where: { modelId, kind: 'reference' } });
      if (!reference) continue; // nothing to compare against yet

      // Evaluate the newest live window; older ones are folded into it.
      wins.sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
      const newest = wins[0];
      const baseline = reference.accuracy ?? 1.0;
      const current = newest.accuracy ?? baseline;

      try {
        const res = await this.evaluateDrift({
          model_id: modelId,
          training_scores: reference.scores,
          live_scores: newest.scores,
          baseline_accuracy: baseline,
          current_accuracy: current,
        });
        evaluated += 1;
        if (res.circuit_breaker_active) tripped += 1;
      } catch (e) {
        this.logger.warn(`scheduled drift evaluation failed for model ${modelId}: ${String(e)}`);
        continue;
      }

      await this.windows.update({ id: In(wins.map((w) => w.id)) }, { evaluated: true });
    }

    return { evaluated, tripped };
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

    const state = await this.bcp.getOrCreate(modelId);
    activateBcp(state, dto.reason, dto.rules_engine_ref ?? null);
    await this.bcp.save(state);
    return {
      model_id: modelId,
      bcp_active: true,
      reason: dto.reason,
      rules_engine: dto.rules_engine_ref ?? null,
      activated_at: state.fallbackActivatedAt ? state.fallbackActivatedAt.toISOString() : null,
    };
  }

  async deactivateBcp(modelId: string) {
    const state = await this.bcp.get(modelId);
    if (state) {
      deactivateBcp(state);
      await this.bcp.save(state);
    }
    return { model_id: modelId, bcp_active: false };
  }

  async bcpStatus(modelId: string) {
    const state = await this.bcp.get(modelId);
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

  /** Models above warning thresholds that HIGH/MEDIUM cron should re-check. */
  async monitoredModelIds(): Promise<string[]> {
    const rows = await this.models.find({
      where: { isActive: true, riskLevel: In([RiskLevel.HIGH, RiskLevel.MEDIUM]) },
      select: ['id'],
    });
    return rows.map((r) => r.id);
  }

  gpuStatus() {
    return { gpus: getGpuUtilization() };
  }
}
