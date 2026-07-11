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

  @Column('boolean', { default: true })
  isActive!: boolean;

  @Column('datetime')
  registeredAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
