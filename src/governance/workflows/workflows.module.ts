import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeatureFlagsService } from '../../common/feature-flags';
import {
  AIAuditTrailEntity, AIIncidentEntity, AIModelEntity, AiProviderConfigEntity, AttestationCampaignEntity, AttestationItemEntity,
  ControlledDocumentEntity, CorrectiveActionEntity, DatasetEntity, DeploymentGateEventEntity, GovernanceSettingsEntity, GrievanceEntity,
  ImpactAssessmentEntity, IntegrationEndpointEntity, ModelApprovalEntity, ModelCardEntity, ModelRetirementEntity, OrganizationEntity,
  ProjectEntity, RiskActionEntity, RiskEntity, SoaStatementEntity, ThreatModelEntity, TrainingCourseEntity, UserEntity,
} from '../../database/entities';
import { InventoryModule } from '../../inventory/inventory.module';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { GovernanceModule } from '../governance.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

/** Governance workflows page (W0 to W12): read-only status over the existing checks. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AIAuditTrailEntity, AIIncidentEntity, AIModelEntity, AiProviderConfigEntity, AttestationCampaignEntity, AttestationItemEntity,
      ControlledDocumentEntity, CorrectiveActionEntity, DatasetEntity, DeploymentGateEventEntity, GovernanceSettingsEntity, GrievanceEntity,
      ImpactAssessmentEntity, IntegrationEndpointEntity, ModelApprovalEntity, ModelCardEntity, ModelRetirementEntity, OrganizationEntity,
      ProjectEntity, RiskActionEntity, RiskEntity, SoaStatementEntity, ThreatModelEntity, TrainingCourseEntity, UserEntity,
    ]),
    GovernanceModule,
    InventoryModule,
  ],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, ActingOrgInterceptor, FeatureFlagsService],
})
export class WorkflowsModule {}
