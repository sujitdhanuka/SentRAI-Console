-- Model card v2: rollback of the schema changes (Checkpoint 1, decision 4).
--
-- The schema guard only ADDS tables and columns; it never alters or drops
-- existing data. This script removes what model card v2 added. It is for a
-- person to run deliberately, after a backup. Nothing in the application
-- runs it.
--
-- What it removes: every v2 card, field value, control assessment, approval,
-- frozen v2 version, record link and framework registry revision. v1 data
-- (ai_models, model_cards, risks, ledger) is not touched; the ledger keeps the
-- CARD_* events as history.
--
-- MariaDB syntax. Back up first:
--   mysqldump --single-transaction <db> > before-model-card-v2-rollback.sql

-- 1. New tables (drop in any order: there are no foreign keys between them).
DROP TABLE IF EXISTS `card_approvals`;
DROP TABLE IF EXISTS `card_versions`;
DROP TABLE IF EXISTS `card_control_assessments`;
DROP TABLE IF EXISTS `card_field_values`;
DROP TABLE IF EXISTS `card_records`;
DROP TABLE IF EXISTS `ai_record_links`;
DROP TABLE IF EXISTS `framework_controls`;
DROP TABLE IF EXISTS `framework_registry`;

-- 2. New columns on existing tables. Both are nullable or defaulted, so the
--    previous release ignores them; dropping them is optional.
ALTER TABLE `ai_models` DROP COLUMN `recordType`;
ALTER TABLE `users` DROP COLUMN `accountType`;

-- 3. Governance settings: the optional `modelCardV2` key inside the settings
--    JSON is ignored by the previous release. Settings are versioned rows, so
--    nothing needs to change; leave it in place to keep the history.

-- Run this only with the previous release deployed: the schema guard of a
-- release that contains model card v2 recreates the tables (empty) at boot.
-- To switch v2 off without removing anything, set GOV_E4_2_MODEL_CARD_V2=false.
