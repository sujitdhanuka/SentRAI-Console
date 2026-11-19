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
  // ai-incident.entity.ts — owning project of gate-raised incidents.
  { table: 'ai_incidents', column: 'projectId', definition: 'VARCHAR(36) NULL' },
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
  { table: 'ai_models', column: 'gapRemediationGaps', definition: 'TEXT NULL' },
  // ai-model.entity.ts — duplicate scan hits merge into one record instead of being dropped.
  { table: 'ai_models', column: 'sourceRefs', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'mergeHistory', definition: 'TEXT NULL' },
  // ai-model.entity.ts — file + line numbers for every place the model appears.
  { table: 'ai_models', column: 'sourceLocations', definition: 'TEXT NULL' },
  // ai-model.entity.ts — static tool authorization + operational control (Pillar 2).
  { table: 'ai_models', column: 'detectedTools', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'permittedTools', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'operationalState', definition: "VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'" },
  { table: 'ai_models', column: 'operationalStateReason', definition: 'VARCHAR(500) NULL' },
  { table: 'ai_models', column: 'operationalStateSince', definition: 'DATETIME NULL' },
  // organization.entity.ts — accountable official, governance board (governance E1.9).
  // ai-incident.entity.ts — senior sign-off, affected-party notice, external ticket (governance E3.3).
  { table: 'ai_incidents', column: 'seniorSignOffBy', definition: 'VARCHAR(255) NULL' },
  { table: 'ai_incidents', column: 'seniorSignOffAt', definition: 'DATETIME NULL' },
  { table: 'ai_incidents', column: 'affectedPartiesNotifiedAt', definition: 'DATETIME NULL' },
  { table: 'ai_incidents', column: 'externalTicketRef', definition: 'VARCHAR(255) NULL' },
  { table: 'ai_incidents', column: 'governanceExt', definition: 'MEDIUMTEXT NULL' },
  // ai-model.entity.ts — measured energy and CO2e (governance E3.5).
  { table: 'ai_models', column: 'energyKwh', definition: 'DOUBLE NULL' },
  { table: 'ai_models', column: 'co2eKg', definition: 'DOUBLE NULL' },
  { table: 'organizations', column: 'accountableOfficialUserId', definition: 'VARCHAR(36) NULL' },
  { table: 'organizations', column: 'governanceBoard', definition: 'TEXT NULL' },
  { table: 'organizations', column: 'accountabilityHistory', definition: 'TEXT NULL' },
  // ai-model.entity.ts — structured context profile (governance E1.5).
  { table: 'ai_models', column: 'contextProfile', definition: 'TEXT NULL' },
  // ai-model.entity.ts — named model owner (governance E1.9).
  { table: 'ai_models', column: 'ownerUserId', definition: 'VARCHAR(36) NULL' },
  // ai-model.entity.ts — governance Phase 2: reason codes (E2.2), MRM scope (E2.3), red-team-required flag (E2.8).
  { table: 'ai_models', column: 'reasonCodeMap', definition: 'TEXT NULL' },
  { table: 'ai_models', column: 'reasonCodeSign', definition: 'VARCHAR(10) NULL' },
  { table: 'ai_models', column: 'mrmInScope', definition: 'TINYINT(1) NULL' },
  { table: 'ai_models', column: 'mrmExclusionReason', definition: 'VARCHAR(500) NULL' },
  { table: 'ai_models', column: 'redTeamRequiredAt', definition: 'DATETIME NULL' },
  { table: 'ai_models', column: 'redTeamRequiredReason', definition: 'VARCHAR(500) NULL' },
  // grievance.entity.ts — decision link and appeal chain (governance E2.2).
  { table: 'grievances', column: 'decisionRef', definition: 'VARCHAR(255) NULL' },
  // explainability-record.entity.ts: the model a decision explanation belongs to (governance E2.2 tenant scoping).
  { table: 'explainability_records', column: 'modelId', definition: 'VARCHAR(36) NULL' },
  { table: 'model_validations', column: 'independenceAttestedBy', definition: 'VARCHAR(255) NULL' },
  { table: 'model_validations', column: 'independenceAttestedAt', definition: 'DATETIME NULL' },
  { table: 'grievances', column: 'appealOf', definition: 'VARCHAR(36) NULL' },
  // project.entity.ts — codebase origin ('zip'/'folder'/'github:owner/repo@branch').
  { table: 'projects', column: 'codebaseSource', definition: 'VARCHAR(300) NULL' },
  // project.entity.ts — board-facing executive narrative (Phase 5).
  { table: 'projects', column: 'execNarrative', definition: 'TEXT NULL' },
  { table: 'projects', column: 'execNarrativeSource', definition: 'VARCHAR(20) NULL' },
  { table: 'projects', column: 'execNarrativeModel', definition: 'VARCHAR(100) NULL' },
  { table: 'projects', column: 'execNarrativeAt', definition: 'DATETIME NULL' },
  // ai-provider-config.entity.ts — link to the self-registered inventory model.
  { table: 'ai_provider_configs', column: 'linkedModelId', definition: 'VARCHAR(36) NULL' },
  // audit-event.entity.ts — tamper-evident hash chain (null on pre-chain rows).
  { table: 'audit_events', column: 'contentHash', definition: 'VARCHAR(64) NULL' },
  { table: 'audit_events', column: 'prevHash', definition: 'VARCHAR(64) NULL' },
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
  // Governance Phase 2: JSON that grows with use (reason-code maps, fair-lending
  // evidence on the model, deletion orders, validation findings).
  { table: 'ai_models', column: 'reasonCodeMap' },
  { table: 'ai_models', column: 'evidenceArtifacts' },
  { table: 'datasets', column: 'qualityChecks' },
  { table: 'datasets', column: 'deletionOrders' },
  { table: 'model_validations', column: 'findings' },
];

