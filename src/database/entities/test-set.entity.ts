import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A TEVV test set with acceptance criteria (governance E3.4). */
@Entity({ name: 'test_sets' })
export class TestSetEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 36, nullable: true })
  datasetId!: string | null;

  @Column('varchar', { length: 200 })
  name!: string;

  @Column('varchar', { length: 30 })
  purpose!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('simple-json')
  criteria!: any;

  @Column('int')
  reviewIntervalMonths!: number;

  @Column('datetime', { nullable: true })
  lastReviewedAt!: Date | null;

  @Column('varchar', { length: 255, nullable: true })
  lastReviewedBy!: string | null;

  @Column('text', { nullable: true })
  lastReviewNote!: string | null;

  @Column('boolean')
  active!: boolean;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
