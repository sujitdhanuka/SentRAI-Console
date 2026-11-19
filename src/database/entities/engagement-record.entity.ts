import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Light organisational record: consultation, expert input, team composition, human-subject consent, non-AI alternative (governance E3.7). */
@Entity({ name: 'engagement_records' })
export class EngagementRecordEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 30 })
  type!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  modelId!: string | null;

  @Column('varchar', { length: 200 })
  title!: string;

  @Column('simple-json')
  participants!: any;

  @Column('text')
  summary!: string;

  @Column('text', { nullable: true })
  outcome!: string | null;

  @Column('varchar', { length: 255, nullable: true })
  consentRef!: string | null;

  @Column('datetime')
  occurredAt!: Date;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;
}
