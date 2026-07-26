import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AIIncidentEntity, ModelLedgerEventEntity } from '../database/entities';
import { IncidentSeverity, IncidentStatus } from '../common/enums';
import { computeReportingDeadline, hoursUntilDeadline, isOverdue } from '../domain/incident';
import { maskDict } from '../common/dpdp';
import {
  IncidentReportDto,
  IncidentResponse,
  IncidentStatusUpdateDto,
  SectoralRiskSummary,
} from './incidents.dto';

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
  ) {}

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

  async list(severity?: IncidentSeverity, statusFilter?: IncidentStatus, limit = 100): Promise<any[]> {
    const qb = this.incidents.createQueryBuilder('i').orderBy('i.createdAt', 'DESC').take(limit);
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

  async report(dto: IncidentReportDto): Promise<IncidentResponse> {
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

  async updateStatus(incidentId: string, dto: IncidentStatusUpdateDto) {
    const inc = await this.incidents.findOne({ where: { id: incidentId } });
    if (!inc) throw new NotFoundException('Incident not found');

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

  async sectoralRisk(): Promise<SectoralRiskSummary> {
    const incidents = await this.incidents.find();
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

  async get(incidentId: string): Promise<Record<string, any>> {
    const inc = await this.incidents.findOne({ where: { id: incidentId } });
    if (!inc) throw new NotFoundException('Incident not found');
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
