import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Generated disclosures and regulator exports with publication and notification log (governance E3.2). */
@Entity({ name: 'disclosures' })
@Index('UQ_disclosures_version', ['orgId', 'kind', 'modelId', 'version'], { unique: true })
export class DisclosureEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 40 })
  kind!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  modelId!: string | null;

  @Column('int')
  version!: number;

  @Column('varchar', { length: 255 })
  title!: string;

  @Column('datetime', { nullable: true })
  periodStart!: Date | null;

  @Column('datetime', { nullable: true })
  periodEnd!: Date | null;

  @Column('simple-json')
  content!: any;

  @Column('varchar', { length: 64 })
  contentHash!: string;

  @Column('varchar', { length: 20 })
  status!: string;

  @Column('varchar', { length: 255, nullable: true })
  publishedBy!: string | null;

  @Column('datetime', { nullable: true })
  publishedAt!: Date | null;

  @Column('varchar', { length: 500, nullable: true })
  publicUrl!: string | null;

  @Column('datetime', { nullable: true })
  reviewDueAt!: Date | null;

  @Column('simple-json', { nullable: true })
  notifications!: any | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
