import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, DriftReportEntity } from '../database/entities';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { BcpStateStore } from './bcp-state.store';

@Module({
  imports: [TypeOrmModule.forFeature([AIModelEntity, DriftReportEntity])],
  controllers: [MonitoringController],
  providers: [MonitoringService, BcpStateStore],
  exports: [BcpStateStore],
})
export class MonitoringModule {}
