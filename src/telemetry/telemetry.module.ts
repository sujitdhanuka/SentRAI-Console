import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AgentActionEventEntity,
  AIIncidentEntity,
  AIModelEntity,
  DeploymentGateEventEntity,
  DriftReportEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
} from '../database/entities';
import { NotifierService } from '../common/notifier.service';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

/**
 * Pillar 3 — Visibility: runtime action-telemetry ingestion and the cross-ledger
 * timeline that stitches governance, gate, incident, drift and runtime records
 * into one view per model.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentActionEventEntity,
      AIModelEntity,
      ProjectEntity,
      ModelLedgerEventEntity,
      AIIncidentEntity,
      DriftReportEntity,
      DeploymentGateEventEntity,
    ]),
  ],
  controllers: [TelemetryController],
  providers: [TelemetryService, NotifierService],
  exports: [TelemetryService], // for the scheduled scope-deviation escalation
})
export class TelemetryModule {}
