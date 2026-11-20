import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Model card v2: one approval decision (governance, risk or final) on a card.
 * Append-only. `superseded` is set when a reassessment means the decision no
 * longer applies to the current facts; the row itself is kept.
 */
@Entity({ name: 'card_approvals' })
@Index('IDX_card_approvals_model', ['modelId', 'decidedAt'])
export class CardApprovalEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 36 })
  modelId!: string;

  /** GOVERNANCE, RISK or FINAL. */
  @Column('varchar', { length: 20 })
  step!: string;

  /** APPROVED, APPROVED_WITH_CONDITIONS or REJECTED. */
  @Column('varchar', { length: 30 })
  decision!: string;

  @Column('simple-json', { nullable: true })
  conditions!: any;

  @Column('text', { nullable: true })
  comment!: string | null;

  @Column('varchar', { length: 255 })
  decidedBy!: string;

  @Column('varchar', { length: 20 })
  decidedRole!: string;

  @Column('datetime')
  decidedAt!: Date;

  @Column('boolean', { default: false })
  superseded!: boolean;
}
