import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { existsSync, statSync } from 'fs';

import { AIIncidentEntity, AIModelEntity, ProjectEntity } from '../database/entities';
import { IncidentStatus, Role } from '../common/enums';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { NotifierService } from '../common/notifier.service';
import { scanDirectory } from '../discovery/codebase-scanner';
import { TreeSitterService } from '../discovery/tree-sitter-parser';
import { MonitoringService } from '../monitoring/monitoring.service';
import { InventoryService } from '../inventory/inventory.service';
import { AttestationsService } from '../alignment/attestations.service';

/** Synthetic principal used for actions taken by scheduled jobs. */
const SYSTEM_USER: CurrentUser = {
  userId: 'system',
  email: 'scheduled-jobs@system',
  fullName: 'Scheduled Jobs',
  role: Role.ADMIN,
  tenantId: null,
};

/**
 * Scheduled governance jobs. Port of the Celery beat schedule in
 * infrastructure/celery_app.py, implemented in-process with @nestjs/schedule.
 * Every job acts on its findings: drift gets evaluated and persisted, overdue
 * incidents and stale inventory get notified, and discovery deltas become
 * draft registrations — nothing is scanned-and-discarded.
 */
@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    private readonly treeSitter: TreeSitterService,
    private readonly config: ConfigService,
    private readonly monitoring: MonitoringService,
    private readonly inventory: InventoryService,
    private readonly notifier: NotifierService,
    private readonly attestations: AttestationsService,
  ) {}

  /** REC 16: evaluate drift on all pending score windows (hourly). */
  @Cron('0 * * * *')
  async monitorHighRiskModels(): Promise<void> {
    this.logger.log('drift_monitor_started');
    const { evaluated, tripped } = await this.monitoring.evaluatePendingWindows();
    this.logger.log(`drift_monitor_completed evaluated=${evaluated} circuit_breakers_tripped=${tripped}`);
    if (tripped > 0) {
      await this.notifier.notify('drift_monitor_summary', { windows_evaluated: evaluated, breakers_tripped: tripped });
    }
  }

  /** REC 22: escalate overdue incident reports (every 15 minutes). */
  @Cron('*/15 * * * *')
  async checkOverdueIncidents(): Promise<void> {
    const now = new Date();
    const overdue = await this.incidents.find({
      where: { reportingDeadline: LessThan(now), reportedAt: IsNull(), status: Not(IncidentStatus.CLOSED) },
    });
    this.logger.log(`incident_deadline_check overdue=${overdue.length} check_time=${now.toISOString()}`);
    if (overdue.length > 0) {
      await this.notifier.notify('incidents_overdue', {
        count: overdue.length,
        incidents: overdue.map((i) => ({
          incident_id: i.id,
          model_id: i.modelId,
          severity: i.severity,
          reporting_deadline: i.reportingDeadline?.toISOString() ?? null,
        })),
      });
    }
  }

  /** REC 23: flag inventory entries not updated within the update SLA (daily). */
  @Cron('0 0 * * *')
  async checkInventoryStaleness(): Promise<void> {
    const slaDays = this.config.get<number>('inventoryUpdateSlaDays')!;
    const threshold = new Date(Date.now() - slaDays * 86_400_000);
    const stale = await this.models.find({ where: { isActive: true, updatedAt: LessThan(threshold) } });
    this.logger.log(`inventory_staleness_check stale=${stale.length} threshold=${threshold.toISOString()}`);
    if (stale.length > 0) {
      await this.notifier.notify('inventory_stale', {
        sla_days: slaDays,
        count: stale.length,
        models: stale.map((m) => ({ model_id: m.id, name: m.name, last_updated: m.updatedAt.toISOString() })),
      });
    }
  }

  /** Pillar 1 — Alignment: escalate attestation items still PENDING past their
   *  due date (daily), the same overdue-escalation pattern as incidents. */
  @Cron('0 1 * * *')
  async checkOverdueAttestations(): Promise<void> {
    const overdue = await this.attestations.escalateOverdue();
    this.logger.log(`attestation_overdue_check overdue=${overdue}`);
  }

  /**
   * Re-scan every project's codebase daily. New candidates become draft
   * (DESIGN-stage) registrations pending governance; existing source-linked
   * models are re-triaged via the same path as a manual rescan.
   */
  @Cron('0 0 * * *')
  async runPeriodicScans(): Promise<void> {
    const projects = await this.projects.find();
    for (const proj of projects) {
      this.logger.log(`Starting periodic scan for project: ${proj.name}`);
      try {
        if (!existsSync(proj.rootDirectory) || !statSync(proj.rootDirectory).isDirectory()) {
          this.logger.warn(`Root directory ${proj.rootDirectory} not found for project ${proj.name}`);
          continue;
        }

        const candidates = scanDirectory(proj.rootDirectory, this.treeSitter);
        const existing = await this.models.find({ where: { projectId: proj.id } });
        const knownRefs = new Set(existing.map((m) => m.sourceRef).filter(Boolean));
        const knownNames = new Set(existing.map((m) => m.name.toLowerCase()));

        let registered = 0;
        for (const cand of candidates) {
          if (knownRefs.has(cand.filePath) || knownNames.has(cand.suggestedName.toLowerCase())) continue;
          try {
            await this.inventory.register(SYSTEM_USER, {
              name: cand.suggestedName,
              model_type: cand.modelTypeGuess,
              functional_area: cand.functionalAreaGuess,
              use_case_description: cand.description || `Discovered by scheduled scan in ${cand.filePath}`,
              target_customer_segments: [],
              owner_team: 'UNASSIGNED',
              developed_by: 'unknown',
              dependencies: [],
              performance_benchmarks: [],
              sutras_alignment: [],
              human_oversight_required: true,
              board_policy_ref: '',
              source_ref: cand.filePath,
              project_id: proj.id,
            });
            registered += 1;
          } catch (e) {
            this.logger.warn(`could not register discovered candidate ${cand.suggestedName}: ${String(e)}`);
          }
        }

        // Re-triage existing models against the fresh scan (same as manual rescan).
        const rescan = await this.inventory.rescan(SYSTEM_USER, proj.id);

        this.logger.log(
          `Scan finished for ${proj.name}: candidates=${candidates.length} new_drafts=${registered} ` +
            `rescanned=${rescan.rescanned} risk_changed=${rescan.risk_changed}`,
        );
        if (registered > 0 || rescan.risk_changed > 0) {
          await this.notifier.notify('discovery_scan_delta', {
            project_id: proj.id,
            project_name: proj.name,
            new_draft_models: registered,
            risk_changes: rescan.risk_changed,
          });
        }
      } catch (e) {
        this.logger.error(`Error scanning project ${proj.name}: ${String(e)}`);
      }
    }
  }
}
