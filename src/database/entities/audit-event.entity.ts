import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A global audit event — one row per mutating API request (success or failure),
 * written by the AuditEventsInterceptor. Complements the per-model ledger:
 * the ledger tracks model lifecycle, this table tracks every actor action
 * across users, orgs, projects, compliance runs, monitoring, and auth.
 */
@Entity({ name: 'audit_events' })
export class AuditEventEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 255 })
  actor!: string;

  @Column('varchar', { length: 50, default: '' })
  actorRole!: string;

  @Column('varchar', { length: 10 })
  method!: string;

  @Index()
  @Column('varchar', { length: 512 })
  path!: string;

  @Column('int')
  statusCode!: number;

  @Column('varchar', { length: 20 })
  outcome!: 'SUCCESS' | 'FAILURE';

  @Column('simple-json', { nullable: true })
  payloadSummary!: Record<string, any> | null;

  @Index()
  @Column('datetime')
  occurredAt!: Date;

  /** SHA-256 over the event's canonical content + prevHash — the chain link
   *  that makes the ledger tamper-evident. Null only on pre-chain rows. */
  @Column('varchar', { length: 64, nullable: true })
  contentHash!: string | null;

  /** contentHash of the previous chained event ('GENESIS' for the first). */
  @Column('varchar', { length: 64, nullable: true })
  prevHash!: string | null;
}
