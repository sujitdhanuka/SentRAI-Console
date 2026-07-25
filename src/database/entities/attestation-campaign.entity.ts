import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A periodic re-certification drive (Pillar 1 — Alignment). Opening a campaign
 * snapshots the in-scope live models into per-model attestation items; owners
 * then confirm each model is still operating within its sanctioned scope, or
 * flag it for review. The cadence is what turns governance from a one-time
 * sign-off into a standing obligation — RBI FREE-AI and ISO 42001 both expect
 * recurring management review of deployed AI.
 */
@Entity({ name: 'attestation_campaigns' })
export class AttestationCampaignEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;

  @Column('varchar', { length: 200 })
  title!: string;

  /** Only models at or above this tier are included; null = all live models. */
  @Column('varchar', { length: 20, nullable: true })
  riskFilter!: string | null;

  @Column('int')
  cadenceDays!: number;

  @Index()
  @Column('varchar', { length: 20 })
  status!: string; // OPEN | CLOSED

  @Column('int', { default: 0 })
  itemCount!: number;

  @Column('varchar', { length: 255 })
  openedBy!: string;

  @Column('varchar', { length: 1000, nullable: true })
  note!: string | null;

  @Column('datetime')
  dueAt!: Date;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime', { nullable: true })
  closedAt!: Date | null;
}
