import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeatureFlagsService } from '../common/feature-flags';
import {
  AIModelEntity,
  ControlResultEntity,
  GovernanceSettingsEntity,
  ModelLedgerEventEntity,
  OrganizationEntity,
  PackVersionEntity,
  ProjectEntity,
  UserEntity,
} from '../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { PacksController } from './packs/packs.controller';
import { PacksService } from './packs/packs.service';
import { GovernanceSettingsController } from './settings/settings.controller';
import { GovernanceSettingsService } from './settings/settings.service';
import { AccountabilityController } from './accountability/accountability.controller';
import { AccountabilityService } from './accountability/accountability.service';
import { GovernanceFeaturesController } from './features.controller';

/**
 * Governance module (plan section 3): everything shared across frameworks.
 * E1.1 control library and pack engine; E1.2 governance settings and risk
 * appetite; E1.9 accountability.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PackVersionEntity, ControlResultEntity, GovernanceSettingsEntity, AIModelEntity, ProjectEntity,
      OrganizationEntity, UserEntity, ModelLedgerEventEntity,
    ]),
    InventoryModule,
  ],
  controllers: [GovernanceFeaturesController, PacksController, GovernanceSettingsController, AccountabilityController],
  providers: [PacksService, GovernanceSettingsService, AccountabilityService, FeatureFlagsService],
  exports: [PacksService, GovernanceSettingsService, AccountabilityService],
})
export class GovernanceModule {}
