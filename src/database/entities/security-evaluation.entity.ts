import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** An AI security evaluation by attack category (governance E3.6). */
@Entity({ name: 'security_evaluations' })
export class SecurityEvaluationEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 500 })
  ref!: string;

  @Column('varchar', { length: 255, nullable: true })
  evaluator!: string | null;

  @Column('simple-json')
  categories!: any;

  @Column('datetime')
  evaluatedAt!: Date;

  @Column('varchar', { length: 255 })
  recordedBy!: string;

  @Column('datetime')
  createdAt!: Date;
}
