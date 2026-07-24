#!/usr/bin/env node
/**
 * Seed (or reset) the "Meridian Finance" demo tenant — the ET-award golden-path
 * environment. Idempotent: safe to run repeatedly; existing objects are found
 * by name and reused, so a re-run tops up whatever a demo session consumed.
 *
 * Usage:
 *   SENTRAI_URL=https://sentraiconsole.com \
 *   SENTRAI_ADMIN_EMAIL=admin@… SENTRAI_ADMIN_PASSWORD=… \
 *   [MERIDIAN_CISO_PASSWORD=…] \
 *   [MERIDIAN_LLM_URL=http://localhost:11434/v1 MERIDIAN_LLM_MODEL=llama3.1 MERIDIAN_LLM_KEY=ollama] \
 *   node scripts/seed-demo.mjs
 *
 * SEED_CONTEXT_ONLY=1 stages only the tenant (org + CISO + empty project) and
 * then stops BEFORE discovery — leaving the codebase to be imported LIVE in the
 * console (GitHub import) in front of a judge. Run the script again afterwards
 * WITHOUT the flag to layer governance + drift + incidents onto the models the
 * live import created (it auto-skips discovery once models exist).
 *
 * Requires the `zip` CLI (used to package scripts/demo/repo for upload).
 */
import { execSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.SENTRAI_URL ?? 'http://localhost:8002').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.SENTRAI_ADMIN_EMAIL ?? 'admin@sentrai.local';
const ADMIN_PASSWORD = process.env.SENTRAI_ADMIN_PASSWORD ?? 'admin123';
const CISO_EMAIL = 'priya.ciso@meridianfinance.demo';
const CISO_PASSWORD = process.env.MERIDIAN_CISO_PASSWORD ?? 'Meridian!Demo2026';
const ORG_NAME = 'Meridian Finance';
const PROJECT_NAME = 'Retail Lending Platform';

const here = dirname(fileURLToPath(import.meta.url));
const log = (msg) => console.log(`  ${msg}`);
const step = (msg) => console.log(`\n▸ ${msg}`);

