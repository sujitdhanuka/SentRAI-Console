import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Append-only record of every pre-deployment CI gate decision. This is the
 * "defensible audit trail before non-compliant models hit production" — one
 * immutable row per pipeline scan, keyed to the commit that triggered it.
 * Columns use portable types (varchar/simple-json) so the same schema serves
 * SQLite (dev) and MariaDB (prod).
 */
@Entity({ name: 'deployment_gate_events' })
export class DeploymentGateEventEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  projectId!: string;

  @Index()
  @Column('varchar', { length: 100 })
  commitSha!: string;

  @Column('varchar', { length: 50, nullable: true })
  prNumber!: string | null;

  @Column('varchar', { length: 100, nullable: true })
  pipelineRunId!: string | null;

  @Column('varchar', { length: 10 })
  verdict!: 'pass' | 'fail';

  @Column('int', { default: 0 })
  modelsDetected!: number;

  /** The governance omissions that caused a `fail` (empty on `pass`). */
  @Column('simple-json')
  blockingGaps!: Array<{
    model_name: string;
    severity: string;
    file_location: string;
    missing: string[];
    reason: string;
    shadow: boolean;
  }>;

  @Column('varchar', { length: 255 })
  triggeredBy!: string;

  @Index()
  @Column('datetime')
  occurredAt!: Date;
}
