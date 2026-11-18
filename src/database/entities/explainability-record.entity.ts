import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A persisted explainability record for an individual model decision (REC 24).
 * Previously these were written to the application log and discarded.
 */
@Entity({ name: 'explainability_records' })
export class ExplainabilityRecordEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 255 })
  decisionRef!: string;

  @Column('varchar', { length: 255 })
  decisionOutcome!: string;

  /** The model that made the decision (optional; governance E2.2 uses it to scope notices to the model's organisation). */
  @Index()
  @Column('varchar', { length: 36, nullable: true })
  modelId!: string | null;

  @Column('float')
  confidenceScore!: number;

  @Column('simple-json')
  topFeatures!: Record<string, number>;

  @Column('varchar', { length: 100, default: 'SHAP' })
  explanationMethod!: string;

  @Column('text', { default: '' })
  humanReadableSummary!: string;

  @Column('boolean', { default: true })
  isContestable!: boolean;

  @Column('datetime')
  createdAt!: Date;
}
