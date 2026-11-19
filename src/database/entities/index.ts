import { OrganizationEntity } from './organization.entity';
import { ProjectEntity } from './project.entity';
import { AIModelEntity } from './ai-model.entity';
import { PromptEntity } from './prompt.entity';
import { ModelLedgerEventEntity } from './model-ledger-event.entity';
import { AIIncidentEntity } from './ai-incident.entity';
import { DriftReportEntity } from './drift-report.entity';
import { AIAuditTrailEntity } from './ai-audit-trail.entity';
import { UserEntity } from './user.entity';
import { BcpStateEntity } from './bcp-state.entity';
import { BcpDrillEntity } from './bcp-drill.entity';
import { ExplainabilityRecordEntity } from './explainability-record.entity';
import { AuditEventEntity } from './audit-event.entity';
import { ScoreWindowEntity } from './score-window.entity';
import { DeploymentGateEventEntity } from './deployment-gate-event.entity';
import { AiProviderConfigEntity } from './ai-provider-config.entity';
import { PromptTemplateEntity } from './prompt-template.entity';
import { AiUsageEventEntity } from './ai-usage-event.entity';
import { ModelApprovalEntity } from './model-approval.entity';
import { AttestationCampaignEntity } from './attestation-campaign.entity';
import { AttestationItemEntity } from './attestation-item.entity';
import { AgentActionEventEntity } from './agent-action-event.entity';
import { GrievanceEntity } from './grievance.entity';
import { PackVersionEntity } from './pack-version.entity';
import { ControlResultEntity } from './control-result.entity';
import { GovernanceSettingsEntity } from './governance-settings.entity';
import { RiskEntity } from './risk.entity';
import { RiskAssessmentEntity } from './risk-assessment.entity';
import { RiskActionEntity } from './risk-action.entity';
import { RiskAcceptanceEntity } from './risk-acceptance.entity';
import { ImpactAssessmentEntity } from './impact-assessment.entity';
import { AimsRecordEntity } from './aims-record.entity';
import { CorrectiveActionEntity } from './corrective-action.entity';
import { ControlledDocumentEntity } from './controlled-document.entity';
import { RegulatorySubmissionEntity } from './regulatory-submission.entity';
import { AdverseActionNoticeEntity } from './adverse-action-notice.entity';
import { DecisionAppealEntity } from './decision-appeal.entity';
import { ModelValidationEntity } from './model-validation.entity';
import { VendorEntity } from './vendor.entity';
import { VendorAssessmentEntity } from './vendor-assessment.entity';
import { AiBomItemEntity } from './ai-bom-item.entity';
import { TrainingCourseEntity } from './training-course.entity';
import { TrainingRecordEntity } from './training-record.entity';
import { DatasetEntity } from './dataset.entity';
import { ModelDatasetEntity } from './model-dataset.entity';
import { SoaEntryEntity } from './soa-entry.entity';
import { SoaStatementEntity } from './soa-statement.entity';
import { DisclosureEntity } from './disclosure.entity';
import { ModelDeployerEntity } from './model-deployer.entity';
import { IntegrationEndpointEntity } from './integration-endpoint.entity';
import { IntegrationDeliveryEntity } from './integration-delivery.entity';
import { TestSetEntity } from './test-set.entity';
import { TevvRunEntity } from './tevv-run.entity';
import { ModelRetirementEntity } from './model-retirement.entity';
import { EnergyReadingEntity } from './energy-reading.entity';
import { ThreatModelEntity } from './threat-model.entity';
import { SecurityEvaluationEntity } from './security-evaluation.entity';
import { EngagementRecordEntity } from './engagement-record.entity';
import { EuActRecordEntity } from './eu-act-record.entity';
import { AiProviderAttestationEntity } from './ai-provider-attestation.entity';
import { ModelCardEntity } from './model-card.entity';

export {
  OrganizationEntity,
  ProjectEntity,
  AIModelEntity,
  PromptEntity,
  ModelLedgerEventEntity,
  AIIncidentEntity,
  DriftReportEntity,
  AIAuditTrailEntity,
  UserEntity,
  BcpStateEntity,
  BcpDrillEntity,
  ExplainabilityRecordEntity,
  AuditEventEntity,
  ScoreWindowEntity,
  DeploymentGateEventEntity,
  AiProviderConfigEntity,
  PromptTemplateEntity,
  AiUsageEventEntity,
  ModelApprovalEntity,
  AttestationCampaignEntity,
  AttestationItemEntity,
  AgentActionEventEntity,
  GrievanceEntity,
  PackVersionEntity,
  ControlResultEntity,
  GovernanceSettingsEntity,
  RiskEntity,
  RiskAssessmentEntity,
  RiskActionEntity,
  RiskAcceptanceEntity,
  ImpactAssessmentEntity,
  AimsRecordEntity,
  CorrectiveActionEntity,
  ControlledDocumentEntity,
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
  SoaEntryEntity,
  SoaStatementEntity,
  DisclosureEntity,
  ModelDeployerEntity,
  IntegrationEndpointEntity,
  IntegrationDeliveryEntity,
  TestSetEntity,
  TevvRunEntity,
  ModelRetirementEntity,
  EnergyReadingEntity,
  ThreatModelEntity,
  SecurityEvaluationEntity,
  EngagementRecordEntity,
  AiProviderAttestationEntity,
  ModelCardEntity,
  EuActRecordEntity,
};

export const ALL_ENTITIES = [
  OrganizationEntity,
  ProjectEntity,
  AIModelEntity,
  PromptEntity,
  ModelLedgerEventEntity,
  AIIncidentEntity,
  DriftReportEntity,
  AIAuditTrailEntity,
  UserEntity,
  BcpStateEntity,
  BcpDrillEntity,
  ExplainabilityRecordEntity,
  AuditEventEntity,
  ScoreWindowEntity,
  DeploymentGateEventEntity,
  AiProviderConfigEntity,
  PromptTemplateEntity,
  AiUsageEventEntity,
  ModelApprovalEntity,
  AttestationCampaignEntity,
  AttestationItemEntity,
  AgentActionEventEntity,
  GrievanceEntity,
  PackVersionEntity,
  ControlResultEntity,
  GovernanceSettingsEntity,
  RiskEntity,
  RiskAssessmentEntity,
  RiskActionEntity,
  RiskAcceptanceEntity,
  ImpactAssessmentEntity,
  AimsRecordEntity,
  CorrectiveActionEntity,
  ControlledDocumentEntity,
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
  SoaEntryEntity,
  SoaStatementEntity,
  DisclosureEntity,
  ModelDeployerEntity,
  IntegrationEndpointEntity,
  IntegrationDeliveryEntity,
  TestSetEntity,
  TevvRunEntity,
  ModelRetirementEntity,
  EnergyReadingEntity,
  ThreatModelEntity,
  SecurityEvaluationEntity,
  EngagementRecordEntity,
  AiProviderAttestationEntity,
  ModelCardEntity,
  EuActRecordEntity,
];
