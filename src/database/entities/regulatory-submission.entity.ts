import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A record that something was shared with or reported to a regulator (governance E2.1): the 6-monthly DTA register share and the DTA high-risk use case report. */
@Entity({ name: 'regulatory_submissions' })
export class RegulatorySubmissionEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 30 })
  kind!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  modelId!: string | null;

  @Column('datetime')
  submittedAt!: Date;

  @Column('varchar', { length: 255 })
  submittedBy!: string;

  @Column('varchar', { length: 200, nullable: true })
  recipient!: string | null;

  @Column('varchar', { length: 200, nullable: true })
  reference!: string | null;

  @Column('text', { nullable: true })
  notes!: string | null;

  @Column('varchar', { length: 64, nullable: true })
  payloadHash!: string | null;

  @Column('simple-json', { nullable: true })
  payload!: any | null;

  @Column('datetime')
  createdAt!: Date;
}
