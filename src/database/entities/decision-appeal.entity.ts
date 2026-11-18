import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** An appeal, human reconsideration or data-correction request tied to one decision (governance E2.2). */
@Entity({ name: 'decision_appeals' })
export class DecisionAppealEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  grievanceId!: string | null;

  @Index()
  @Column('varchar', { length: 255 })
  decisionRef!: string;

  @Column('varchar', { length: 20 })
  type!: string;

  @Index()
  @Column('varchar', { length: 20 })
  status!: string;

  @Column('text')
  request!: string;

  @Column('varchar', { length: 255, nullable: true })
  requestedBy!: string | null;

  @Column('varchar', { length: 36, nullable: true })
  reviewerUserId!: string | null;

  @Column('text', { nullable: true })
  authority!: string | null;

  @Column('text', { nullable: true })
  evidence!: string | null;

  @Column('varchar', { length: 30, nullable: true })
  outcome!: string | null;

  @Column('text', { nullable: true })
  outcomeNotes!: string | null;

  @Column('datetime', { nullable: true })
  decidedAt!: Date | null;

  @Column('varchar', { length: 255, nullable: true })
  decidedBy!: string | null;

  @Column('datetime', { nullable: true })
  dueAt!: Date | null;

  @Column('datetime', { nullable: true })
  retentionUntil!: Date | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