/** Secondary indexes on existing tables (CREATE INDEX only when missing). */
interface IndexSpec {
  table: string;
  name: string;
  column: string;
}

const REQUIRED_INDEXES: IndexSpec[] = [
  { table: 'grievances', name: 'IDX_grievances_decisionRef', column: 'decisionRef' },
  { table: 'explainability_records', name: 'IDX_explainability_records_modelId', column: 'modelId' },
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
    table: 'regulatory_submissions', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`regulatory_submissions\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`kind\` VARCHAR(30) NOT NULL,
      \`modelId\` VARCHAR(36) NULL,
      \`submittedAt\` DATETIME NOT NULL,
      \`submittedBy\` VARCHAR(255) NOT NULL,
      \`recipient\` VARCHAR(200) NULL,
      \`reference\` VARCHAR(200) NULL,
      \`notes\` TEXT NULL,
      \`payloadHash\` VARCHAR(64) NULL,
      \`payload\` TEXT NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_regulatory_submissions_orgId\` (\`orgId\`),
      INDEX \`IDX_regulatory_submissions_modelId\` (\`modelId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'adverse_action_notices', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`adverse_action_notices\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`decisionRef\` VARCHAR(255) NOT NULL,
      \`explainabilityRecordId\` VARCHAR(36) NULL,
      \`reasonCodes\` TEXT NOT NULL,
      \`topFactors\` TEXT NOT NULL,
      \`consistent\` TINYINT(1) NOT NULL,
      \`mismatches\` TEXT NULL,
      \`channel\` VARCHAR(20) NOT NULL,
      \`sentAt\` DATETIME NOT NULL,
      \`retentionUntil\` DATETIME NOT NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_adverse_action_notices_orgId\` (\`orgId\`),
      INDEX \`IDX_adverse_action_notices_modelId\` (\`modelId\`),
      INDEX \`IDX_adverse_action_notices_decisionRef\` (\`decisionRef\`),
      INDEX \`IDX_adverse_action_notices_retentionUntil\` (\`retentionUntil\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'decision_appeals', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`decision_appeals\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`grievanceId\` VARCHAR(36) NULL,
      \`decisionRef\` VARCHAR(255) NOT NULL,
      \`type\` VARCHAR(20) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`request\` TEXT NOT NULL,
      \`requestedBy\` VARCHAR(255) NULL,
      \`reviewerUserId\` VARCHAR(36) NULL,
      \`authority\` TEXT NULL,
      \`evidence\` TEXT NULL,
      \`outcome\` VARCHAR(30) NULL,
      \`outcomeNotes\` TEXT NULL,
      \`decidedAt\` DATETIME NULL,
      \`decidedBy\` VARCHAR(255) NULL,
      \`dueAt\` DATETIME NULL,
      \`retentionUntil\` DATETIME NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_decision_appeals_orgId\` (\`orgId\`),
      INDEX \`IDX_decision_appeals_modelId\` (\`modelId\`),
      INDEX \`IDX_decision_appeals_grievanceId\` (\`grievanceId\`),
      INDEX \`IDX_decision_appeals_decisionRef\` (\`decisionRef\`),
      INDEX \`IDX_decision_appeals_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'model_validations', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`model_validations\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`version\` INT NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`result\` VARCHAR(30) NULL,
      \`validatorUserId\` VARCHAR(36) NULL,
      \`validatorEmail\` VARCHAR(255) NULL,
      \`independent\` TINYINT(1) NOT NULL,
      \`independenceReasons\` TEXT NULL,
      \`independenceAttestedBy\` VARCHAR(255) NULL,
      \`independenceAttestedAt\` DATETIME NULL,
      \`scope\` TEXT NULL,
      \`conceptualSoundness\` TEXT NULL,
      \`implementationReview\` TEXT NULL,
      \`outcomesAnalysis\` TEXT NULL,
      \`vendorModel\` TINYINT(1) NOT NULL,
      \`tempUseException\` TINYINT(1) NOT NULL,
      \`compensatingControls\` TEXT NULL,
      \`exceptionExpiresAt\` DATETIME NULL,
      \`expiresAt\` DATETIME NULL,
      \`findings\` MEDIUMTEXT NULL,
      \`completedAt\` DATETIME NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_model_validations_orgId\` (\`orgId\`),
      INDEX \`IDX_model_validations_modelId\` (\`modelId\`),
      INDEX \`IDX_model_validations_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'vendors', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`vendors\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(200) NOT NULL,
      \`kind\` VARCHAR(30) NOT NULL,
      \`criticality\` VARCHAR(10) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`contact\` VARCHAR(255) NULL,
      \`services\` TEXT NULL,
      \`contractTerms\` TEXT NULL,
      \`responsibilitySplit\` TEXT NULL,
      \`exitPlan\` TEXT NULL,
      \`failoverPlan\` TEXT NULL,
      \`nextReviewAt\` DATETIME NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_vendors_orgId\` (\`orgId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'vendor_assessments', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`vendor_assessments\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`vendorId\` VARCHAR(36) NOT NULL,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`version\` INT NOT NULL,
      \`answers\` TEXT NOT NULL,
      \`score\` INT NOT NULL,
      \`result\` VARCHAR(20) NOT NULL,
      \`gaps\` TEXT NULL,
      \`notes\` TEXT NULL,
      \`assessedBy\` VARCHAR(255) NOT NULL,
      \`assessedAt\` DATETIME NOT NULL,
      INDEX \`IDX_vendor_assessments_vendorId\` (\`vendorId\`),
      INDEX \`IDX_vendor_assessments_orgId\` (\`orgId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'ai_bom_items', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`ai_bom_items\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`vendorId\` VARCHAR(36) NULL,
      \`component\` VARCHAR(200) NOT NULL,
      \`kind\` VARCHAR(20) NOT NULL,
      \`provider\` VARCHAR(100) NULL,
      \`version\` VARCHAR(100) NULL,
      \`licence\` VARCHAR(100) NULL,
      \`licenceClass\` VARCHAR(20) NOT NULL,
      \`source\` VARCHAR(20) NOT NULL,
      \`lastChangeAt\` DATETIME NULL,
      \`previousVersion\` VARCHAR(100) NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_ai_bom_items_orgId\` (\`orgId\`),
      INDEX \`IDX_ai_bom_items_modelId\` (\`modelId\`),
      INDEX \`IDX_ai_bom_items_vendorId\` (\`vendorId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'training_courses', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`training_courses\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`title\` VARCHAR(300) NOT NULL,
      \`description\` TEXT NULL,
      \`kind\` VARCHAR(20) NOT NULL,
      \`targetRoles\` TEXT NOT NULL,
      \`validityMonths\` INT NULL,
      \`mandatory\` TINYINT(1) NOT NULL,
      \`topic\` VARCHAR(50) NULL,
      \`documentId\` VARCHAR(36) NULL,
      \`active\` TINYINT(1) NOT NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_training_courses_orgId\` (\`orgId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'training_records', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`training_records\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`courseId\` VARCHAR(36) NOT NULL,
      \`userId\` VARCHAR(36) NOT NULL,
      \`completedAt\` DATETIME NOT NULL,
      \`expiresAt\` DATETIME NULL,
      \`evidenceDocId\` VARCHAR(36) NULL,
      \`evidenceRef\` VARCHAR(500) NULL,
      \`recordedBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_training_records_orgId\` (\`orgId\`),
      INDEX \`IDX_training_records_courseId\` (\`courseId\`),
      INDEX \`IDX_training_records_userId\` (\`userId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'datasets', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`datasets\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(200) NOT NULL,
      \`description\` TEXT NULL,
      \`source\` VARCHAR(500) NULL,
      \`acquisition\` VARCHAR(30) NULL,
      \`lawfulBasis\` VARCHAR(30) NULL,
      \`consentRef\` VARCHAR(255) NULL,
      \`personalData\` TINYINT(1) NOT NULL,
      \`sensitiveData\` TINYINT(1) NOT NULL,
      \`qualityChecks\` MEDIUMTEXT NULL,
      \`provenance\` TEXT NULL,
      \`preparation\` TEXT NULL,
      \`accessControls\` TEXT NULL,
      \`retentionUntil\` DATETIME NULL,
      \`deletionStatus\` VARCHAR(20) NOT NULL,
      \`deletionOrders\` MEDIUMTEXT NULL,
      \`ownerUserId\` VARCHAR(36) NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_datasets_orgId\` (\`orgId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'model_datasets', // governance Phase 2
    createSql: `CREATE TABLE IF NOT EXISTS \`model_datasets\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`datasetId\` VARCHAR(36) NOT NULL,
      \`purpose\` VARCHAR(20) NOT NULL,
      \`linkedBy\` VARCHAR(255) NOT NULL,
      \`linkedAt\` DATETIME NOT NULL,
      INDEX \`IDX_model_datasets_orgId\` (\`orgId\`),
      INDEX \`IDX_model_datasets_modelId\` (\`modelId\`),
      INDEX \`IDX_model_datasets_datasetId\` (\`datasetId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
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
    table: 'grievances', // grievance.entity.ts (Pillar 5 — Societal)
    createSql: `CREATE TABLE IF NOT EXISTS \`grievances\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`tenantId\` VARCHAR(36) NULL,
      \`subject\` VARCHAR(200) NOT NULL,
      \`description\` TEXT NOT NULL,
      \`complainant\` VARCHAR(255) NULL,
      \`channel\` VARCHAR(20) NOT NULL,
      \`category\` VARCHAR(30) NOT NULL,
      \`severity\` VARCHAR(20) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`resolutionNotes\` VARCHAR(2000) NULL,
      \`slaDueAt\` DATETIME NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      \`acknowledgedAt\` DATETIME NULL,
      \`resolvedAt\` DATETIME NULL,
      INDEX \`IDX_grievances_model\` (\`modelId\`),
      INDEX \`IDX_grievances_tenant\` (\`tenantId\`),
      INDEX \`IDX_grievances_status\` (\`status\`),
      INDEX \`IDX_grievances_sla\` (\`slaDueAt\`)
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
    table: 'agent_action_events', // agent-action-event.entity.ts (Pillar 3 — Visibility)
    createSql: `CREATE TABLE IF NOT EXISTS \`agent_action_events\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`tenantId\` VARCHAR(36) NULL,
      \`sessionId\` VARCHAR(64) NULL,
      \`eventType\` VARCHAR(30) NOT NULL,
      \`tool\` VARCHAR(160) NULL,
      \`outcome\` VARCHAR(30) NOT NULL,
      \`flagged\` TINYINT NOT NULL DEFAULT 0,
      \`detail\` TEXT NULL,
      \`actor\` VARCHAR(255) NOT NULL,
      \`occurredAt\` DATETIME NOT NULL,
      INDEX \`IDX_agent_action_events_model\` (\`modelId\`),
      INDEX \`IDX_agent_action_events_tenant\` (\`tenantId\`),
      INDEX \`IDX_agent_action_events_session\` (\`sessionId\`),
      INDEX \`IDX_agent_action_events_flagged\` (\`flagged\`),
      INDEX \`IDX_agent_action_events_time\` (\`occurredAt\`)
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
  {
    table: 'bcp_drills', // bcp-drill.entity.ts (governance E0.4 — RBI Rec 21)
    createSql: `CREATE TABLE IF NOT EXISTS \`bcp_drills\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`conductedAt\` DATETIME NOT NULL,
      \`scenario\` VARCHAR(500) NOT NULL,
      \`result\` VARCHAR(30) NOT NULL,
      \`findings\` TEXT NULL,
      \`conductedBy\` VARCHAR(255) NOT NULL,
      \`recordedAt\` DATETIME NOT NULL,
      INDEX \`IDX_bcp_drills_model\` (\`modelId\`),
      INDEX \`IDX_bcp_drills_conducted\` (\`conductedAt\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'pack_versions', // pack-version.entity.ts (governance E1.1)
    createSql: `CREATE TABLE IF NOT EXISTS \`pack_versions\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`packId\` VARCHAR(60) NOT NULL,
      \`version\` VARCHAR(30) NOT NULL,
      \`effectiveFrom\` DATETIME NOT NULL,
      \`contentHash\` VARCHAR(64) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`loadedAt\` DATETIME NOT NULL,
      UNIQUE INDEX \`IDX_pack_versions_pack_version\` (\`packId\`, \`version\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'governance_settings', // governance-settings.entity.ts (governance E1.2)
    createSql: `CREATE TABLE IF NOT EXISTS \`governance_settings\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`version\` INT NOT NULL,
      \`effectiveFrom\` DATETIME NOT NULL,
      \`settings\` TEXT NOT NULL,
      \`changes\` TEXT NULL,
      \`changedBy\` VARCHAR(255) NOT NULL,
      \`changedByRole\` VARCHAR(30) NOT NULL,
      \`reason\` VARCHAR(1000) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      UNIQUE INDEX \`IDX_governance_settings_org_version\` (\`orgId\`, \`version\`),
      INDEX \`IDX_governance_settings_org\` (\`orgId\`),
      INDEX \`IDX_governance_settings_effective\` (\`effectiveFrom\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'risks', // governance Phase 1
    createSql: `CREATE TABLE IF NOT EXISTS \`risks\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`scopeType\` VARCHAR(20) NOT NULL,
      \`scopeId\` VARCHAR(255) NULL,
      \`category\` VARCHAR(30) NOT NULL,
      \`title\` VARCHAR(300) NOT NULL,
      \`description\` TEXT NULL,
      \`affectedParties\` TEXT NULL,
      \`harmType\` VARCHAR(100) NULL,
      \`source\` VARCHAR(20) NOT NULL,
      \`sourceRef\` VARCHAR(100) NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`ownerUserId\` VARCHAR(36) NULL,
      \`nextReviewAt\` DATETIME NULL,
      \`reviewReason\` VARCHAR(300) NULL,
      \`dismissedReason\` VARCHAR(500) NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_risks_org\` (\`orgId\`),
      INDEX \`IDX_risks_scope\` (\`scopeId\`),
      INDEX \`IDX_risks_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'risk_assessments', // governance Phase 1
    createSql: `CREATE TABLE IF NOT EXISTS \`risk_assessments\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`riskId\` VARCHAR(36) NOT NULL,
      \`version\` INT NOT NULL,
      \`matrix\` VARCHAR(5) NOT NULL,
      \`inherentL\` INT NOT NULL,
      \`inherentI\` INT NOT NULL,
      \`residualL\` INT NOT NULL,
      \`residualI\` INT NOT NULL,
      \`inherentBand\` VARCHAR(20) NOT NULL,
      \`residualBand\` VARCHAR(20) NOT NULL,
      \`rationale\` TEXT NULL,
      \`controlIds\` TEXT NULL,
      \`assessedBy\` VARCHAR(255) NOT NULL,
      \`assessedAt\` DATETIME NOT NULL,
      INDEX \`IDX_risk_assessments_risk\` (\`riskId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'risk_actions', // governance Phase 1
    createSql: `CREATE TABLE IF NOT EXISTS \`risk_actions\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`riskId\` VARCHAR(36) NOT NULL,
      \`treatment\` VARCHAR(20) NOT NULL,
      \`action\` VARCHAR(1000) NOT NULL,
      \`ownerUserId\` VARCHAR(36) NULL,
      \`dueAt\` DATETIME NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`completedAt\` DATETIME NULL,
      INDEX \`IDX_risk_actions_risk\` (\`riskId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'risk_acceptances', // governance Phase 1
    createSql: `CREATE TABLE IF NOT EXISTS \`risk_acceptances\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`riskId\` VARCHAR(36) NOT NULL,
      \`assessmentVersion\` INT NOT NULL,
      \`acceptedBy\` VARCHAR(255) NOT NULL,
      \`role\` VARCHAR(30) NOT NULL,
      \`acceptedAt\` DATETIME NOT NULL,
      \`expiresAt\` DATETIME NULL,
      \`waiverRef\` VARCHAR(200) NULL,
      \`note\` VARCHAR(1000) NULL,
      INDEX \`IDX_risk_acceptances_risk\` (\`riskId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'impact_assessments', // governance Phase 1
    createSql: `CREATE TABLE IF NOT EXISTS \`impact_assessments\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`packIds\` TEXT NOT NULL,
      \`version\` INT NOT NULL,
      \`questionnaire\` MEDIUMTEXT NOT NULL,
      \`contextSnapshot\` MEDIUMTEXT NULL,
      \`riskSnapshot\` MEDIUMTEXT NULL,
      \`status\` VARCHAR(30) NOT NULL,
      \`signedBy\` VARCHAR(255) NULL,
      \`signedByRole\` VARCHAR(30) NULL,
      \`signedAt\` DATETIME NULL,
      \`inScope\` TINYINT(1) NULL,
      \`highImpact\` TINYINT(1) NULL,
      \`materiality\` VARCHAR(20) NULL,
      \`revalidationReason\` VARCHAR(300) NULL,
      \`contentHash\` VARCHAR(64) NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_impact_assessments_org\` (\`orgId\`),
      INDEX \`IDX_impact_assessments_model\` (\`modelId\`),
      INDEX \`IDX_impact_assessments_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'aims_records', // governance Phase 1
    createSql: `CREATE TABLE IF NOT EXISTS \`aims_records\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`type\` VARCHAR(30) NOT NULL,
      \`title\` VARCHAR(300) NOT NULL,
      \`content\` MEDIUMTEXT NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`ownerUserId\` VARCHAR(36) NULL,
      \`approvedBy\` VARCHAR(255) NULL,
      \`approvedAt\` DATETIME NULL,
      \`reviewDueAt\` DATETIME NULL,
      \`documentId\` VARCHAR(36) NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_aims_records_org\` (\`orgId\`),
      INDEX \`IDX_aims_records_type\` (\`type\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'corrective_actions', // governance Phase 1
    createSql: `CREATE TABLE IF NOT EXISTS \`corrective_actions\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`source\` VARCHAR(20) NOT NULL,
      \`sourceId\` VARCHAR(100) NULL,
      \`modelId\` VARCHAR(36) NULL,
      \`nonconformity\` TEXT NOT NULL,
      \`rootCause\` TEXT NULL,
      \`action\` TEXT NOT NULL,
      \`ownerUserId\` VARCHAR(36) NULL,
      \`dueAt\` DATETIME NULL,
      \`status\` VARCHAR(30) NOT NULL,
      \`effectivenessReview\` TEXT NULL,
      \`effective\` TINYINT(1) NULL,
      \`closedAt\` DATETIME NULL,
      \`closedBy\` VARCHAR(255) NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_corrective_actions_org\` (\`orgId\`),
      INDEX \`IDX_corrective_actions_source\` (\`sourceId\`),
      INDEX \`IDX_corrective_actions_model\` (\`modelId\`),
      INDEX \`IDX_corrective_actions_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'documents', // governance Phase 1
    createSql: `CREATE TABLE IF NOT EXISTS \`documents\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`seriesId\` VARCHAR(36) NOT NULL,
      \`docType\` VARCHAR(20) NOT NULL,
      \`title\` VARCHAR(300) NOT NULL,
      \`description\` TEXT NULL,
      \`version\` INT NOT NULL,
      \`hash\` VARCHAR(64) NOT NULL,
      \`uri\` VARCHAR(1000) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`approvedBy\` VARCHAR(255) NULL,
      \`approvedAt\` DATETIME NULL,
      \`reviewDueAt\` DATETIME NULL,
      \`retentionUntil\` DATETIME NULL,
      \`supersedesId\` VARCHAR(36) NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_documents_org\` (\`orgId\`),
      INDEX \`IDX_documents_series\` (\`seriesId\`),
      INDEX \`IDX_documents_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'control_results', // control-result.entity.ts (governance E1.1)
    createSql: `CREATE TABLE IF NOT EXISTS \`control_results\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NULL,
      \`modelId\` VARCHAR(36) NULL,
      \`controlId\` VARCHAR(40) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`evidenceRefs\` TEXT NULL,
      \`clauses\` TEXT NULL,
      \`packVersionSet\` TEXT NOT NULL,
      \`evaluatedBy\` VARCHAR(255) NOT NULL,
      \`evaluatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_control_results_org\` (\`orgId\`),
      INDEX \`IDX_control_results_model\` (\`modelId\`),
      INDEX \`IDX_control_results_evaluated\` (\`evaluatedAt\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'soa_entries', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`soa_entries\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`annexRef\` VARCHAR(20) NOT NULL,
      \`included\` TINYINT(1) NOT NULL,
      \`justification\` TEXT NULL,
      \`manualStatus\` VARCHAR(30) NULL,
      \`manualNote\` TEXT NULL,
      \`updatedBy\` VARCHAR(255) NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_soa_entries_orgId\` (\`orgId\`),
      INDEX \`IDX_soa_entries_annexRef\` (\`annexRef\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'soa_statements', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`soa_statements\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`version\` INT NOT NULL,
      \`content\` MEDIUMTEXT NOT NULL,
      \`contentHash\` VARCHAR(64) NOT NULL,
      \`approvedBy\` VARCHAR(255) NOT NULL,
      \`approvedAt\` DATETIME NOT NULL,
      \`note\` TEXT NULL,
      INDEX \`IDX_soa_statements_orgId\` (\`orgId\`),
      UNIQUE KEY \`UQ_soa_statements_org_version\` (\`orgId\`, \`version\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'disclosures', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`disclosures\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`kind\` VARCHAR(40) NOT NULL,
      \`modelId\` VARCHAR(36) NULL,
      \`version\` INT NOT NULL,
      \`title\` VARCHAR(255) NOT NULL,
      \`periodStart\` DATETIME NULL,
      \`periodEnd\` DATETIME NULL,
      \`content\` MEDIUMTEXT NOT NULL,
      \`contentHash\` VARCHAR(64) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`publishedBy\` VARCHAR(255) NULL,
      \`publishedAt\` DATETIME NULL,
      \`publicUrl\` VARCHAR(500) NULL,
      \`reviewDueAt\` DATETIME NULL,
      \`notifications\` MEDIUMTEXT NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_disclosures_orgId\` (\`orgId\`),
      INDEX \`IDX_disclosures_modelId\` (\`modelId\`),
      UNIQUE KEY \`UQ_disclosures_version\` (\`orgId\`, \`kind\`, \`modelId\`, \`version\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'model_deployers', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`model_deployers\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(200) NOT NULL,
      \`contact\` VARCHAR(255) NULL,
      \`active\` TINYINT(1) NOT NULL,
      \`addedBy\` VARCHAR(255) NOT NULL,
      \`addedAt\` DATETIME NOT NULL,
      INDEX \`IDX_model_deployers_orgId\` (\`orgId\`),
      INDEX \`IDX_model_deployers_modelId\` (\`modelId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'integration_endpoints', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`integration_endpoints\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`kind\` VARCHAR(30) NOT NULL,
      \`label\` VARCHAR(200) NOT NULL,
      \`url\` VARCHAR(1000) NOT NULL,
      \`secretEncrypted\` TEXT NULL,
      \`events\` MEDIUMTEXT NOT NULL,
      \`enabled\` TINYINT(1) NOT NULL,
      \`lastDeliveryAt\` DATETIME NULL,
      \`lastStatus\` VARCHAR(20) NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_integration_endpoints_orgId\` (\`orgId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'integration_deliveries', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`integration_deliveries\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`endpointId\` VARCHAR(36) NOT NULL,
      \`event\` VARCHAR(60) NOT NULL,
      \`refId\` VARCHAR(100) NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`httpStatus\` INT NULL,
      \`error\` VARCHAR(500) NULL,
      \`payloadHash\` VARCHAR(64) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_integration_deliveries_orgId\` (\`orgId\`),
      INDEX \`IDX_integration_deliveries_endpointId\` (\`endpointId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'test_sets', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`test_sets\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`datasetId\` VARCHAR(36) NULL,
      \`name\` VARCHAR(200) NOT NULL,
      \`purpose\` VARCHAR(30) NOT NULL,
      \`description\` TEXT NULL,
      \`criteria\` MEDIUMTEXT NOT NULL,
      \`reviewIntervalMonths\` INT NOT NULL,
      \`lastReviewedAt\` DATETIME NULL,
      \`lastReviewedBy\` VARCHAR(255) NULL,
      \`lastReviewNote\` TEXT NULL,
      \`active\` TINYINT(1) NOT NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_test_sets_orgId\` (\`orgId\`),
      INDEX \`IDX_test_sets_modelId\` (\`modelId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'tevv_runs', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`tevv_runs\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`testSetId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`runAt\` DATETIME NOT NULL,
      \`modelVersion\` VARCHAR(100) NULL,
      \`results\` MEDIUMTEXT NOT NULL,
      \`passed\` TINYINT(1) NOT NULL,
      \`failures\` MEDIUMTEXT NULL,
      \`reportRef\` VARCHAR(500) NULL,
      \`reportDocId\` VARCHAR(36) NULL,
      \`recordedBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_tevv_runs_orgId\` (\`orgId\`),
      INDEX \`IDX_tevv_runs_testSetId\` (\`testSetId\`),
      INDEX \`IDX_tevv_runs_modelId\` (\`modelId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'model_retirements', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`model_retirements\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`reason\` TEXT NOT NULL,
      \`replacementModelId\` VARCHAR(36) NULL,
      \`plannedFor\` DATETIME NULL,
      \`checklist\` MEDIUMTEXT NOT NULL,
      \`requestedBy\` VARCHAR(255) NOT NULL,
      \`requestedAt\` DATETIME NOT NULL,
      \`decidedBy\` VARCHAR(255) NULL,
      \`decidedAt\` DATETIME NULL,
      \`decisionNote\` TEXT NULL,
      \`completedBy\` VARCHAR(255) NULL,
      \`completedAt\` DATETIME NULL,
      INDEX \`IDX_model_retirements_orgId\` (\`orgId\`),
      INDEX \`IDX_model_retirements_modelId\` (\`modelId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'energy_readings', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`energy_readings\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`periodStart\` DATETIME NOT NULL,
      \`periodEnd\` DATETIME NOT NULL,
      \`kwh\` DOUBLE NOT NULL,
      \`gridFactor\` DOUBLE NOT NULL,
      \`co2eKg\` DOUBLE NOT NULL,
      \`source\` VARCHAR(30) NOT NULL,
      \`sampleCount\` INT NOT NULL,
      \`note\` VARCHAR(500) NULL,
      \`recordedBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_energy_readings_orgId\` (\`orgId\`),
      INDEX \`IDX_energy_readings_modelId\` (\`modelId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'threat_models', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`threat_models\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`version\` INT NOT NULL,
      \`templateId\` VARCHAR(60) NOT NULL,
      \`threats\` MEDIUMTEXT NOT NULL,
      \`status\` VARCHAR(20) NOT NULL,
      \`approvedBy\` VARCHAR(255) NULL,
      \`approvedAt\` DATETIME NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      \`updatedAt\` DATETIME NOT NULL,
      INDEX \`IDX_threat_models_orgId\` (\`orgId\`),
      INDEX \`IDX_threat_models_modelId\` (\`modelId\`),
      UNIQUE KEY \`UQ_threat_models_model_version\` (\`modelId\`, \`version\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'security_evaluations', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`security_evaluations\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`modelId\` VARCHAR(36) NOT NULL,
      \`ref\` VARCHAR(500) NOT NULL,
      \`evaluator\` VARCHAR(255) NULL,
      \`categories\` MEDIUMTEXT NOT NULL,
      \`evaluatedAt\` DATETIME NOT NULL,
      \`recordedBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_security_evaluations_orgId\` (\`orgId\`),
      INDEX \`IDX_security_evaluations_modelId\` (\`modelId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'engagement_records', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`engagement_records\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`type\` VARCHAR(30) NOT NULL,
      \`modelId\` VARCHAR(36) NULL,
      \`title\` VARCHAR(200) NOT NULL,
      \`participants\` MEDIUMTEXT NOT NULL,
      \`summary\` TEXT NOT NULL,
      \`outcome\` TEXT NULL,
      \`consentRef\` VARCHAR(255) NULL,
      \`occurredAt\` DATETIME NOT NULL,
      \`createdBy\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME NOT NULL,
      INDEX \`IDX_engagement_records_orgId\` (\`orgId\`),
      INDEX \`IDX_engagement_records_modelId\` (\`modelId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    table: 'ai_provider_attestations', // governance Phase 3
    createSql: `CREATE TABLE IF NOT EXISTS \`ai_provider_attestations\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`orgId\` VARCHAR(36) NOT NULL,
      \`providerId\` VARCHAR(36) NOT NULL,
      \`noTraining\` TINYINT(1) NOT NULL,
      \`retentionDays\` INT NULL,
      \`reference\` VARCHAR(500) NOT NULL,
      \`endpoint\` VARCHAR(500) NOT NULL,
      \`documentId\` VARCHAR(36) NULL,
      \`attestedBy\` VARCHAR(255) NOT NULL,
      \`attestedAt\` DATETIME NOT NULL,
      \`expiresAt\` DATETIME NULL,
      \`revokedAt\` DATETIME NULL,
      INDEX \`IDX_ai_provider_attestations_orgId\` (\`orgId\`),
      INDEX \`IDX_ai_provider_attestations_providerId\` (\`providerId\`)
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
      for (const spec of REQUIRED_INDEXES) {
        try {
          const rows = await runner.query(
            `SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
            [spec.table, spec.column],
          );
          if (Number(rows?.[0]?.c ?? 0) > 0) continue;
          await runner.query(`CREATE INDEX \`${spec.name}\` ON \`${spec.table}\` (\`${spec.column}\`)`);
          this.logger.log(`Schema guard: added index ${spec.name}`);
        } catch (e) {
          this.logger.warn(`Schema guard: could not ensure index ${spec.name}: ${String(e)}`);
        }
      }
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
