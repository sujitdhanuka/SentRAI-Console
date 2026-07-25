import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, GrievanceEntity, ModelLedgerEventEntity, ProjectEntity } from '../database/entities';
import { NotifierService } from '../common/notifier.service';
import { GrievancesController } from './grievances.controller';
import { GrievancesService } from './grievances.service';

/**
 * Pillar 5 — Societal: the consumer grievance workflow (state machine + SLA).
 * GrievancesService is exported so the scheduled-tasks module can escalate
 * overdue grievances, and the public model card can read the grievance summary.
 */
@Module({
  imports: [TypeOrmModule.forFeature([GrievanceEntity, AIModelEntity, ProjectEntity, ModelLedgerEventEntity])],
  controllers: [GrievancesController],
  providers: [GrievancesService, NotifierService],
  exports: [GrievancesService],
})
export class GrievancesModule {}
