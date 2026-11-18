import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AIModelEntity,
  BcpDrillEntity,
  BcpStateEntity,
  DriftReportEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
  ScoreWindowEntity,
} from '../database/entities';
import { FeatureFlagsService } from '../common/feature-flags';
import { NotifierService } from '../common/notifier.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { BcpStateStore } from './bcp-state.store';

@Module({
  imports: [TypeOrmModule.forFeature([
    AIModelEntity, DriftReportEntity, BcpStateEntity, BcpDrillEntity, ScoreWindowEntity, ModelLedgerEventEntity, ProjectEntity,
  ])],
  controllers: [MonitoringController],
  providers: [MonitoringService, BcpStateStore, NotifierService, FeatureFlagsService],
  exports: [BcpStateStore, MonitoringService],
})
export class MonitoringModule {}
