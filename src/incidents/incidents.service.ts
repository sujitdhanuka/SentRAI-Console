import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AIIncidentEntity, AIModelEntity, ModelLedgerEventEntity, ProjectEntity } from '../database/entities';
import { IncidentCategory, IncidentSeverity, IncidentStatus, Role } from '../common/enums';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { computeReportingDeadline, hoursUntilDeadline, isOverdue } from '../domain/incident';
import { maskDict } from '../common/dpdp';
import {
  IncidentReportDto,
  IncidentResponse,
  IncidentStatusUpdateDto,
  SectoralRiskSummary,
} from './incidents.dto';

/** modelId of an incident about a shadow asset, which has no model record. */
const UNREGISTERED_MODEL_ID = 'unregistered';

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
  ) {}

  /** Incidents visible to this user. An incident belongs to the organization of
   *  its own project or else its model's project; ADMIN is a global superuser.
   *  Incidents with neither stay ADMIN-only. */
  private scopedQuery(user: CurrentUser, projectId?: string) {
    const qb = this.incidents.createQueryBuilder('i')
      .leftJoin(AIModelEntity, 'm', 'm.id = i.modelId')
      .leftJoin(ProjectEntity, 'p', 'p.id = COALESCE(i.projectId, m.projectId)');
    if (projectId) qb.andWhere('COALESCE(i.projectId, m.projectId) = :pid', { pid: projectId });
    if (user.role !== Role.ADMIN) {
      if (user.tenantId) qb.andWhere('p.tenantId = :tid', { tid: user.tenantId });
      else qb.andWhere('(m.id IS NOT NULL OR i.projectId IS NOT NULL) AND p.tenantId IS NULL');
    }
    return qb;
  }

  private async ownsProject(user: CurrentUser, projectId: string | null): Promise<boolean> {
    if (user.role === Role.ADMIN) return true;
    const project = projectId ? await this.projects.findOne({ where: { id: projectId } }) : null;
    return (project?.tenantId ?? null) === (user.tenantId ?? null);
  }

  /** Load an incident the user may access. Another organization's incident is a
   *  404, so its existence isn't disclosed. */
  private async getOrThrow(user: CurrentUser, incidentId: string): Promise<AIIncidentEntity> {
    const inc = await this.incidents.findOne({ where: { id: incidentId } });
    if (!inc) throw new NotFoundException('Incident not found');
    if (user.role === Role.ADMIN) return inc;
    const model = inc.projectId ? null : await this.models.findOne({ where: { id: inc.modelId } });
    if (!inc.projectId && !model) throw new NotFoundException('Incident not found');
    if (!(await this.ownsProject(user, inc.projectId ?? model?.projectId ?? null))) throw new NotFoundException('Incident not found');
    return inc;
  }

  /** Append an event to a model's immutable ledger (feeds the cross-ledger
   *  timeline). Best-effort: a ledger hiccup must not fail the incident write. */
  private async recordLedger(modelId: string, eventType: string, data: Record<string, any>, actor: string): Promise<void> {
    try {
      await this.ledger.save(this.ledger.create({
        id: uuidv4(), modelId, eventType, eventData: maskDict(data), actor, occurredAt: new Date(),
      }));
    } catch (e) {
      this.logger.error(`failed to write ${eventType} ledger event for ${modelId}: ${String(e)}`);
    }
  }

  async list(
    user: CurrentUser,
    opts: { severity?: IncidentSeverity; statusFilter?: IncidentStatus; projectId?: string; limit?: number } = {},
  ): Promise<any[]> {
    const { severity, statusFilter, projectId, limit = 100 } = opts;
    const qb = this.scopedQuery(user, projectId).orderBy('i.createdAt', 'DESC').take(limit);
    if (severity) qb.andWhere('i.severity = :s', { s: severity });
    if (statusFilter) qb.andWhere('i.status = :st', { st: statusFilter });
    const rows = await qb.getMany();

    return rows.map((r) => ({
      incident_id: r.id,
      model_id: r.modelId,
      model_name: r.modelName,
      re_name: r.reName,
      category: r.incidentCategory,
      severity: r.severity,
      status: r.status,
      description: r.description,
      reporting_deadline: r.reportingDeadline.toISOString(),
      is_overdue: isOverdue(r.reportingDeadline, r.reportedAt),
      regulator_notified: r.regulatorNotified,
      system_suspended: r.systemSuspended,
      repeat_incident: r.repeatIncident,
      created_at: r.createdAt.toISOString(),
    }));
  }

  async report(user: CurrentUser, dto: IncidentReportDto): Promise<IncidentResponse> {
    const model = await this.models.findOne({ where: { id: dto.model_id } });
    if (!model || !(await this.ownsProject(user, model.projectId))) throw new NotFoundException('Model not found');

    const observedAt = new Date(dto.observed_at);
    const deadline = computeReportingDeadline(observedAt, dto.severity);
    const now = new Date();

    let consumers: Record<string, any> | null = null;
    if (dto.affected_consumers) {
      consumers = maskDict({
        count: dto.affected_consumers.count,
        demographic_segment: dto.affected_consumers.demographic_segment ?? null,
        harm_type: dto.affected_consumers.harm_type,
        compensation_provided: dto.affected_consumers.compensation_provided ?? false,
        compensation_amount_inr: dto.affected_consumers.compensation_amount_inr ?? null,
      });
    }

    const incidentId = uuidv4();
    await this.incidents.save(this.incidents.create({
      id: incidentId,
      modelId: dto.model_id,
      modelName: dto.model_name,
      reName: dto.re_name,
      functionalArea: dto.functional_area,
      incidentCategory: dto.incident_category,
      severity: dto.severity,
      status: IncidentStatus.REPORTED,
      description: dto.description,
      observedAt,
      detectedAt: new Date(dto.detected_at),
      reportedAt: null,
      reportingDeadline: deadline,
      affectedConsumers: consumers,
      modelRiskLevel: dto.model_risk_level,
      autonomousSystemInvolved: dto.autonomous_system_involved ?? false,
      immediateActionTaken: dto.immediate_action_taken,
      systemSuspended: dto.system_suspended ?? false,
      fallbackActivated: dto.fallback_activated ?? false,
      rca: {},
      repeatIncident: dto.repeat_incident ?? false,
      priorIncidentRefs: dto.prior_incident_refs ?? [],
      regulatorNotified: false,
      boardInformed: false,
      createdAt: now,
      updatedAt: now,
    }));

    if (dto.severity === IncidentSeverity.P1_CRITICAL || dto.severity === IncidentSeverity.P2_HIGH) {
      // Background escalation (fire-and-forget) — logs like the Python stub.
      this.logger.warn(
        `incident_escalation_required incident_id=${incidentId} severity=${dto.severity} action=notify_compliance_officer`,
      );
    }

    await this.recordLedger(dto.model_id, 'INCIDENT_REPORTED', {
      incident_id: incidentId, category: dto.incident_category, severity: dto.severity,
    }, dto.re_name || 'incident_reporter');

    return {
      incident_id: incidentId,
      severity: dto.severity,
      status: IncidentStatus.REPORTED,
      reporting_deadline: deadline,
      hours_until_deadline: hoursUntilDeadline(deadline),
      is_overdue: isOverdue(deadline, null),
      created_at: now,
    };
  }

  /**
   * Raise a P3 incident for gate findings that landed on the default branch.
   * Skipped while this model already has an open gate-raised incident.
   */
  async raiseFromGate(input: {
    projectId: string;
    projectName: string;
    model: AIModelEntity | null;
    modelName: string;
    riskLevel: string;
    reasons: string[];
    commitSha: string;
    gateEventId: string;
  }): Promise<string | null> {
    const open = await this.incidents.findOne({
      where: {
        projectId: input.projectId,
        modelName: input.modelName,
        status: Not(In([IncidentStatus.RESOLVED, IncidentStatus.CLOSED])),
      },
    });
    if (open) return null;

    const now = new Date();
    const incidentId = uuidv4();
    await this.incidents.save(this.incidents.create({
      id: incidentId,
      projectId: input.projectId,
      modelId: input.model?.id ?? UNREGISTERED_MODEL_ID,
      modelName: input.modelName,
      reName: input.projectName,
      functionalArea: input.model?.functionalArea ?? 'unregistered',
      incidentCategory: IncidentCategory.OTHER,
      severity: IncidentSeverity.P3_MEDIUM,
      status: IncidentStatus.REPORTED,
      description: `Code that failed the CI compliance gate landed on the default branch (commit ${input.commitSha}). ${input.reasons.join(' ')}`,
      observedAt: now,
      detectedAt: now,
      reportedAt: null,
      reportingDeadline: computeReportingDeadline(now, IncidentSeverity.P3_MEDIUM),
      affectedConsumers: null,
      modelRiskLevel: input.riskLevel,
      autonomousSystemInvolved: false,
      immediateActionTaken: 'None recorded. Raised automatically from the CI compliance gate.',
      systemSuspended: false,
      fallbackActivated: false,
      rca: { source: 'ci_gate', gate_event_id: input.gateEventId },
      repeatIncident: false,
      priorIncidentRefs: [],
      regulatorNotified: false,
      boardInformed: false,
      createdAt: now,
      updatedAt: now,
    }));

    if (input.model) {
      await this.recordLedger(input.model.id, 'INCIDENT_REPORTED', {
        incident_id: incidentId, category: IncidentCategory.OTHER, severity: IncidentSeverity.P3_MEDIUM,
      }, 'ci_gate');
    }
    return incidentId;
  }

  async updateStatus(user: CurrentUser, incidentId: string, dto: IncidentStatusUpdateDto) {
    const inc = await this.getOrThrow(user, incidentId);

    inc.status = dto.status;
    inc.updatedAt = new Date();

    if (dto.regulator_notified !== undefined && dto.regulator_notified !== null) {
      inc.regulatorNotified = dto.regulator_notified;
      if (dto.regulator_notified) inc.reportedAt = new Date();
    }
    if (dto.board_informed !== undefined && dto.board_informed !== null) {
      inc.boardInformed = dto.board_informed;
    }
    await this.incidents.save(inc);

    if (dto.status === IncidentStatus.RESOLVED || dto.status === IncidentStatus.CLOSED) {
      await this.recordLedger(inc.modelId, 'INCIDENT_RESOLVED', {
        incident_id: incidentId, category: inc.incidentCategory, status: dto.status,
      }, 'incident_manager');
    }
    return { incident_id: incidentId, status: dto.status };
  }

  async sectoralRisk(user: CurrentUser, projectId?: string): Promise<SectoralRiskSummary> {
    const incidents = await this.scopedQuery(user, projectId).getMany();
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let overdue = 0;
    let repeats = 0;

    for (const inc of incidents) {
      byCategory[inc.incidentCategory] = (byCategory[inc.incidentCategory] ?? 0) + 1;
      bySeverity[inc.severity] = (bySeverity[inc.severity] ?? 0) + 1;
      if (inc.reportedAt === null && inc.reportingDeadline.getTime() < Date.now()) overdue += 1;
      if (inc.repeatIncident) repeats += 1;
    }

    const total = incidents.length;
    const repeatRate = total ? Math.round((repeats / total) * 10000) / 10000 : 0.0;
    const circuitBreakers = incidents.filter(
      (i) => i.severity === IncidentSeverity.P1_CRITICAL && !i.systemSuspended,
    ).length;

    return {
      total_incidents: total,
      by_category: byCategory,
      by_severity: bySeverity,
      overdue_count: overdue,
      circuit_breakers_active: circuitBreakers,
      repeat_incident_rate: repeatRate,
    };
  }

  async get(user: CurrentUser, incidentId: string): Promise<Record<string, any>> {
    const inc = await this.getOrThrow(user, incidentId);
    return {
      incident_id: inc.id,
      model_id: inc.modelId,
      severity: inc.severity,
      status: inc.status,
      category: inc.incidentCategory,
      reporting_deadline: inc.reportingDeadline.toISOString(),
      is_overdue: inc.reportedAt === null && inc.reportingDeadline.getTime() < Date.now(),
      regulator_notified: inc.regulatorNotified,
      board_informed: inc.boardInformed,
      system_suspended: inc.systemSuspended,
      fallback_activated: inc.fallbackActivated,
      repeat_incident: inc.repeatIncident,
      created_at: inc.createdAt.toISOString(),
    };
  }
}
