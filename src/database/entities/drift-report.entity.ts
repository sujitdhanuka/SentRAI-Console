import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A computed drift-evaluation snapshot for a model (REC 16). */
@Entity({ name: 'drift_reports' })
export class DriftReportEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('datetime')
  computedAt!: Date;

  @Column('float')
  psiScore!: number;

  @Column('float')
  wassersteinDistance!: number;

  @Column('float')
  accuracyDelta!: number;

  @Column('varchar', { length: 50 })
  status!: string;

  @Column('boolean')
  circuitBreakerActive!: boolean;

  @Column('varchar', { length: 255, nullable: true })
  humanReviewTicket!: string | null;

  @Column('text', { nullable: true })
  remediationAction!: string | null;
}
