import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One row per AI generation call — the metering/audit trail of AI-in-the-loop.
 * Gives an org cost visibility (token counts), reliability visibility
 * (latency, ok/failed), and a complete record of who invoked AI for what.
 */
@Entity({ name: 'ai_usage_events' })
export class AiUsageEventEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  /** Null for org-less (global admin) calls served by the env-level provider. */
  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;

  @Column('varchar', { length: 50 })
  useCase!: string; // model_summary | risk_rationale | gap_remediation | …

  @Column('varchar', { length: 160 })
  provider!: string; // config label · model, or the env model id

  @Column('varchar', { length: 200 })
  model!: string;

  @Column('varchar', { length: 10 })
  status!: string; // 'ok' | 'failed'

  @Column('int', { nullable: true })
  tokensIn!: number | null;

  @Column('int', { nullable: true })
  tokensOut!: number | null;

  @Column('int')
  latencyMs!: number;

  @Column('varchar', { length: 255 })
  actor!: string;

  @Column('datetime')
  createdAt!: Date;
}