async function api(path, { method = 'GET', token, body, raw } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      ...(raw ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

const login = async (username, password) =>
  (await api('/auth/token', { method: 'POST', body: { username, password } })).access_token;

async function main() {
  console.log(`Seeding Meridian Finance demo tenant on ${BASE}`);

  step('Admin sign-in');
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  step(`Organization "${ORG_NAME}"`);
  const orgs = await api('/organizations/', { token: admin });
  let org = orgs.find((o) => o.name === ORG_NAME);
  if (!org) {
    org = await api('/organizations/', { method: 'POST', token: admin, body: { name: ORG_NAME, description: 'Mid-size NBFC — retail lending (demo tenant)' } });
    log('created');
  } else log('exists');
  const orgId = org.organization_id ?? org.id;

  step(`CISO ${CISO_EMAIL}`);
  const users = await api('/users', { token: admin });
  if (!users.find((u) => u.email === CISO_EMAIL)) {
    await api('/users', { method: 'POST', token: admin, body: {
      email: CISO_EMAIL, full_name: 'Priya Nair', password: CISO_PASSWORD, role: 'CISO', organization_id: orgId,
    } });
    log('created');
  } else log('exists');
  const ciso = await login(CISO_EMAIL, CISO_PASSWORD);

  step(`Project "${PROJECT_NAME}"`);
  const projects = await api('/projects', { token: ciso });
  let project = projects.find((p) => p.name === PROJECT_NAME);
  if (!project) {
    project = await api('/projects', { method: 'POST', token: ciso, body: { name: PROJECT_NAME, description: 'Credit, KYC, collections, fraud and support services' } });
    log('created');
  } else log('exists');
  const projectId = project.project_id;

  if (process.env.SEED_CONTEXT_ONLY === '1' || process.env.SEED_CONTEXT_ONLY === 'true') {
    console.log(`\n✔ Tenant staged on ${BASE} — no discovery (ready for a LIVE GitHub import).`);
    console.log(`  Sign in:   ${CISO_EMAIL} / ${CISO_PASSWORD}`);
    console.log(`  Live beat: open "${PROJECT_NAME}" → Codebase → GitHub import → Scan → Import → set owner + policy.`);
    console.log(`  Then run this script again WITHOUT SEED_CONTEXT_ONLY to layer drift + incidents onto the imported models.`);
    return;
  }

  step('Codebase upload + scan + import');
  let models = await api(`/inventory/models?project_id=${projectId}`, { token: ciso });
  if (models.length === 0) {
    const tmp = mkdtempSync(join(tmpdir(), 'meridian-'));
    const zipPath = join(tmp, 'repo.zip');
    execSync(`cd ${JSON.stringify(join(here, 'demo', 'repo'))} && zip -qr ${JSON.stringify(zipPath)} .`);
    const form = new FormData();
    form.append('file', new Blob([readFileSync(zipPath)]), 'meridian.zip');
    await api(`/projects/${projectId}/codebase`, { method: 'POST', token: ciso, raw: form });
    log('codebase uploaded');

    const scan = await api('/discovery/scan', { method: 'POST', token: ciso, body: { project_id: projectId } });
    log(`scanned: ${scan.candidates.length} candidates (ast ${scan.ast_coverage})`);
    const imported = await api('/discovery/import', { method: 'POST', token: ciso, body: {
      project_id: projectId, file_paths: scan.candidates.map((c) => c.file_path),
    } });
    const merged = imported.filter((m) => m.merged).length;
    log(`imported: ${imported.length} results — ${imported.length - merged} created, ${merged} merged`);
    models = await api(`/inventory/models?project_id=${projectId}`, { token: ciso });
  } else log(`exists (${models.length} models) — skipping scan`);

  // The scanner discovers and types the agent (copilot_agent.py) and the MCP
  // server (statement_mcp_server.py) on its own — trust discovery, and only
  // register by hand if a scan somehow missed them.
  step('Agent + MCP server (discovered by scan)');
  const ensureKind = async (pattern, name, body) => {
    if (models.some((m) => pattern.test(m.name))) return log(`${name}: discovered by scanner`);
    await api('/inventory/models', { method: 'POST', token: ciso, body: { ...body, name, project_id: projectId } });
    log(`${name}: registered (scanner missed it)`);
  };
  await ensureKind(/copilot|agent/i, 'Support Copilot Agent', {
    model_type: 'AGENT', functional_area: 'customer_support',
    use_case_description: 'Tool-calling agent that drafts responses to customer-service tickets from the knowledge base, with hardship-escalation guardrails and a four-step autonomy cap.',
    human_oversight_required: true, board_policy_ref: 'MF-AI-POL-2026-02',
  });
  await ensureKind(/mcp/i, 'Statement MCP Server', {
    model_type: 'MCP_SERVER', functional_area: 'customer_support',
    use_case_description: 'Read-only MCP server exposing masked account-statement retrieval tools to the support copilot.',
    human_oversight_required: true, board_policy_ref: 'MF-AI-POL-2026-02',
  });
  models = await api(`/inventory/models?project_id=${projectId}`, { token: ciso });

  // Governance: complete three models so the matrix tells a mixed story —
  // green rows prove the workflow, red rows leave gaps to close on stage.
  step('Governance (partial by design)');
  const SUTRAS = ['TRUST_IS_THE_FOUNDATION', 'PEOPLE_FIRST', 'INNOVATION_OVER_RESTRAINT', 'FAIRNESS_AND_EQUITY', 'ACCOUNTABILITY', 'UNDERSTANDABLE_BY_DESIGN', 'SAFETY_RESILIENCE_SUSTAINABILITY'];
  const govern = async (name, extra = {}) => {
    const m = models.find((x) => x.name === name);
    if (!m) return log(`${name}: not found, skipped`);
    if (m.owner_team && m.owner_team !== 'UNASSIGNED — pending review') return log(`${name}: already governed`);
    await api(`/inventory/models/${m.model_id}/governance`, { method: 'PATCH', token: ciso, body: {
      owner_team: 'Model Risk Committee', board_policy_ref: 'MF-AI-POL-2026-01',
      human_oversight_required: true, sutras_alignment: SUTRAS,
      last_red_team_date: new Date(Date.now() - 42 * 864e5).toISOString().slice(0, 10),
      actor: CISO_EMAIL, ...extra,
    } });
    log(`${name}: governed`);
  };
  await govern('Retail Credit Scorer');
  await govern('Kyc Doc Classifier');
  await govern('Copilot Agent');

  // Drift story: reference vs shifted live window on Collections Propensity,
  // pre-staged so one click on "Evaluate now" trips the breaker on stage.
  step('Drift windows (breaker armed, not tripped)');
  const coll = models.find((m) => m.name.toLowerCase().includes('collections'));
  if (coll) {
    const hist = await api(`/monitoring/drift/${coll.model_id}/history`, { token: ciso });
    if (hist.length === 0) {
      const ref = Array.from({ length: 400 }, (_, i) => 0.25 + (i % 25) * 0.004);
      const live = Array.from({ length: 400 }, (_, i) => 0.58 + (i % 25) * 0.005);
      await api(`/monitoring/scores/${coll.model_id}`, { method: 'POST', token: ciso, body: { kind: 'reference', scores: ref, accuracy: 0.91 } });
      await api(`/monitoring/scores/${coll.model_id}`, { method: 'POST', token: ciso, body: { kind: 'live', scores: live, accuracy: 0.82 } });
      log('windows staged — "Evaluate now" will trip the breaker live');
    } else log('drift history exists');
  }

  step('Incidents (one live clock, one resolved)');
  const incidents = await api('/compliance/incident', { token: ciso });
  const kyc = models.find((m) => m.name === 'Kyc Doc Classifier') ?? models[0];
  if (!incidents.some((i) => i.category === 'EXPLAINABILITY_FAILURE')) {
    await api('/compliance/incident/report', { method: 'POST', token: ciso, body: {
      model_id: kyc.model_id, model_name: kyc.name, re_name: 'Meridian Finance Ltd',
      functional_area: 'onboarding', incident_category: 'EXPLAINABILITY_FAILURE', severity: 'P2_HIGH',
      description: 'Three onboarding applicants were rejected by the KYC document classifier with no reason code surfaced to the agent desktop, leaving support unable to explain the decision to the customers.',
      immediate_action_taken: 'Affected applications rerouted to the manual verification queue; reason-code propagation fix scheduled with the platform team.',
      observed_at: new Date(Date.now() - 3 * 36e5).toISOString(), detected_at: new Date(Date.now() - 2 * 36e5).toISOString(),
      model_risk_level: kyc.risk_level, system_suspended: false, fallback_activated: true,
    } });
    log('open P2 reported — 24h regulatory clock running');
  } else log('open incident exists');
  if (!incidents.some((i) => i.category === 'MODEL_DRIFT')) {
    const rep = await api('/compliance/incident/report', { method: 'POST', token: ciso, body: {
      model_id: coll?.model_id ?? kyc.model_id, model_name: coll?.name ?? kyc.name, re_name: 'Meridian Finance Ltd',
      functional_area: 'collections', incident_category: 'MODEL_DRIFT', severity: 'P4_LOW',
      description: 'Routine drift review flagged a mild population-stability shift on the collections propensity model after a festive-season spending pattern change; no customer impact identified in sampling.',
      immediate_action_taken: 'Model retrained on the extended window and revalidated by the model risk committee.',
      observed_at: new Date(Date.now() - 6 * 864e5).toISOString(), detected_at: new Date(Date.now() - 6 * 864e5).toISOString(),
      model_risk_level: coll?.risk_level ?? 'LOW', fallback_activated: false,
    } });
    await api(`/compliance/incident/${rep.incident_id}/status`, { method: 'PATCH', token: ciso, body: { status: 'RESOLVED', notes: 'Retrained and revalidated.' } });
    log('resolved P4 seeded');
  } else log('resolved incident exists');

  // Optional: a real LLM so drafts carry "AI-drafted via …" provenance.
  if (process.env.MERIDIAN_LLM_URL) {
    step('LLM provider');
    const providers = await api('/ai/providers', { token: ciso });
    if (!providers.find((p) => p.label === 'Meridian Governance LLM')) {
      await api('/ai/providers', { method: 'POST', token: ciso, body: {
        label: 'Meridian Governance LLM', adapter: 'openai-compat',
        base_url: process.env.MERIDIAN_LLM_URL, model: process.env.MERIDIAN_LLM_MODEL ?? 'llama3.1',
        api_key: process.env.MERIDIAN_LLM_KEY ?? 'local',
      } });
      log('configured');
    } else log('exists');
    const regen = await api('/inventory/generate', { method: 'POST', token: ciso, body: { model_ids: models.slice(0, 4).map((m) => m.model_id), force: true } });
    log(`regenerating drafts with AI provenance (${regen.queued} queued)`);
  } else {
    step('LLM provider — skipped (set MERIDIAN_LLM_URL to enable AI-drafted provenance)');
  }

  console.log(`\n✔ Meridian Finance ready on ${BASE}`);
  console.log(`  Sign in: ${CISO_EMAIL} / ${CISO_PASSWORD}`);
  console.log(`  Golden path: Projects → "${PROJECT_NAME}" → Inventory → Edit Entry → CI Gate → Monitoring (Evaluate now) → Incidents → Rollup`);
}

main().catch((e) => { console.error(`\n✖ ${e.message}`); process.exit(1); });
