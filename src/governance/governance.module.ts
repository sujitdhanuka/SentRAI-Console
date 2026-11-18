import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeatureFlagsService } from '../common/feature-flags';
import { AIModelEntity, ControlResultEntity, PackVersionEntity, ProjectEntity } from '../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { PacksController } from './packs/packs.controller';
import { PacksService } from './packs/packs.service';

/**
 * Governance module (plan section 3): everything shared across frameworks.
 * E1.1 adds the control library and the framework pack engine.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PackVersionEntity, ControlResultEntity, AIModelEntity, ProjectEntity]),
    InventoryModule,
  ],
  controllers: [PacksController],
  providers: [PacksService, FeatureFlagsService],
  exports: [PacksService],
})
export class GovernanceModule {}
