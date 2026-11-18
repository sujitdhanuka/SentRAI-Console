import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** An adverse-action notice built from a decision explanation (governance E2.2, Reg B / Colorado): stated reasons, the top factors they must match, and the retention date. */
@Entity({ name: 'adverse_action_notices' })
export class AdverseActionNoticeEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Index()
  @Column('varchar', { length: 255 })
  decisionRef!: string;

  @Column('varchar', { length: 36, nullable: true })
  explainabilityRecordId!: string | null;

  @Column('simple-json')
  reasonCodes!: any;

  @Column('simple-json')
  topFactors!: any;

  @Column('boolean')
  consistent!: boolean;

  @Column('simple-json', { nullable: true })
  mismatches!: any | null;

  @Column('varchar', { length: 20 })
  channel!: string;

  @Column('datetime')
  sentAt!: Date;

  @Index()
  @Column('datetime')
  retentionUntil!: Date;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;
}
