import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Retirement (decommissioning) request, approval and checklist for a model (governance E3.4). */
@Entity({ name: 'model_retirements' })
export class ModelRetirementEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 20 })
  status!: string;

  @Column('text')
  reason!: string;

  @Column('varchar', { length: 36, nullable: true })
  replacementModelId!: string | null;

  @Column('datetime', { nullable: true })
  plannedFor!: Date | null;

  @Column('simple-json')
  checklist!: any;

  @Column('varchar', { length: 255 })
  requestedBy!: string;

  @Column('datetime')
  requestedAt!: Date;

  @Column('varchar', { length: 255, nullable: true })
  decidedBy!: string | null;

  @Column('datetime', { nullable: true })
  decidedAt!: Date | null;

  @Column('text', { nullable: true })
  decisionNote!: string | null;

  @Column('varchar', { length: 255, nullable: true })
  completedBy!: string | null;

  @Column('datetime', { nullable: true })
  completedAt!: Date | null;
}
