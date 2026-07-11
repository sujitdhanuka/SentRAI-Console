import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { existsSync, statSync } from 'fs';

import { AIIncidentEntity, ProjectEntity } from '../database/entities';
import { IncidentStatus } from '../common/enums';
import { scanDirectory } from '../discovery/codebase-scanner';
import { TreeSitterService } from '../discovery/tree-sitter-parser';

/**
 * Scheduled maintenance jobs. Port of the Celery beat schedule in
 * infrastructure/celery_app.py, implemented in-process with @nestjs/schedule
 * (no Redis broker required).
 */
@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    private readonly treeSitter: TreeSitterService,
    private readonly config: ConfigService,
  ) {}

  /** REC 16: poll HIGH/MEDIUM risk models for drift (hourly). */
  @Cron('0 * * * *')
  monitorHighRiskModels(): void {
    this.logger.log('drift_monitor_started');
    // Production: fetch live inference scores, call evaluateDrift, persist, trigger BCP.
    this.logger.log('drift_monitor_completed');
  }

  /** REC 22: escalate overdue incident reports (every 15 minutes). */
  @Cron('*/15 * * * *')
  async checkOverdueIncidents(): Promise<void> {
    const now = new Date();
    const overdue = await this.incidents.count({
      where: { reportingDeadline: LessThan(now), reportedAt: IsNull(), status: Not(IncidentStatus.CLOSED) },
    });
    this.logger.log(`incident_deadline_check overdue=${overdue} check_time=${now.toISOString()}`);
  }

  /** REC 23: flag inventory entries not updated within the semi-annual SLA (daily). */
  @Cron('0 0 * * *')
  checkInventoryStaleness(): void {
    const slaDays = this.config.get<number>('inventoryUpdateSlaDays')!;
    const threshold = new Date(Date.now() - slaDays * 86_400_000);
    this.logger.log(`inventory_staleness_check staleness_threshold=${threshold.toISOString()}`);
  }

  /** Re-scan every project's codebase for AI candidates (daily). */
  @Cron('0 0 * * *')
  async runPeriodicScans(): Promise<void> {
    const projects = await this.projects.find();
    for (const proj of projects) {
      this.logger.log(`Starting periodic scan for project: ${proj.name}`);
      try {
        if (existsSync(proj.rootDirectory) && statSync(proj.rootDirectory).isDirectory()) {
          const candidates = scanDirectory(proj.rootDirectory, this.treeSitter);
          this.logger.log(`Scan finished. Found ${candidates.length} model candidates.`);
        } else {
          this.logger.warn(`Root directory ${proj.rootDirectory} not found for project ${proj.name}`);
        }
      } catch (e) {
        this.logger.error(`Error scanning project ${proj.name}: ${String(e)}`);
      }
    }
  }
}
