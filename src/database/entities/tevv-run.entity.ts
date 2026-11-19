import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Results of running a test set against its acceptance criteria (governance E3.4). */
@Entity({ name: 'tevv_runs' })
export class TevvRunEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  testSetId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('datetime')
  runAt!: Date;

  @Column('varchar', { length: 100, nullable: true })
  modelVersion!: string | null;

  @Column('simple-json')
  results!: any;

  @Column('boolean')
  passed!: boolean;

  @Column('simple-json', { nullable: true })
  failures!: any | null;

  @Column('varchar', { length: 500, nullable: true })
  reportRef!: string | null;

  @Column('varchar', { length: 36, nullable: true })
  reportDocId!: string | null;

  @Column('varchar', { length: 255 })
  recordedBy!: string;

  @Column('datetime')
  createdAt!: Date;
}
