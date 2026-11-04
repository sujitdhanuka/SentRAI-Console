import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIIncidentEntity, AIModelEntity, ModelLedgerEventEntity, ProjectEntity } from '../database/entities';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({
  imports: [TypeOrmModule.forFeature([AIIncidentEntity, ModelLedgerEventEntity, AIModelEntity, ProjectEntity])],
  controllers: [IncidentsController],
  providers: [IncidentsService],
})
export class IncidentsModule {}
