import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { largeJsonColumnType, safeJsonTransformer } from '../json-transformer';

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

  /**
   * The ORIGINAL, immutable pipeline decision. This is never rewritten — an
   * auditor override is recorded additively in the override* columns below, so
   * the record of the original failure survives for the audit trail.
   */
  @Column('varchar', { length: 10 })
  verdict!: 'pass' | 'fail';

  @Column('int', { default: 0 })
  modelsDetected!: number;

  /**
   * The governance omissions that caused a `fail` (empty on `pass`). `evidence`
   * carries the exact flagged lines (path/line/snippet) so an auditor can review
   * the AST-flagged code inline without the scanned workspace being retained.
   * `mediumtext` + safe transformer so a large scan can't overrun the 64 KB TEXT
   * limit on MariaDB and crash reads (same class of bug as project scan results).
   */
  @Column({ type: largeJsonColumnType(), transformer: safeJsonTransformer })
  blockingGaps!: Array<{
    model_name: string;
    severity: string;
    file_location: string;
    missing: string[];
    reason: string;
    shadow: boolean;
    evidence?: Array<{ line: number; snippet: string; category: string }>;
  }>;

  @Column('varchar', { length: 255 })
  triggeredBy!: string;

  // ── Additive auditor override (never mutates `verdict`) ──────────────────
  /** Email of the auditor who signed off an override, or null if none. */
  @Column('varchar', { length: 255, nullable: true })
  overriddenBy!: string | null;

  /** Mandatory justification captured at override time (immutable once set). */
  @Column('varchar', { length: 1000, nullable: true })
  overrideReason!: string | null;

  @Column('datetime', { nullable: true })
  overriddenAt!: Date | null;

  @Index()
  @Column('datetime')
  occurredAt!: Date;
}
