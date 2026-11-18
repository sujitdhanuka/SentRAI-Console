import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A framework pack version SentRAI has loaded (governance E1.1). Written when
 * the pack engine first serves a request, so an auditor can see which pack
 * versions and content hashes were in force and when they were first seen.
 */
@Entity({ name: 'pack_versions' })
@Index('IDX_pack_versions_pack_version', ['packId', 'version'], { unique: true })
export class PackVersionEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 60 })
  packId!: string;

  @Column('varchar', { length: 30 })
  version!: string;

  @Column('datetime')
  effectiveFrom!: Date;

  /** SHA-256 of the canonical pack JSON (signing deferred; plan section 10). */
  @Column('varchar', { length: 64 })
  contentHash!: string;

  /** UPCOMING | ACTIVE | RETIRED as of the last sync. */
  @Column('varchar', { length: 20 })
  status!: string;

  @Column('datetime')
  loadedAt!: Date;
}
