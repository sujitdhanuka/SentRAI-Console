import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIIncidentEntity, ProjectEntity } from '../database/entities';
import { DiscoveryModule } from '../discovery/discovery.module';
import { ScheduledTasksService } from './scheduled-tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, AIIncidentEntity]), DiscoveryModule],
  providers: [ScheduledTasksService],
})
export class TasksModule {}
