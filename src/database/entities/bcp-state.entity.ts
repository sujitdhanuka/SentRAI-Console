import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Persisted BCP fallback / circuit-breaker state per model. Previously held
 * in-memory only, which meant a process restart silently un-tripped breakers.
 */
@Entity({ name: 'bcp_states' })
export class BcpStateEntity {
  @PrimaryColumn('varchar', { length: 36 })
  modelId!: string;

  @Column('boolean', { default: false })
  fallbackActive!: boolean;

  @Column('text', { default: '' })
  fallbackReason!: string;

  @Column('datetime', { nullable: true })
  fallbackActivatedAt!: Date | null;

  @Column('varchar', { length: 255, nullable: true })
  rulesEngineRef!: string | null;

  @Column('datetime', { nullable: true })
  drillLastConducted!: Date | null;

  @Column('float', { default: 0.01 })
  humanSamplePct!: number;
}
