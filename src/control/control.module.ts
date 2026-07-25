import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, ModelLedgerEventEntity, ProjectEntity } from '../database/entities';
import { NotifierService } from '../common/notifier.service';
import { ControlController } from './control.controller';
import { ControlService } from './control.service';

/** Pillar 2 — Control: the operational kill switch (suspend/resume + polled state). */
@Module({
  imports: [TypeOrmModule.forFeature([AIModelEntity, ProjectEntity, ModelLedgerEventEntity])],
  controllers: [ControlController],
  providers: [ControlService, NotifierService],
})
export class ControlModule {}
