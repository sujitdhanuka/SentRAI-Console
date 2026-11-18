import { Column, Entity, PrimaryColumn } from 'typeorm';

/** A tenant organization. Partitions projects, models, and users. */
@Entity({ name: 'organizations' })
export class OrganizationEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 255, unique: true })
  name!: string;

  @Column('text', { default: '' })
  description!: string;

  /** Pricing plan: COMMUNITY | GROWTH | ENTERPRISE. Soft limits only — never blocks. */
  @Column('varchar', { length: 20, default: 'COMMUNITY' })
  plan!: string;

  /** When the org was last notified about exceeding its plan's model limit. */
  @Column('datetime', { nullable: true })
  limitNotifiedAt!: Date | null;

  /** Accountable official for AI (Chief AI Officer in the US) — governance E1.9. */
  @Column('varchar', { length: 36, nullable: true })
  accountableOfficialUserId!: string | null;

  /** AI governance board members: [{ user_id?, name, title }] — governance E1.9. */
  @Column('simple-json', { nullable: true })
  governanceBoard!: Array<{ user_id?: string | null; name: string; title?: string | null }> | null;

  /** Append-only history of accountability changes (who, when, from, to, reason). */
  @Column('simple-json', { nullable: true })
  accountabilityHistory!: Array<Record<string, any>> | null;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
