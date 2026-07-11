import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Immutable append-only ledger of all model state changes (REC 23). */
@Entity({ name: 'model_ledger_events' })
export class ModelLedgerEventEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 100 })
  eventType!: string;

  @Column('simple-json')
  eventData!: Record<string, any>;

  @Column('varchar', { length: 255 })
  actor!: string;

  @Column('datetime')
  occurredAt!: Date;
}
