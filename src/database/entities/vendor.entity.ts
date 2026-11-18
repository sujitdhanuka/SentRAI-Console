import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A third party that supplies AI models, data, platforms or services (governance E2.5). */
@Entity({ name: 'vendors' })
export class VendorEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 200 })
  name!: string;

  @Column('varchar', { length: 30 })
  kind!: string;

  @Column('varchar', { length: 10 })
  criticality!: string;

  @Column('varchar', { length: 20 })
  status!: string;

  @Column('varchar', { length: 255, nullable: true })
  contact!: string | null;

  @Column('text', { nullable: true })
  services!: string | null;

  @Column('simple-json', { nullable: true })
  contractTerms!: any | null;

  @Column('simple-json', { nullable: true })
  responsibilitySplit!: any | null;

  @Column('text', { nullable: true })
  exitPlan!: string | null;

  @Column('text', { nullable: true })
  failoverPlan!: string | null;

  @Column('datetime', { nullable: true })
  nextReviewAt!: Date | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
