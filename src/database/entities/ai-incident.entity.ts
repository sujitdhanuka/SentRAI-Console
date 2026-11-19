import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** AI incident record (Annexure VI, REC 22). Write-once audit record. */
@Entity({ name: 'ai_incidents' })
export class AIIncidentEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  /** Set on gate-raised incidents, which can concern a shadow asset with no model record. */
  @Column('varchar', { length: 36, nullable: true })
  projectId!: string | null;

  @Column('varchar', { length: 255 })
  modelName!: string;

  @Column('varchar', { length: 255 })
  reName!: string;

  @Column('varchar', { length: 255 })
  functionalArea!: string;

  @Column('varchar', { length: 50 })
  incidentCategory!: string;

  @Column('varchar', { length: 50 })
  severity!: string;

  @Column('varchar', { length: 50 })
  status!: string;

  @Column('text')
  description!: string;

  @Column('datetime')
  observedAt!: Date;

  @Column('datetime')
  detectedAt!: Date;

  @Column('datetime', { nullable: true })
  reportedAt!: Date | null;

  @Column('datetime')
  reportingDeadline!: Date;

  @Column('simple-json', { nullable: true })
  affectedConsumers!: Record<string, any> | null;

  @Column('varchar', { length: 50 })
  modelRiskLevel!: string;

  @Column('boolean')
  autonomousSystemInvolved!: boolean;

  @Column('text')
  immediateActionTaken!: string;

  @Column('boolean', { default: false })
  systemSuspended!: boolean;

  @Column('boolean', { default: false })
  fallbackActivated!: boolean;

  @Column('simple-json')
  rca!: Record<string, any>;

  @Column('boolean', { default: false })
  repeatIncident!: boolean;

  @Column('simple-json')
  priorIncidentRefs!: string[];

  @Column('boolean', { default: false })
  regulatorNotified!: boolean;

  @Column('boolean', { default: false })
  boardInformed!: boolean;

  /** Governance E3.3: senior executive who signed off closure of a serious incident. */
  @Column('varchar', { length: 255, nullable: true })
  seniorSignOffBy!: string | null;

  @Column('datetime', { nullable: true })
  seniorSignOffAt!: Date | null;

  /** Governance E3.3: when the people affected were told. */
  @Column('datetime', { nullable: true })
  affectedPartiesNotifiedAt!: Date | null;

  /** Governance E3.3: ticket in the customer's ITSM (Jira, ServiceNow). */
  @Column('varchar', { length: 255, nullable: true })
  externalTicketRef!: string | null;

  /** Governance E3.3: sign-off note, affected-party notice, DTA notification, CISA playbook phases. */
  @Column('simple-json', { nullable: true })
  governanceExt!: Record<string, any> | null;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
