import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A tracked application/codebase. Each project owns its own scan history and
 * scoped model inventory.
 */
@Entity({ name: 'projects' })
export class ProjectEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 255, unique: true })
  name!: string;

  @Column('text', { default: '' })
  description!: string;

  @Column('varchar', { length: 1000 })
  rootDirectory!: string;

  @Column('datetime', { nullable: true })
  lastScannedAt!: Date | null;

  /**
   * The candidates found the last time this project's codebase was scanned,
   * persisted in the DB so discovery survives redeploys / ephemeral hosting
   * filesystems (the extracted workspace may be wiped, but results remain).
   */
  @Column('simple-json', { nullable: true })
  lastScanResult!: { scanned_at: string; ast_coverage: string; files_flagged: number; candidates: any[] } | null;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;
}
