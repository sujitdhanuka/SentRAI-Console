import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A dataset in the data register (governance E2.7): source, acquisition, lawful basis, quality, provenance, retention and deletion. */
@Entity({ name: 'datasets' })
export class DatasetEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 200 })
  name!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('varchar', { length: 500, nullable: true })
  source!: string | null;

  @Column('varchar', { length: 30, nullable: true })
  acquisition!: string | null;

  @Column('varchar', { length: 30, nullable: true })
  lawfulBasis!: string | null;

  @Column('varchar', { length: 255, nullable: true })
  consentRef!: string | null;

  @Column('boolean')
  personalData!: boolean;

  @Column('boolean')
  sensitiveData!: boolean;

  @Column('simple-json', { nullable: true })
  qualityChecks!: any | null;

  @Column('text', { nullable: true })
  provenance!: string | null;

  @Column('text', { nullable: true })
  preparation!: string | null;

  @Column('text', { nullable: true })
  accessControls!: string | null;

  @Column('datetime', { nullable: true })
  retentionUntil!: Date | null;

  @Column('varchar', { length: 20 })
  deletionStatus!: string;

  @Column('simple-json', { nullable: true })
  deletionOrders!: any | null;

  @Column('varchar', { length: 36, nullable: true })
  ownerUserId!: string | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
