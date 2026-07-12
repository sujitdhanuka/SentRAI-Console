import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIIncidentEntity, AIModelEntity, ProjectEntity } from '../database/entities';
import { NotifierService } from '../common/notifier.service';
import { DiscoveryModule } from '../discovery/discovery.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { ScheduledTasksService } from './scheduled-tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectEntity, AIIncidentEntity, AIModelEntity]),
    DiscoveryModule,
    InventoryModule,
    MonitoringModule,
  ],
  providers: [ScheduledTasksService, NotifierService],
})
export class TasksModule {}
