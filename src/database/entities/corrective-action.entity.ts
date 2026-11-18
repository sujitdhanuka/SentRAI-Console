import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A nonconformity and its corrective action (governance E1.7, ISO 10.2).
 * Fed by failed controls, audit findings, incidents, validation findings,
 * management review and resolved grievances.
 */
@Entity({ name: 'corrective_actions' })
export class CorrectiveActionEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  /** AUDIT | CONTROL | INCIDENT | VALIDATION | MGMT_REVIEW | GRIEVANCE | OTHER */
  @Column('varchar', { length: 20 })
  source!: string;

  @Index()
  @Column('varchar', { length: 100, nullable: true })
  sourceId!: string | null;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  modelId!: string | null;

  @Column('text')
  nonconformity!: string;

  @Column('text', { nullable: true })
  rootCause!: string | null;

  @Column('text')
  action!: string;

  @Column('varchar', { length: 36, nullable: true })
  ownerUserId!: string | null;

  @Column('datetime', { nullable: true })
  dueAt!: Date | null;

  /** OPEN | IN_PROGRESS | AWAITING_EFFECTIVENESS | CLOSED | CANCELLED */
  @Index()
  @Column('varchar', { length: 30 })
  status!: string;

  /** Effectiveness review: did the action stop the nonconformity recurring? */
  @Column('text', { nullable: true })
  effectivenessReview!: string | null;

  @Column('boolean', { nullable: true })
  effective!: boolean | null;

  @Column('datetime', { nullable: true })
  closedAt!: Date | null;

  @Column('varchar', { length: 255, nullable: true })
  closedBy!: string | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
