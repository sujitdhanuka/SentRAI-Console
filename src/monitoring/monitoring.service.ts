import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import {
  AIModelEntity,
  BcpDrillEntity,
  DriftReportEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
  ScoreWindowEntity,
} from '../database/entities';
import { DriftStatus, RiskLevel, Role } from '../common/enums';
import { isHighOrAbove } from '../domain/model-inventory';
import { FeatureFlagsService } from '../common/feature-flags';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { NotifierService } from '../common/notifier.service';
import {
  activateBcp,
  bcpDrillIntervalDays,
  bcpDrillReminderDays,
  bcpDrillStatus,
  deactivateBcp,
  driftSummary,
  evaluateDrift,
} from '../domain/monitoring';
import { latestSuccessfulDrill, latestSuccessfulDrills } from './bcp-drills';
import { governanceHooks } from '../governance/hooks';
import { BcpStateStore } from './bcp-state.store';
import { getGpuUtilization } from './gpu-monitor';
import { BcpActivateDto, BcpDrillDto, DriftEvaluationDto, DriftReportResponse, ScoreIngestDto } from './monitoring.dto';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
    @InjectRepository(ScoreWindowEntity) private readonly windows: Repository<ScoreWindowEntity>,
    @InjectRepository(BcpDrillEntity) private readonly drills: Repository<BcpDrillEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    private readonly bcp: BcpStateStore,
    private readonly notifier: NotifierService,
    private readonly flags: FeatureFlagsService,
  ) {}

  async evaluateDrift(dto: DriftEvaluationDto): Promise<DriftReportResponse> {
    const model = await this.models.findOne({ where: { id: dto.model_id } });
    if (!model) throw new NotFoundException('Model not found');

    // Governance E1.2: the organisation's PSI alert threshold, when settings are on.
    let psiAlert: number | undefined;
    if (governanceHooks.orgPackParams) {
      const project = model.projectId ? await this.projects.findOne({ where: { id: model.projectId } }) : null;
      const params = await governanceHooks.orgPackParams(project?.tenantId ?? null);
      const v = Number(params?.values.psiAlertThreshold);
      if (params?.sources.psiAlertThreshold && !params.sources.psiAlertThreshold.setBy.includes('platform-default') && v > 0) psiAlert = v;
    }
    const report = evaluateDrift(
      dto.model_id,
      dto.training_scores,
      dto.live_scores,
      dto.baseline_accuracy,
      dto.current_accuracy,
      psiAlert,
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

  /**
   * Evaluate one model's newest live window against its reference window.
   * Lets an operator force the evaluation the hourly cron would eventually do,
   * without the caller having to hold the raw score arrays.
   */
  async evaluateStoredWindows(modelId: string): Promise<DriftReportResponse> {
    const reference = await this.windows.findOne({ where: { modelId, kind: 'reference' } });
    if (!reference) {
      throw new BadRequestException('No reference score window for this model — push one first.');
    }
    const live = await this.windows.find({
      where: { modelId, kind: 'live' },
      order: { capturedAt: 'DESC' },
      take: 1,
    });
    if (!live.length) {
      throw new BadRequestException('No live score window for this model — push one first.');
    }

    const baseline = reference.accuracy ?? 1.0;
    const report = await this.evaluateDrift({
      model_id: modelId,
      training_scores: reference.scores,
      live_scores: live[0].scores,
      baseline_accuracy: baseline,
      current_accuracy: live[0].accuracy ?? baseline,
    });
    await this.windows.update({ id: live[0].id }, { evaluated: true });
    return report;
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

  /* ----------------------------- BCP drills (E0.4) ----------------------------- */

  /** Drill tracking only exists while GOV_E0_4_BCP_DRILLS is on; otherwise the
   *  routes answer 404 as if they were not there, so hosted behaviour is unchanged. */
  private assertDrillsEnabled(): void {
    if (!this.flags.isEnabled('bcpDrills')) throw new NotFoundException();
  }

  /** A model in the caller's organization. Another organization's model is a 404,
   *  so its existence isn't disclosed; ADMIN is a global superuser. */
  private async modelForUser(user: CurrentUser, modelId: string): Promise<AIModelEntity> {
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');
    if (user.role === Role.ADMIN) return model;
    const project = model.projectId ? await this.projects.findOne({ where: { id: model.projectId } }) : null;
    if ((project?.tenantId ?? null) !== (user.tenantId ?? null)) throw new NotFoundException('Model not found');
    return model;
  }

  private drillView(d: BcpDrillEntity) {
    return {
      drill_id: d.id,
      model_id: d.modelId,
      conducted_at: d.conductedAt.toISOString(),
      scenario: d.scenario,
      result: d.result,
      findings: d.findings,
      conducted_by: d.conductedBy,
      recorded_at: d.recordedAt.toISOString(),
    };
  }

  async recordDrill(user: CurrentUser, modelId: string, dto: BcpDrillDto) {
    this.assertDrillsEnabled();
    const model = await this.modelForUser(user, modelId);
    const now = new Date();
    const conductedAt = dto.conducted_at ? new Date(dto.conducted_at) : now;
    if (Number.isNaN(conductedAt.getTime())) throw new BadRequestException('conducted_at is not a valid date');
    if (conductedAt.getTime() > now.getTime() + 60_000) throw new BadRequestException('conducted_at cannot be in the future');

    const row = await this.drills.save(this.drills.create({
      id: uuidv4(),
      modelId: model.id,
      conductedAt,
      scenario: dto.scenario.trim(),
      result: dto.result,
      findings: dto.findings?.trim() || null,
      conductedBy: user.email,
      recordedAt: now,
    }));

    // bcp_states.drillLastConducted mirrors the newest *passed* drill, so a
    // failed drill or a back-dated older one never moves it. It is only updated
    // on an existing BCP state row: creating one here would make the NIST
    // MANAGE-2.4 "fallback configured" check pass with no fallback set up.
    const lastPassed = await latestSuccessfulDrill(this.drills, model.id);
    const state = await this.bcp.get(model.id);
    if (state && lastPassed && state.drillLastConducted?.getTime() !== lastPassed.getTime()) {
      state.drillLastConducted = lastPassed;
      await this.bcp.save(state);
    }

    await this.ledger.save(this.ledger.create({
      id: uuidv4(),
      modelId: model.id,
      eventType: 'BCP_DRILL_RECORDED',
      eventData: { drill_id: row.id, result: row.result, conducted_at: conductedAt.toISOString() },
      actor: user.email,
      occurredAt: now,
    }));

    return { ...this.drillView(row), ...this.drillSummary(lastPassed, row.result, await this.drillParams(await this.tenantOfModel(model))) };
  }

  async listDrills(user: CurrentUser, modelId: string) {
    this.assertDrillsEnabled();
    const model = await this.modelForUser(user, modelId);
    const [rows, lastPassed] = await Promise.all([
      this.drills.find({ where: { modelId: model.id }, order: { conductedAt: 'DESC' }, take: 100 }),
      latestSuccessfulDrill(this.drills, model.id),
    ]);
    return {
      model_id: model.id,
      risk_level: model.riskLevel,
      drill_required: isHighOrAbove(model.riskLevel as RiskLevel),
      ...this.drillSummary(lastPassed, rows[0]?.result ?? null, await this.drillParams(await this.tenantOfModel(model))),
      drills: rows.map((r) => this.drillView(r)),
    };
  }

  /** Status is measured from the latest *passed* drill (Rec 21); the newest
   *  drill's result is reported alongside so a recent failure is visible. */
  private drillSummary(last: Date | null, latestResult: string | null, p: { intervalDays: number; reminderDays: number }) {
    const s = bcpDrillStatus(last, new Date(), p.intervalDays, p.reminderDays);
    return {
      drill_last_conducted: last ? last.toISOString() : null,
      latest_drill_result: latestResult,
      drill_interval_days: p.intervalDays,
      drill_reminder_days: p.reminderDays,
      drill_status: s.status,
      next_drill_due: s.dueAt ? s.dueAt.toISOString() : null,
    };
  }

  /** Active HIGH/CRITICAL models whose passed drill is missing, due soon or
   *  overdue (the scheduled reminder job), each tagged with its organization so
   *  the notification can be split per tenant. Empty while the flag is off. */
  private async tenantOfModel(model: AIModelEntity): Promise<string | null> {
    if (!model.projectId) return null;
    const project = await this.projects.findOne({ where: { id: model.projectId } });
    return project?.tenantId ?? null;
  }

  /** Drill interval and reminder window for an organisation. Governance E1.2:
   *  when the organisation's settings (or an enabled pack) set them, those
   *  values win; otherwise the deployment's environment defaults apply. */
  private async drillParams(tenantId: string | null, at: Date = new Date()): Promise<{ intervalDays: number; reminderDays: number }> {
    let intervalDays = bcpDrillIntervalDays();
    let reminderDays = bcpDrillReminderDays();
    if (governanceHooks.orgPackParams) {
      const params = await governanceHooks.orgPackParams(tenantId, at);
      const fromOrg = (name: string) => {
        const src = params?.sources[name];
        const v = Number(params?.values[name]);
        return src && !src.setBy.includes('platform-default') && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
      };
      intervalDays = fromOrg('bcpDrillIntervalDays') ?? intervalDays;
      reminderDays = fromOrg('bcpDrillReminderDays') ?? reminderDays;
    }
    return { intervalDays, reminderDays };
  }

  async drillsNeedingAttention(now: Date = new Date()) {
    if (!this.flags.isEnabled('bcpDrills')) return [];
    const models = await this.models.find({
      where: { isActive: true, riskLevel: In([RiskLevel.HIGH, RiskLevel.CRITICAL]) },
      select: ['id', 'name', 'riskLevel', 'projectId'],
    });
    const [passed, projects] = await Promise.all([
      latestSuccessfulDrills(this.drills, models.map((m) => m.id)),
      this.projects.find({ where: { id: In([...new Set(models.map((m) => m.projectId).filter((p): p is string => Boolean(p)))]) } }),
    ]);
    const tenantOf = new Map(projects.map((p) => [p.id, p.tenantId ?? null]));
    const out: Array<{ model_id: string; model_name: string; tenant_id: string | null; status: string; next_drill_due: string | null }> = [];
    const paramsByTenant = new Map<string | null, { intervalDays: number; reminderDays: number }>();
    for (const t of new Set<string | null>([null, ...tenantOf.values()])) paramsByTenant.set(t, await this.drillParams(t, now));
    for (const m of models) {
      const tenant = m.projectId ? tenantOf.get(m.projectId) ?? null : null;
      const p = paramsByTenant.get(tenant)!;
      const s = bcpDrillStatus(passed.get(m.id) ?? null, now, p.intervalDays, p.reminderDays);
      if (s.status !== 'CURRENT') {
        out.push({
          model_id: m.id,
          model_name: m.name,
          tenant_id: tenant,
          status: s.status,
          next_drill_due: s.dueAt ? s.dueAt.toISOString() : null,
        });
      }
    }
    return out;
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
