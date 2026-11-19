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
  AiProviderAttestationEntity,
  AiProviderConfigEntity,
  BcpStateEntity,
  DisclosureEntity,
  EnergyReadingEntity,
  EngagementRecordEntity,
  IntegrationDeliveryEntity,
  IntegrationEndpointEntity,
  ModelDeployerEntity,
  ModelRetirementEntity,
  SecurityEvaluationEntity,
  SoaEntryEntity,
  SoaStatementEntity,
  TestSetEntity,
  TevvRunEntity,
  ThreatModelEntity,
  ModelCardEntity,
  ModelApprovalEntity,
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
import { SoaController } from './soa/soa.controller';
import { SoaService } from './soa/soa.service';
import { DisclosuresController } from './disclosures/disclosures.controller';
import { DisclosuresService } from './disclosures/disclosures.service';
import { IncidentExtensionsController } from './incidents/incident-ext.controller';
import { IncidentExtensionsService } from './incidents/incident-ext.service';
import { TevvController } from './tevv/tevv.controller';
import { TevvService } from './tevv/tevv.service';
import { EnergyController } from './energy/energy.controller';
import { EnergyService } from './energy/energy.service';
import { AiSecurityController } from './security/ai-security.controller';
import { AiSecurityService } from './security/ai-security.service';
import { EngagementController } from './engagement/engagement.controller';
import { EngagementService } from './engagement/engagement.service';
import { FederalVendorController } from './federal/federal.controller';
import { FederalVendorService } from './federal/federal.service';
import { ModelCardsController } from './model-cards/model-cards.controller';
import { ModelCardsService } from './model-cards/model-cards.service';

/**
 * Governance module (plan section 3): everything shared across frameworks.
 * E1.1 control library and pack engine; E1.2 governance settings and risk
 * appetite; E1.3 risk register; E1.4 impact assessments; E1.5 context
 * profile; E1.6 AIMS workspace; E1.7 corrective actions; E1.8 document
 * control; E1.9 accountability. Phase 2: E2.1 Australia DTA register; E2.2
 * US decisions, notices and appeals; E2.3 model validation; E2.4 fair
 * lending; E2.5 vendors and AI BOM; E2.6 training; E2.7 data register; E2.8
 * red-team and audit rules. Phase 3: E3.1 Statement of Applicability; E3.2
 * disclosures; E3.3 incident extensions; E3.4 TEVV and retirement; E3.5
 * energy; E3.6 AI security; E3.7 engagement records; E3.8 federal vendor.
 * E4.1 model cards.
 * Each Phase 2 and Phase 3 route answers 404 while its flag is off.
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
      AiProviderAttestationEntity, AiProviderConfigEntity, BcpStateEntity, DisclosureEntity, EnergyReadingEntity, EngagementRecordEntity, IntegrationDeliveryEntity, IntegrationEndpointEntity,
      ModelDeployerEntity, ModelRetirementEntity, SecurityEvaluationEntity, SoaEntryEntity, SoaStatementEntity, TestSetEntity, TevvRunEntity, ThreatModelEntity,
      ModelCardEntity, ModelApprovalEntity,
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
    SoaController, DisclosuresController, IncidentExtensionsController, TevvController, EnergyController,
    AiSecurityController, EngagementController, FederalVendorController, ModelCardsController,
  ],
  providers: [
    ActingOrgInterceptor,
    PacksService, GovernanceSettingsService, AccountabilityService, RisksService, ImpactAssessmentService,
    ContextProfileService, AimsService, CorrectiveActionsService, DocumentsService, NotifierService, FeatureFlagsService,
    AuDtaService, DecisionsService, FairLendingService, ValidationService, VendorsService, TrainingService,
    DatasetsService, RedTeamAuditService,
    SoaService, DisclosuresService, IncidentExtensionsService, TevvService, EnergyService, AiSecurityService,
    EngagementService, FederalVendorService, ModelCardsService,
  ],
  exports: [
    PacksService, GovernanceSettingsService, AccountabilityService, RisksService, ImpactAssessmentService,
    AimsService, CorrectiveActionsService, DocumentsService,
  ],
})
export class GovernanceModule {}
