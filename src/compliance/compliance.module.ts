import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, ProjectEntity } from '../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AIModelEntity, ProjectEntity]),
    InventoryModule, // provides InventoryService (per-model complianceCheck)
  ],
  controllers: [ComplianceController],
  providers: [ComplianceService],
})
export class ComplianceModule {}
