import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, DeploymentGateEventEntity, DriftReportEntity, ProjectEntity } from '../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { SummarizerModule } from '../summarizer/summarizer.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AIModelEntity, ProjectEntity, DeploymentGateEventEntity, DriftReportEntity]),
    InventoryModule, // provides InventoryService (per-model complianceCheck)
    SummarizerModule, // provides SummarizerService (executive narrative drafting)
  ],
  controllers: [ComplianceController],
  providers: [ComplianceService],
})
export class ComplianceModule {}
