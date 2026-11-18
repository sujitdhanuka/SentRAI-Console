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
  RiskEntity,
  RiskAssessmentEntity,
  RiskActionEntity,
  RiskAcceptanceEntity,
  ImpactAssessmentEntity,
  AIIncidentEntity,
  DriftReportEntity,
  AIAuditTrailEntity,
} from '../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { PacksController } from './packs/packs.controller';
import { PacksService } from './packs/packs.service';
import { GovernanceSettingsController } from './settings/settings.controller';
import { GovernanceSettingsService } from './settings/settings.service';
import { AccountabilityController } from './accountability/accountability.controller';
import { AccountabilityService } from './accountability/accountability.service';
import { GovernanceFeaturesController } from './features.controller';
import { RisksController } from './risks/risks.controller';
import { RisksService } from './risks/risks.service';
import { ImpactAssessmentController } from './impact/impact.controller';
import { ImpactAssessmentService } from './impact/impact.service';
import { ContextProfileController } from './context/context.controller';
import { ContextProfileService } from './context/context.service';

/**
 * Governance module (plan section 3): everything shared across frameworks.
 * E1.1 control library and pack engine; E1.2 governance settings and risk
 * appetite; E1.3 risk register; E1.4 impact assessments; E1.5 context
 * profile; E1.9 accountability.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PackVersionEntity, ControlResultEntity, GovernanceSettingsEntity, AIModelEntity, ProjectEntity,
      OrganizationEntity, UserEntity, ModelLedgerEventEntity, RiskEntity, RiskAssessmentEntity, RiskActionEntity,
      RiskAcceptanceEntity, ImpactAssessmentEntity, AIIncidentEntity, DriftReportEntity, AIAuditTrailEntity,
    ]),
    InventoryModule,
  ],
  controllers: [
    GovernanceFeaturesController, PacksController, GovernanceSettingsController, AccountabilityController,
    RisksController, ImpactAssessmentController, ContextProfileController,
  ],
  providers: [
    PacksService, GovernanceSettingsService, AccountabilityService, RisksService, ImpactAssessmentService,
    ContextProfileService, FeatureFlagsService,
  ],
  exports: [PacksService, GovernanceSettingsService, AccountabilityService, RisksService, ImpactAssessmentService],
})
export class GovernanceModule {}
