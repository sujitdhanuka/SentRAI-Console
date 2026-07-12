import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, BcpStateEntity, DriftReportEntity, ScoreWindowEntity } from '../database/entities';
import { NotifierService } from '../common/notifier.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { BcpStateStore } from './bcp-state.store';

@Module({
  imports: [TypeOrmModule.forFeature([AIModelEntity, DriftReportEntity, BcpStateEntity, ScoreWindowEntity])],
  controllers: [MonitoringController],
  providers: [MonitoringService, BcpStateStore, NotifierService],
  exports: [BcpStateStore, MonitoringService],
})
export class MonitoringModule {}
