import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { largeJsonColumnType, safeJsonTransformer } from '../json-transformer';

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
   *
   * `mediumtext` (16 MB) not `simple-json`/`text` (64 KB) — a large codebase's
   * scan result overran the 64 KB TEXT limit on MariaDB and truncated to invalid
   * JSON, which then crashed every read. The safe transformer additionally reads
   * a corrupt value back as `null` rather than throwing.
   */
  @Column({ type: largeJsonColumnType(), nullable: true, transformer: safeJsonTransformer })
  lastScanResult!: { scanned_at: string; ast_coverage: string; files_flagged: number; candidates: any[] } | null;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;
}
