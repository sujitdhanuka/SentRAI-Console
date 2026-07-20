import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AIIncidentEntity,
  AIModelEntity,
  BcpStateEntity,
  DriftReportEntity,
  ModelLedgerEventEntity,
  OrganizationEntity,
  ProjectEntity,
  PromptEntity,
} from '../database/entities';
import { NotifierService } from '../common/notifier.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { DiscoveryModule } from '../discovery/discovery.module';
import { SummarizerModule } from '../summarizer/summarizer.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AIModelEntity,
      ModelLedgerEventEntity,
      ProjectEntity,
      PromptEntity,
      DriftReportEntity,
      AIIncidentEntity,
      BcpStateEntity,
      OrganizationEntity,
    ]),
    DiscoveryModule, // provides the shared TreeSitterService
    SummarizerModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService, NotifierService],
  exports: [InventoryService],
})
export class InventoryModule {}
