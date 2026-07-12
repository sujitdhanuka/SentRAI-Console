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

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
