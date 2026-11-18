import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A risk in the register (governance E1.3, design §3). Scoped to a model, a
 * use case, a vendor or the organisation. Ratings live in versioned
 * risk_assessments; treatments in risk_actions; sign-offs in risk_acceptances.
 */
@Entity({ name: 'risks' })
export class RiskEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  /** MODEL | USE_CASE | VENDOR | ORG */
  @Column('varchar', { length: 20 })
  scopeType!: string;

  @Index()
  @Column('varchar', { length: 255, nullable: true })
  scopeId!: string | null;

  /** One of the 11 catalogue categories (FAIRNESS, SECURITY, ...). */
  @Column('varchar', { length: 30 })
  category!: string;

  @Column('varchar', { length: 300 })
  title!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('simple-json', { nullable: true })
  affectedParties!: string[] | null;

  @Column('varchar', { length: 100, nullable: true })
  harmType!: string | null;

  /** MANUAL | CATALOGUE | SCAN_FINDING | INCIDENT | DRIFT_ALERT | RED_TEAM | VENDOR_CHANGE */
  @Column('varchar', { length: 20 })
  source!: string;

  /** Catalogue id or the originating record (incident id, drift report id, ...). */
  @Column('varchar', { length: 100, nullable: true })
  sourceRef!: string | null;

  /** DRAFT | ASSESSED | ACCEPTED | REVIEW_DUE | CLOSED | DISMISSED */
  @Index()
  @Column('varchar', { length: 20 })
  status!: string;

  @Column('varchar', { length: 36, nullable: true })
  ownerUserId!: string | null;

  @Column('datetime', { nullable: true })
  nextReviewAt!: Date | null;

  /** Why the risk is due for re-review (review date, incident, drift alert, ...). */
  @Column('varchar', { length: 300, nullable: true })
  reviewReason!: string | null;

  @Column('varchar', { length: 500, nullable: true })
  dismissedReason!: string | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
