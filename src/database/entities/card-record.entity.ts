import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Model card v2: the card header for one record (ai_models row). Holds the
 * card's workflow state, the catalogue version it is assessed against and
 * whether it was created by the v1 migration. Field values are in
 * card_field_values; frozen versions stay in model_cards.
 */
@Entity({ name: 'card_records' })
export class CardRecordEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index({ unique: true })
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 20 })
  catalogueVersion!: string;

  /** DRAFT, ASSESSMENT, EVIDENCE_COLLECTION, GOVERNANCE_REVIEW, RISK_APPROVAL, FINAL_APPROVAL, ACTIVE_MONITORING, REASSESSMENT, RETIRED. */
  @Column('varchar', { length: 20 })
  workflowState!: string;

  /** Who authored the card; they cannot approve it. */
  @Column('varchar', { length: 255, nullable: true })
  author!: string | null;

  /** Assigned governance reviewer (email), if any. */
  @Column('varchar', { length: 255, nullable: true })
  reviewer!: string | null;

  @Column('datetime', { nullable: true })
  nextReviewAt!: Date | null;

  @Column('int', { nullable: true })
  lastApprovedVersion!: number | null;

  @Column('boolean', { default: false })
  migratedFromV1!: boolean;

  @Column('text', { nullable: true })
  migrationNote!: string | null;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
