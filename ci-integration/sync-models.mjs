#!/usr/bin/env node
/**
 * sync-models.mjs — sync AI models from your app's database into SentRAI's
 * inventory via the API. Idempotent: models already registered (by name in the
 * target project) are skipped, so it's safe to run repeatedly / on a schedule.
 *
 * Zero dependencies (Node 18+ built-in fetch + fs).
 *
 * Auth (the inventory API needs an interactive login, NOT the CI scan token):
 *   SENTRAI_URL          Base URL, e.g. https://sentraiconsole.com
 *   SENTRAI_PROJECT_ID   Target project id (Projects tab → the project)
 *   SENTRAI_TOKEN        An ADMIN/OWNER JWT …  (OR set the two below to auto-login)
 *   SENTRAI_EMAIL        …  your login email
 *   SENTRAI_PASSWORD     …  your login password
 *   MODELS_FILE          Path to a JSON array of models (default: models.json)
 *
 * Quick start:
 *   1) Export your DB's model table to models.json (see "Feeding it from your DB"
 *      below), each row like:
 *        { "name": "Fraud Scorer v3", "model_type": "MACHINE_LEARNING",
 *          "functional_area": "fraud_detection",
 *          "use_case_description": "Card-fraud scoring model",
 *          "owner_team": "Risk", "board_policy_ref": "AI-POL-2026-01" }
 *   2) Run:
 *        SENTRAI_URL=https://sentraiconsole.com \
 *        SENTRAI_PROJECT_ID=9b044794-... \
 *        SENTRAI_EMAIL=you@org SENTRAI_PASSWORD=secret \
 *        node sync-models.mjs
 */
import { readFileSync } from 'node:fs';

const VALID_TYPES = new Set([
  'MACHINE_LEARNING', 'DEEP_LEARNING', 'NLP', 'GENERATIVE_AI',
  'RULES_BASED', 'HYBRID', 'AGENT', 'TOOL', 'MCP_SERVER',
]);

const BASE = (process.env.SENTRAI_URL || '').replace(/\/$/, '');
const PROJECT_ID = process.env.SENTRAI_PROJECT_ID;

// ── 1) Where your models come from ────────────────────────────────────────────
// Default: read a JSON file you export from your database. To pull straight from
// your DB, replace the body of loadSourceModels() — see "Feeding it from your DB".
function loadSourceModels() {
  const file = process.env.MODELS_FILE || 'models.json';
  const rows = JSON.parse(readFileSync(file, 'utf-8'));
  if (!Array.isArray(rows)) throw new Error(`${file} must contain a JSON array of models.`);
  return rows.map(normalize).filter((m) => m.name);
}

// Map a source row → SentRAI's model fields (tolerant of common column names).
function normalize(m) {
  const rawType = String(m.model_type || m.type || 'MACHINE_LEARNING').toUpperCase().replace(/[\s-]/g, '_');
  return {
    name: String(m.name || m.model_name || '').trim(),
    model_type: VALID_TYPES.has(rawType) ? rawType : 'MACHINE_LEARNING',
    functional_area: String(m.functional_area || m.area || m.domain || 'unspecified'),
    use_case_description: String(m.use_case_description || m.description || `Imported from application database: ${m.name || m.model_name}`),
    developed_by: String(m.developed_by || m.provider || 'internal'),
    ...(m.owner_team ? { owner_team: String(m.owner_team) } : {}),
    ...(m.board_policy_ref ? { board_policy_ref: String(m.board_policy_ref) } : {}),
  };
}

// ── 2) SentRAI API ────────────────────────────────────────────────────────────
async function getToken() {
  if (process.env.SENTRAI_TOKEN) return process.env.SENTRAI_TOKEN;
  const r = await fetch(`${BASE}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.SENTRAI_EMAIL, password: process.env.SENTRAI_PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed (HTTP ${r.status}) — set SENTRAI_TOKEN or SENTRAI_EMAIL/SENTRAI_PASSWORD.`);
  return (await r.json()).access_token;
}

async function existingNames(token) {
  const r = await fetch(`${BASE}/api/v1/inventory/models?project_id=${encodeURIComponent(PROJECT_ID)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return new Set();
  const models = await r.json();
  return new Set((Array.isArray(models) ? models : [])
    .filter((m) => !m.project_id || m.project_id === PROJECT_ID)
    .map((m) => String(m.name).toLowerCase()));
}

async function main() {
  if (!BASE || !PROJECT_ID) throw new Error('Set SENTRAI_URL and SENTRAI_PROJECT_ID.');
  const source = loadSourceModels();
  const token = await getToken();
  const already = await existingNames(token);
  console.log(`SentRAI sync — ${source.length} source model(s); ${already.size} already registered in this project.`);

  let created = 0, skipped = 0, failed = 0;
  for (const m of source) {
    if (already.has(m.name.toLowerCase())) { skipped++; console.log(`  = ${m.name} (already registered)`); continue; }
    const r = await fetch(`${BASE}/api/v1/inventory/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...m, project_id: PROJECT_ID }),
    });
    if (r.ok) { created++; console.log(`  + ${m.name} [${m.model_type}]`); }
    else {
      failed++;
      const b = await r.json().catch(() => ({}));
      console.error(`  ✗ ${m.name} — HTTP ${r.status} ${JSON.stringify(b.message || b.error || b)}`);
    }
  }
  console.log(`\nDone — created ${created}, skipped ${skipped}, failed ${failed}.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(`❌ ${String(e)}`); process.exit(1); });

/*
 ── Feeding it from your DB (replace loadSourceModels above) ───────────────────

 Prisma (Dhancept-style):
   import { PrismaClient } from '@prisma/client';
   async function loadSourceModels() {
     const prisma = new PrismaClient();
     const rows = await prisma.aiModel.findMany();   // ← your model table
     await prisma.$disconnect();
     return rows.map(normalize);
   }

 MySQL/MariaDB (mysql2):
   import mysql from 'mysql2/promise';
   async function loadSourceModels() {
     const c = await mysql.createConnection(process.env.APP_DATABASE_URL);
     const [rows] = await c.query('SELECT name, model_type, functional_area, description FROM ai_models');
     await c.end();
     return rows.map(normalize);
   }

 Postgres (pg):
   import pg from 'pg';
   async function loadSourceModels() {
     const c = new pg.Client(process.env.APP_DATABASE_URL); await c.connect();
     const { rows } = await c.query('SELECT name, model_type, functional_area, description FROM ai_models');
     await c.end();
     return rows.map(normalize);
   }
*/
