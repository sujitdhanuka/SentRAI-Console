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

  /**
   * Where the codebase came from: 'zip', 'folder', or 'github:owner/repo@branch'.
   * Lets the console prefill a re-import. Access tokens are deliberately NOT
   * part of this — a token is used once to download the archive and never
   * persisted, so every re-import asks for it again.
   */
  @Column('varchar', { length: 300, nullable: true })
  codebaseSource!: string | null;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;

  /**
   * Board-facing executive summary of this project's governance posture, with
   * the same provenance scheme as the per-model generations. Regenerated on
   * demand — it reflects the portfolio at the moment it was drafted.
   */
  @Column('text', { nullable: true })
  execNarrative!: string | null;

  @Column('varchar', { length: 20, nullable: true })
  execNarrativeSource!: string | null;

  @Column('varchar', { length: 100, nullable: true })
  execNarrativeModel!: string | null;

  @Column('datetime', { nullable: true })
  execNarrativeAt!: Date | null;
}
