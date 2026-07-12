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
import { ExplainabilityRecordEntity } from './explainability-record.entity';
import { AuditEventEntity } from './audit-event.entity';
import { ScoreWindowEntity } from './score-window.entity';

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
  ExplainabilityRecordEntity,
  AuditEventEntity,
  ScoreWindowEntity,
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
  ExplainabilityRecordEntity,
  AuditEventEntity,
  ScoreWindowEntity,
];
