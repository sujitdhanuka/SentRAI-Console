import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Immutable risk-based audit record covering data/model/output dimensions (REC 24). */
@Entity({ name: 'ai_audit_trails' })
export class AIAuditTrailEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 50 })
  auditType!: string;

  @Column('varchar', { length: 255 })
  auditorRef!: string;

  @Column('varchar', { length: 50 })
  riskLevel!: string;

  @Column('datetime')
  auditPeriodStart!: Date;

  @Column('datetime')
  auditPeriodEnd!: Date;

  @Column('simple-json')
  inputDataAudit!: Record<string, any>;

  @Column('simple-json')
  modelAlgoAudit!: Record<string, any>;

  @Column('simple-json')
  outputBehaviourAudit!: Record<string, any>;

  @Column('simple-json')
  fairnessMetrics!: Record<string, number>;

  @Column('float')
  explainabilityScore!: number;

  @Column('simple-json')
  sutrasCompliance!: Record<string, boolean>;

  @Column('simple-json')
  findings!: any[];

  @Column('varchar', { length: 50, default: 'PENDING' })
  overallVerdict!: string;

  @Column('datetime', { nullable: true })
  nextAuditDue!: Date | null;

  @Column('datetime')
  createdAt!: Date;
}
