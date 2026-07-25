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
 * list below. It is **additive or lossless only** — it never drops a column, and
 * the only ALTER it performs is widening an undersized TEXT column to MEDIUMTEXT
 * (see REQUIRED_WIDENINGS), which cannot lose data. Idempotent: existing
 * columns and already-wide types are skipped.
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
  // ai-model.entity.ts — detection signals + AI-drafted risk rationale (Phase 3).
  { table: 'ai_models', column: 'detectionSignals', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'riskRationale', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'riskRationaleSource', definition: 'VARCHAR(20) NULL' },
  { table: 'ai_models', column: 'riskRationaleModel', definition: 'VARCHAR(100) NULL' },
  // ai-model.entity.ts — persisted remediation plan (Phase 5).
  { table: 'ai_models', column: 'gapRemediation', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'gapRemediationSource', definition: 'VARCHAR(20) NULL' },
  { table: 'ai_models', column: 'gapRemediationModel', definition: 'VARCHAR(100) NULL' },
  // ai-model.entity.ts — duplicate scan hits merge into one record instead of being dropped.
  { table: 'ai_models', column: 'sourceRefs', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'mergeHistory', definition: 'TEXT NULL' },
  // ai-model.entity.ts — static tool authorization + operational control (Pillar 2).
  { table: 'ai_models', column: 'detectedTools', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'permittedTools', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'operationalState', definition: "VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'" },
  { table: 'ai_models', column: 'operationalStateReason', definition: 'VARCHAR(500) NULL' },
  { table: 'ai_models', column: 'operationalStateSince', definition: 'DATETIME NULL' },
  // project.entity.ts — codebase origin ('zip'/'folder'/'github:owner/repo@branch').
  { table: 'projects', column: 'codebaseSource', definition: 'VARCHAR(300) NULL' },
  // project.entity.ts — board-facing executive narrative (Phase 5).
  { table: 'projects', column: 'execNarrative', definition: 'TEXT NULL' },
  { table: 'projects', column: 'execNarrativeSource', definition: 'VARCHAR(20) NULL' },
  { table: 'projects', column: 'execNarrativeModel', definition: 'VARCHAR(100) NULL' },
  { table: 'projects', column: 'execNarrativeAt', definition: 'DATETIME NULL' },
  // ai-provider-config.entity.ts — link to the self-registered inventory model.
  { table: 'ai_provider_configs', column: 'linkedModelId', definition: 'VARCHAR(36) NULL' },
];

/**
 * Columns whose entity mapping WIDENED over time (TEXT → MEDIUMTEXT). A live
 * table created by an older build keeps its original 64 KB TEXT column, and
 * MariaDB then silently truncates larger writes — the safe JSON transformer
 * reads the mangled value back as `null`, so the data simply vanishes.
 * Verified live 2026-07-24: a 900-file GitHub import scanned 85 models but the
 * project card showed 0 because `projects.lastScanResult` overran TEXT.
 *
 * Widening is the one ALTER that can never lose data (every TEXT value fits in
 * MEDIUMTEXT), so it keeps the guard's no-data-loss contract. Nullability is
 * read from the live schema and preserved. Anything already MEDIUMTEXT or
 * larger is left untouched.
 */
interface WidenSpec {
  table: string;
  column: string;
}

const REQUIRED_WIDENINGS: WidenSpec[] = [
  // project.entity.ts — lastScanResult holds the full scan JSON (candidates,
  // signals, snippets); a big repo's result far exceeds 64 KB.
  { table: 'projects', column: 'lastScanResult' },
  // deployment-gate-event.entity.ts — blockingGaps carries AST evidence
  // snippets for every flagged model; same overflow class.
  { table: 'deployment_gate_events', column: 'blockingGaps' },
];

