import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** One versioned rating of a risk: inherent and residual likelihood × impact (governance E1.3). */
@Entity({ name: 'risk_assessments' })
export class RiskAssessmentEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  riskId!: string;

  @Column('int')
  version!: number;

  /** Scoring matrix in force when assessed (5x5 | 3x3). */
  @Column('varchar', { length: 5 })
  matrix!: string;

  @Column('int')
  inherentL!: number;

  @Column('int')
  inherentI!: number;

  @Column('int')
  residualL!: number;

  @Column('int')
  residualI!: number;

  @Column('varchar', { length: 20 })
  inherentBand!: string;

  @Column('varchar', { length: 20 })
  residualBand!: string;

  @Column('text', { nullable: true })
  rationale!: string | null;

  /** Library controls relied on for the residual rating. */
  @Column('simple-json', { nullable: true })
  controlIds!: string[] | null;

  @Column('varchar', { length: 255 })
  assessedBy!: string;

  @Column('datetime')
  assessedAt!: Date;
}
