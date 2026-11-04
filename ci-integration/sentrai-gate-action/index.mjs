#!/usr/bin/env node
/**
 * SentRAI Pre-Deployment Gate — packaged GitHub Action entrypoint.
 *
 * Self-contained (no dependencies): bundles the checked-out source, POSTs it to
 * the stateless /api/v1/ci/scan endpoint, writes a SARIF report, surfaces GitHub
 * annotations + a job summary, sets step outputs, and exits non-zero on a `fail`
 * verdict so a non-compliant / shadow-AI model blocks the deploy.
 *
 * Used via:  uses: <owner>/SentRAI-Console/ci-integration/sentrai-gate-action@v1
 */
import { readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const SCAN_EXT = new Set([
  '.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.java', '.rb', '.ipynb',
  '.yaml', '.yml', '.json', '.txt', '.md',
]);
const SKIP_DIR = new Set([
  'node_modules', '.git', '.github', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'vendor', 'coverage', '.turbo', '.cache',
]);
const MAX_FILE_BYTES = 512 * 1024;

// ── GitHub Actions I/O helpers (no @actions/core dependency) ──────────────────
const input = (name) => (process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || '').trim();
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}
const fail = (msg) => console.log(`::error title=SentRAI Gate::${msg}`);

function collectFiles(root, maxTotalBytes) {
  const out = [];
  let total = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) { if (!SKIP_DIR.has(name)) walk(abs); continue; }
      const rel = relative(root, abs).split('\\').join('/');
      const keep = SCAN_EXT.has(extname(name).toLowerCase()) || rel === '.sentrai/policy.yaml';
      if (!keep || st.size > MAX_FILE_BYTES) continue;
      total += st.size;
      if (total > maxTotalBytes) throw new Error(`Code snapshot exceeds ${(maxTotalBytes / 1048576).toFixed(0)} MB; narrow the scan or raise max-mb.`);
      out.push({ path: rel, content: readFileSync(abs, 'utf-8') });
    }
  };
  walk(root);
  return out;
}

async function main() {
  const base = (input('sentrai-url') || process.env.SENTRAI_URL || '').replace(/\/$/, '');
  const token = input('ci-token') || process.env.SENTRAI_CI_TOKEN;
  const failOn = input('fail-on') || 'fail';
  const sarifOut = input('sarif-file') || 'sentrai-results.sarif';
  const maxBytes = (parseInt(input('max-mb') || '20', 10)) * 1024 * 1024;

  if (!base || !token) {
    fail('Missing required inputs: sentrai-url and ci-token.');
    process.exit(1);
  }

  // Commit / PR context (PR head sha + number come from the event payload).
  let prNumber = null, headSha = null, defaultBranchPush = false;
  try {
    const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf-8'));
    prNumber = ev.pull_request?.number ?? null;
    headSha = ev.pull_request?.head?.sha ?? null;
    defaultBranchPush = process.env.GITHUB_EVENT_NAME === 'push' && ev.ref === `refs/heads/${ev.repository?.default_branch}`;
  } catch { /* not a PR event */ }
  const commitSha = headSha || process.env.GITHUB_SHA || 'ci';

  console.log('🚀 SentRAI pre-deployment compliance gate…');
  const files = collectFiles(process.cwd(), maxBytes);
  console.log(`   bundled ${files.length} source files (commit ${commitSha.slice(0, 8)})`);

  let res;
  try {
    res = await fetch(`${base}/api/v1/ci/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ commit_sha: commitSha, pr_number: prNumber ? String(prNumber) : null, pipeline_run_id: process.env.GITHUB_RUN_ID || null, default_branch_push: defaultBranchPush, files }),
    });
  } catch (e) {
    fail(`Could not reach SentRAI (${String(e)}). Failing closed.`);
    process.exit(1);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail(`SentRAI API error (HTTP ${res.status}${body?.message ? `: ${JSON.stringify(body.message)}` : ''}). Failing closed.`);
    process.exit(1);
  }

  if (body.sarif) writeFileSync(sarifOut, JSON.stringify(body.sarif, null, 2));

  const s = body.summary || {};
  const violations = body.blocking_violations || [];
  setOutput('verdict', body.verdict);
  setOutput('gate-event-id', body.gate_event_id || '');
  setOutput('blocking-violations', String(violations.length));
  setOutput('sarif-file', sarifOut);

  console.log(`   models detected: ${s.models_detected ?? '?'} | shadow: ${s.shadow_assets ?? 0} | AST: ${body.ast_coverage} | policy: ${body.policy_source}`);

  if (body.verdict === 'fail') {
    for (const v of violations) {
      console.log(`::error file=${v.file_location},title=Ungoverned ${v.severity} model::${v.model_name} — ${v.reason}`);
    }
    summary(`### 🚨 SentRAI gate: FAILED\n\n**${violations.length}** blocking violation(s) — commit \`${commitSha.slice(0, 8)}\`, gate event \`${body.gate_event_id}\`.\n\n` +
      violations.map((v) => `- **[${v.severity}]** \`${v.file_location}\` — ${v.model_name}${v.shadow ? ' _(shadow AI)_' : ''}: ${v.reason}`).join('\n'));
    console.log('🚨 COMPLIANCE GATE FAILED — build blocked.');
    process.exit(failOn === 'never' ? 0 : 1);
  }

  summary(`### ✅ SentRAI gate: PASSED\n\nNo blocking violations — commit \`${commitSha.slice(0, 8)}\`, gate event \`${body.gate_event_id}\`.`);
  console.log(`✅ COMPLIANCE GATE PASSED — cleared for deployment. (gate event: ${body.gate_event_id})`);
  process.exit(0);
}

main().catch((e) => { fail(String(e)); process.exit(1); });
