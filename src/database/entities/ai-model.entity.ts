import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * AI model inventory entry (REC 23). Enum-valued columns are stored as
 * varchar (SQLite has no native enum); DTO validation enforces the allowed set.
 */
@Entity({ name: 'ai_models' })
export class AIModelEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  projectId!: string | null;

  @Column('varchar', { length: 255 })
  name!: string;

  @Column('varchar', { length: 50 })
  modelType!: string;

  @Column('varchar', { length: 255 })
  functionalArea!: string;

  @Column('text')
  useCaseDescription!: string;

  @Column('simple-json')
  targetCustomerSegments!: string[];

  @Column('varchar', { length: 50 })
  riskLevel!: string;

  @Column('varchar', { length: 50 })
  lifecycleStage!: string;

  @Column('varchar', { length: 255 })
  ownerTeam!: string;

  @Column('varchar', { length: 255 })
  developedBy!: string;

  @Column('datetime', { nullable: true })
  deploymentDate!: Date | null;

  @Column('simple-json')
  dependencies!: any[];

  @Column('simple-json')
  performanceBenchmarks!: any[];

  @Column('simple-json')
  sutrasAlignment!: string[];

  @Column('boolean', { default: true })
  humanOversightRequired!: boolean;

  @Column('text', { nullable: true })
  autonomousScope!: string | null;

  @Column('varchar', { length: 255 })
  boardPolicyRef!: string;

  @Column('datetime', { nullable: true })
  lastRedTeamDate!: Date | null;

  @Column('datetime', { nullable: true })
  nextAuditDue!: Date | null;

  @Column('int', { default: 0 })
  grievanceCount!: number;

  @Column('text', { default: '' })
  grievanceResolutionNotes!: string;

  @Column('varchar', { length: 500, nullable: true })
  sourceRef!: string | null;

  /** Attached evidence artifacts: bias-test reports, red-team reports, etc. */
  @Column('simple-json', { nullable: true })
  evidenceArtifacts!: Array<{ type: string; ref: string; description?: string; added_at: string }> | null;

  /**
   * Hardcoded secrets / credentials found in the model's source at scan time
   * (values are masked). Carried over from discovery so the security warning
   * surfaced during the scan survives into the governed inventory record.
   */
  @Column('simple-json', { nullable: true })
  securityFindings!: Array<{ type: string; masked_value: string; line: number }> | null;

  /** Provenance of useCaseDescription: 'static' (docstring), 'heuristic' (local
   *  auto-summary), 'ai' (LLM-drafted), or 'human' (edited/confirmed). Lets the
   *  UI flag an unreviewed AI/auto draft. Null = legacy/unknown (treat as static). */
  @Column('varchar', { length: 20, nullable: true })
  descriptionSource!: string | null;

  /** The model that produced an AI description, e.g. 'claude-sonnet-5'. */
  @Column('varchar', { length: 100, nullable: true })
  descriptionModel!: string | null;

  @Column('boolean', { default: true })
  isActive!: boolean;

  @Column('datetime')
  registeredAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
