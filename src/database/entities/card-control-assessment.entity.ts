import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Model card v2: a person's assessment of one registry control on one record,
 * pinned to the registry revision it was made against. A control with no row
 * reads as APPLICABLE or NOT_ASSESSED from applicability alone. Changes are
 * logged in the model ledger (CARD_CONTROL_CHANGED, before and after).
 */
@Entity({ name: 'card_control_assessments' })
@Index('UQ_card_control_assessments_model_fw_control', ['modelId', 'frameworkId', 'controlId'], { unique: true })
export class CardControlAssessmentEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 64 })
  frameworkId!: string;

  @Column('int')
  frameworkRevision!: number;

  @Column('varchar', { length: 64 })
  controlId!: string;

  @Column('varchar', { length: 30 })
  status!: string;

  @Column('text', { nullable: true })
  justification!: string | null;

  @Column('simple-json', { nullable: true })
  evidenceRefs!: any;

  @Column('varchar', { length: 255, nullable: true })
  assessedBy!: string | null;

  @Column('datetime', { nullable: true })
  assessedAt!: Date | null;

  @Column('varchar', { length: 255, nullable: true })
  implementedBy!: string | null;

  @Column('varchar', { length: 255, nullable: true })
  verifiedBy!: string | null;

  /** The v1 card's verdict for this framework, kept when the migration reset it to NOT_ASSESSED. */
  @Column('varchar', { length: 100, nullable: true })
  migratedFromV1Verdict!: string | null;

  @Column('datetime')
  updatedAt!: Date;
}
