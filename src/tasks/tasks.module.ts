import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIIncidentEntity, AIModelEntity, ProjectEntity } from '../database/entities';
import { NotifierService } from '../common/notifier.service';
import { AlignmentModule } from '../alignment/alignment.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { ScheduledTasksService } from './scheduled-tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectEntity, AIIncidentEntity, AIModelEntity]),
    DiscoveryModule,
    InventoryModule,
    MonitoringModule,
    AlignmentModule, // provides AttestationsService for the overdue-escalation cron
    TelemetryModule, // provides TelemetryService for scope-deviation escalation
  ],
  providers: [ScheduledTasksService, NotifierService],
})
export class TasksModule {}
