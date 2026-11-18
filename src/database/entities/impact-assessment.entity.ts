import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * An AI system impact assessment (governance E1.4, design §3.2): a dated,
 * signed snapshot of the model's context profile, its risks and the pack
 * questionnaires. Immutable once FINAL; re-review triggers move a FINAL
 * assessment to REVALIDATION_REQUIRED, and a newer FINAL supersedes it.
 */
@Entity({ name: 'impact_assessments' })
export class ImpactAssessmentEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  /** Questionnaire ids included (iso-42001, eu-fria, au-dta, us-m25-21, us-sr26-2). */
  @Column('simple-json')
  packIds!: string[];

  @Column('int')
  version!: number;

  /** Answers keyed by questionnaire id then question id. */
  @Column('simple-json')
  questionnaire!: Record<string, Record<string, any>>;

  @Column('simple-json', { nullable: true })
  contextSnapshot!: Record<string, any> | null;

  @Column('simple-json', { nullable: true })
  riskSnapshot!: Array<Record<string, any>> | null;

  /** DRAFT | FINAL | REVALIDATION_REQUIRED | SUPERSEDED */
  @Index()
  @Column('varchar', { length: 30 })
  status!: string;

  @Column('varchar', { length: 255, nullable: true })
  signedBy!: string | null;

  @Column('varchar', { length: 30, nullable: true })
  signedByRole!: string | null;

  @Column('datetime', { nullable: true })
  signedAt!: Date | null;

  @Column('boolean', { nullable: true })
  inScope!: boolean | null;

  @Column('boolean', { nullable: true })
  highImpact!: boolean | null;

  /** SR 26-2 materiality: LOW | MEDIUM | HIGH (with a written tier justification in the questionnaire). */
  @Column('varchar', { length: 20, nullable: true })
  materiality!: string | null;

  @Column('varchar', { length: 300, nullable: true })
  revalidationReason!: string | null;

  /** SHA-256 of the signed snapshot (set on FINAL). */
  @Column('varchar', { length: 64, nullable: true })
  contentHash!: string | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
