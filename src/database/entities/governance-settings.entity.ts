import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One version of an organisation's governance settings and risk appetite
 * (governance E1.2). Append-only: every change is a new row with a version,
 * an effective date, who changed it and a required reason. The version in
 * force on a date is the newest with effectiveFrom ≤ that date.
 */
@Entity({ name: 'governance_settings' })
@Index('IDX_governance_settings_org_version', ['orgId', 'version'], { unique: true })
export class GovernanceSettingsEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('int')
  version!: number;

  @Index()
  @Column('datetime')
  effectiveFrom!: Date;

  /** The full settings document (GovernanceSettingsDoc). */
  @Column('simple-json')
  settings!: Record<string, any>;

  /** Field-level changes against the previous version: [{ field, from, to }]. */
  @Column('simple-json', { nullable: true })
  changes!: Array<{ field: string; from: any; to: any }> | null;

  @Column('varchar', { length: 255 })
  changedBy!: string;

  @Column('varchar', { length: 30 })
  changedByRole!: string;

  @Column('varchar', { length: 1000 })
  reason!: string;

  @Column('datetime')
  createdAt!: Date;
}
