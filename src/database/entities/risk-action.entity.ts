import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A treatment action on a risk (governance E1.3). */
@Entity({ name: 'risk_actions' })
export class RiskActionEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  riskId!: string;

  /** MITIGATE | TRANSFER | AVOID | ACCEPT */
  @Column('varchar', { length: 20 })
  treatment!: string;

  @Column('varchar', { length: 1000 })
  action!: string;

  @Column('varchar', { length: 36, nullable: true })
  ownerUserId!: string | null;

  @Column('datetime', { nullable: true })
  dueAt!: Date | null;

  /** OPEN | DONE | CANCELLED */
  @Column('varchar', { length: 20 })
  status!: string;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime', { nullable: true })
  completedAt!: Date | null;
}