/** Text types strictly smaller than MEDIUMTEXT — the only ones we widen. */
const NARROW_TEXT_TYPES = new Set(['tinytext', 'text', 'varchar', 'char']);

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
  {
    table: 'prompt_templates', // prompt-template.entity.ts
    createSql: `CREATE TABLE IF NOT EXISTS \`prompt_templates\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`tenantId\` VARCHAR(36) NOT NULL,
      \`useCase\` VARCHAR(50) NOT NULL,
      \`version\` INT NOT NULL,
      \`body\` TEXT NOT NULL,
      \`active\` TINYINT NOT NULL DEFAULT 0,
      \`changeNote\` VARCHAR(255) NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_prompt_templates_tenant\` (\`tenantId\`),
      INDEX \`IDX_prompt_templates_usecase\` (\`useCase\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'ai_usage_events', // ai-usage-event.entity.ts
    createSql: `CREATE TABLE IF NOT EXISTS \`ai_usage_events\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`tenantId\` VARCHAR(36) NULL,
      \`useCase\` VARCHAR(50) NOT NULL,
      \`provider\` VARCHAR(160) NOT NULL,
      \`model\` VARCHAR(200) NOT NULL,
      \`status\` VARCHAR(10) NOT NULL,
      \`tokensIn\` INT NULL,
      \`tokensOut\` INT NULL,
      \`latencyMs\` INT NOT NULL,
      \`actor\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_ai_usage_events_tenant\` (\`tenantId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'model_approvals', // model-approval.entity.ts (Pillar 1 — Alignment)
    createSql: `CREATE TABLE IF NOT EXISTS \`model_approvals\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`tenantId\` VARCHAR(36) NULL,
      \`modelName\` VARCHAR(200) NOT NULL,
      \`riskLevel\` VARCHAR(20) NOT NULL,
      \`targetStage\` VARCHAR(30) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`requiredApprovals\` INT NOT NULL DEFAULT 1,
      \`requestedBy\` VARCHAR(255) NOT NULL,
      \`requestedByRole\` VARCHAR(30) NOT NULL,
      \`requestNote\` VARCHAR(1000) NULL,
      \`decisions\` TEXT NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`resolvedAt\` DATETIME NULL,
      INDEX \`IDX_model_approvals_model\` (\`modelId\`),
      INDEX \`IDX_model_approvals_tenant\` (\`tenantId\`),
      INDEX \`IDX_model_approvals_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'attestation_campaigns', // attestation-campaign.entity.ts
    createSql: `CREATE TABLE IF NOT EXISTS \`attestation_campaigns\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`tenantId\` VARCHAR(36) NULL,
      \`title\` VARCHAR(200) NOT NULL,
      \`riskFilter\` VARCHAR(20) NULL,
      \`cadenceDays\` INT NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`itemCount\` INT NOT NULL DEFAULT 0,
      \`openedBy\` VARCHAR(255) NOT NULL,
      \`note\` VARCHAR(1000) NULL,
      \`dueAt\` DATETIME NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`closedAt\` DATETIME NULL,
      INDEX \`IDX_attestation_campaigns_tenant\` (\`tenantId\`),
      INDEX \`IDX_attestation_campaigns_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'attestation_items', // attestation-item.entity.ts
    createSql: `CREATE TABLE IF NOT EXISTS \`attestation_items\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`campaignId\` VARCHAR(36) NOT NULL,
      \`tenantId\` VARCHAR(36) NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`modelName\` VARCHAR(200) NOT NULL,
      \`riskLevel\` VARCHAR(20) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`attestedBy\` VARCHAR(255) NULL,
      \`attestedByRole\` VARCHAR(30) NULL,
      \`note\` VARCHAR(1000) NULL,
      \`dueAt\` DATETIME NOT NULL,
      \`attestedAt\` DATETIME NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_attestation_items_campaign\` (\`campaignId\`),
      INDEX \`IDX_attestation_items_tenant\` (\`tenantId\`),
      INDEX \`IDX_attestation_items_model\` (\`modelId\`),
      INDEX \`IDX_attestation_items_status\` (\`status\`)
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
      for (const spec of REQUIRED_WIDENINGS) {
        try {
          const live = await this.columnInfo(runner, spec.table, spec.column);
          if (!live || !NARROW_TEXT_TYPES.has(live.dataType)) continue;
          await runner.query(
            `ALTER TABLE \`${spec.table}\` MODIFY \`${spec.column}\` MEDIUMTEXT ${live.nullable ? 'NULL' : 'NOT NULL'}`,
          );
          this.logger.log(`Schema guard: widened ${spec.table}.${spec.column} ${live.dataType} → mediumtext (lossless).`);
        } catch (e) {
          this.logger.warn(`Schema guard: could not widen ${spec.table}.${spec.column}: ${String(e)}`);
        }
      }
    } finally {
      await runner.release();
    }
  }

  private async columnInfo(
    runner: any,
    table: string,
    column: string,
  ): Promise<{ dataType: string; nullable: boolean } | null> {
    const rows = await runner.query(
      `SELECT DATA_TYPE AS dataType, IS_NULLABLE AS isNullable FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column],
    );
    if (!rows?.length) return null;
    return { dataType: String(rows[0].dataType).toLowerCase(), nullable: rows[0].isNullable === 'YES' };
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
