import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A window of inference scores pushed by a serving system for drift
 * evaluation. 'reference' windows are the training/baseline distribution;
 * 'live' windows are recent production scores. The hourly monitoring job
 * evaluates the newest live window of each model against its reference.
 */
@Entity({ name: 'score_windows' })
export class ScoreWindowEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 20 })
  kind!: 'reference' | 'live';

  @Column('simple-json')
  scores!: number[];

  @Column('float', { nullable: true })
  accuracy!: number | null;

  @Index()
  @Column('datetime')
  capturedAt!: Date;

  @Column('boolean', { default: false })
  evaluated!: boolean;
}
