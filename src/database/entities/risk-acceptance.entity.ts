import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Acceptance of a risk's residual rating by the approver the risk appetite
 * requires for its band (governance E1.3). Also serves as an OMB M-25-21
 * waiver record (waiverRef). Bound to one assessment version.
 */
@Entity({ name: 'risk_acceptances' })
export class RiskAcceptanceEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  riskId!: string;

  @Column('int')
  assessmentVersion!: number;

  @Column('varchar', { length: 255 })
  acceptedBy!: string;

  /** The role the acceptance relied on (e.g. CISO, ACCOUNTABLE_OFFICIAL). */
  @Column('varchar', { length: 30 })
  role!: string;

  @Column('datetime')
  acceptedAt!: Date;

  @Column('datetime', { nullable: true })
  expiresAt!: Date | null;

  @Column('varchar', { length: 200, nullable: true })
  waiverRef!: string | null;

  @Column('varchar', { length: 1000, nullable: true })
  note!: string | null;
}
