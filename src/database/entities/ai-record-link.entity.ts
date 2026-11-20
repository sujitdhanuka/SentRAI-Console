import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Model card v2: an edge in the record graph (uses_model, selects_model,
 * part_of_system, retrieves_from, calls_tool, overrides). `tenantScope` is
 * null for a global link (the platform default) and names the tenant for a
 * tenant-specific one (a BYOK override). Links are removed by setting
 * `removedAt`, never deleted, so the history stays readable.
 */
@Entity({ name: 'ai_record_links' })
@Index('IDX_ai_record_links_from_relation', ['fromModelId', 'relation'])
export class AiRecordLinkEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 36 })
  fromModelId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  toModelId!: string;

  @Column('varchar', { length: 30 })
  relation!: string;

  /** Tenant the link applies to (a tenant of the documented system, free text), or null for all tenants. */
  @Column('varchar', { length: 255, nullable: true })
  tenantScope!: string | null;

  @Column('simple-json', { nullable: true })
  attributes!: Record<string, any> | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime', { nullable: true })
  removedAt!: Date | null;

  @Column('varchar', { length: 255, nullable: true })
  removedBy!: string | null;
}
