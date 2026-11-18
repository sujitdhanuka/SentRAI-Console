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
  AimsRecordEntity,
  CorrectiveActionEntity,
  ControlledDocumentEntity,
  GrievanceEntity,
  AIAuditTrailEntity,
  ExplainabilityRecordEntity,
  RegulatorySubmissionEntity,
  AdverseActionNoticeEntity,
  DecisionAppealEntity,
  ModelValidationEntity,
  VendorEntity,
  VendorAssessmentEntity,
  AiBomItemEntity,
  TrainingCourseEntity,
  TrainingRecordEntity,
  DatasetEntity,
  ModelDatasetEntity,
} from '../database/entities';
import { ComplianceModule } from '../compliance/compliance.module';
import { NotifierService } from '../common/notifier.service';
import { AimsController } from './aims/aims.controller';
import { AimsService } from './aims/aims.service';
import { CorrectiveActionsController } from './actions/actions.controller';
import { CorrectiveActionsService } from './actions/actions.service';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
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
import { ActingOrgInterceptor } from './acting-org.interceptor';
import { AuDtaController } from './disclosures/au-dta.controller';
import { AuDtaService } from './disclosures/au-dta.service';
import { DecisionsController } from './decisions/decisions.controller';
import { DecisionsService } from './decisions/decisions.service';
import { FairLendingController } from './decisions/fair-lending.controller';
import { FairLendingService } from './decisions/fair-lending.service';
import { ValidationController } from './validation/validation.controller';
import { ValidationService } from './validation/validation.service';
import { VendorsController } from './vendors/vendors.controller';
import { VendorsService } from './vendors/vendors.service';
import { TrainingController } from './training/training.controller';
import { TrainingService } from './training/training.service';
import { DatasetsController } from './datasets/datasets.controller';
import { DatasetsService } from './datasets/datasets.service';
import { RedTeamAuditController } from './redteam/redteam-audit.controller';
import { RedTeamAuditService } from './redteam/redteam-audit.service';

/**
 * Governance module (plan section 3): everything shared across frameworks.
 * E1.1 control library and pack engine; E1.2 governance settings and risk
 * appetite; E1.3 risk register; E1.4 impact assessments; E1.5 context
 * profile; E1.6 AIMS workspace; E1.7 corrective actions; E1.8 document
 * control; E1.9 accountability. Phase 2: E2.1 Australia DTA register; E2.2
 * US decisions, notices and appeals; E2.3 model validation; E2.4 fair
 * lending; E2.5 vendors and AI BOM; E2.6 training; E2.7 data register; E2.8
 * red-team and audit rules. Each Phase 2 route answers 404 while its flag is off.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PackVersionEntity, ControlResultEntity, GovernanceSettingsEntity, AIModelEntity, ProjectEntity,
      OrganizationEntity, UserEntity, ModelLedgerEventEntity, RiskEntity, RiskAssessmentEntity, RiskActionEntity,
      RiskAcceptanceEntity, ImpactAssessmentEntity, AIIncidentEntity, DriftReportEntity, AimsRecordEntity,
      CorrectiveActionEntity, ControlledDocumentEntity, GrievanceEntity, AIAuditTrailEntity,
      ExplainabilityRecordEntity, RegulatorySubmissionEntity, AdverseActionNoticeEntity, DecisionAppealEntity,
      ModelValidationEntity, VendorEntity, VendorAssessmentEntity, AiBomItemEntity, TrainingCourseEntity,
      TrainingRecordEntity, DatasetEntity, ModelDatasetEntity,
    ]),
    InventoryModule,
    ComplianceModule, // board-pack inputs for management review (E1.6)
  ],
  controllers: [
    GovernanceFeaturesController, PacksController, GovernanceSettingsController, AccountabilityController,
    RisksController, ImpactAssessmentController, ContextProfileController, AimsController,
    CorrectiveActionsController, DocumentsController,
    AuDtaController, DecisionsController, FairLendingController, ValidationController, VendorsController,
    TrainingController, DatasetsController, RedTeamAuditController,
  ],
  providers: [
    ActingOrgInterceptor,
    PacksService, GovernanceSettingsService, AccountabilityService, RisksService, ImpactAssessmentService,
    ContextProfileService, AimsService, CorrectiveActionsService, DocumentsService, NotifierService, FeatureFlagsService,
    AuDtaService, DecisionsService, FairLendingService, ValidationService, VendorsService, TrainingService,
    DatasetsService, RedTeamAuditService,
  ],
  exports: [
    PacksService, GovernanceSettingsService, AccountabilityService, RisksService, ImpactAssessmentService,
    AimsService, CorrectiveActionsService, DocumentsService,
  ],
})
export class GovernanceModule {}
