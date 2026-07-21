import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Additive schema guard for the persistent (MariaDB) database.
 *
 * Production runs with `synchronize` OFF so a redeploy can never drop a column
 * or lose data. The trade-off is that a deploy which ADDS a column to an entity
 * would otherwise leave the live table without it — and every `SELECT *` on that
 * table then fails with "Unknown column", 500-ing whole pages (projects,
 * compliance rollup, inventory).
 *
 * This guard closes that gap safely: at boot it adds any missing column from the
 * list below. It is **additive only** — it never drops or alters existing
 * columns, so it cannot lose data. Idempotent: existing columns are skipped.
 * On SQLite dev (`synchronize` on) it's a no-op.
 *
 * When you add a new nullable column to an entity, add one line here.
 */
interface ColumnSpec {
  table: string;
  column: string;
  /** SQL type + nullability, e.g. 'TEXT NULL'. Must match the entity's mapping. */
  definition: string;
}

const REQUIRED_COLUMNS: ColumnSpec[] = [
  // ai-model.entity.ts — carried-over scan findings + description provenance.
  { table: 'ai_models', column: 'securityFindings', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'descriptionSource', definition: 'VARCHAR(20) NULL' },
  { table: 'ai_models', column: 'descriptionModel', definition: 'VARCHAR(100) NULL' },
];

/** Whole tables added after a deploy froze the schema. CREATE TABLE IF NOT
 *  EXISTS is inherently additive — an existing table is never touched. The
 *  definition must mirror the entity's column mapping. */
interface TableSpec {
  table: string;
  createSql: string;
}

const REQUIRED_TABLES: TableSpec[] = [
  {
    table: 'ai_provider_configs', // ai-provider-config.entity.ts
    createSql: `CREATE TABLE IF NOT EXISTS \`ai_provider_configs\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`tenantId\` VARCHAR(36) NOT NULL,
      \`label\` VARCHAR(120) NOT NULL,
      \`adapter\` VARCHAR(30) NOT NULL,
      \`baseUrl\` VARCHAR(500) NOT NULL,
      \`model\` VARCHAR(200) NOT NULL,
      \`apiKeyEncrypted\` TEXT NULL,
      \`apiKeyMasked\` VARCHAR(40) NULL,
      \`enabled\` TINYINT NOT NULL DEFAULT 1,
      \`defaultForUseCase\` VARCHAR(50) NULL,
      \`lastTestStatus\` VARCHAR(20) NULL,
      \`lastTestAt\` DATETIME NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_ai_provider_configs_tenant\` (\`tenantId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
];

@Injectable()
export class SchemaGuardService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchemaGuardService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Only needed for the persistent MariaDB path; SQLite dev syncs the schema.
    if (this.config.get<string>('dbProvider') !== 'mariadb') return;

    const runner = this.dataSource.createQueryRunner();
    try {
      let added = 0;
      for (const spec of REQUIRED_TABLES) {
        try {
          await runner.query(spec.createSql);
        } catch (e) {
          this.logger.warn(`Schema guard: could not ensure table ${spec.table}: ${String(e)}`);
        }
      }
      for (const spec of REQUIRED_COLUMNS) {
        try {
          if (await this.columnExists(runner, spec.table, spec.column)) continue;
          await runner.query(
            `ALTER TABLE \`${spec.table}\` ADD COLUMN \`${spec.column}\` ${spec.definition}`,
          );
          this.logger.log(`Schema guard: added missing column ${spec.table}.${spec.column}`);
          added++;
        } catch (e) {
          // One bad column must not block the others or crash boot.
          this.logger.warn(`Schema guard: could not ensure ${spec.table}.${spec.column}: ${String(e)}`);
        }
      }
      if (added) this.logger.log(`Schema guard: ${added} column(s) added additively (no data touched).`);
    } finally {
      await runner.release();
    }
  }

  private async columnExists(runner: any, table: string, column: string): Promise<boolean> {
    const rows = await runner.query(
      `SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column],
    );
    return Number(rows?.[0]?.c ?? 0) > 0;
  }
}
