#!/usr/bin/env node
/**
 * Sentrai-Console pre-deployment gate runner (read-only).
 *
 * Bundles the repository's source files, POSTs them to the stateless
 * /api/v1/ci/scan endpoint, writes a SARIF report, and exits non-zero when the
 * gate verdict is `fail` — so a non-compliant / shadow-AI model blocks the
 * build before it reaches production.
 *
 * Env:
 *   SENTRAI_URL        Base URL of the Sentrai-Console API (e.g. https://sentraiconsole.com)
 *   SENTRAI_CI_TOKEN   Project-scoped CI service token (a pipeline secret)
 *   GITHUB_SHA / GITHUB_RUN_ID / PR_NUMBER   (optional) commit context
 *   SENTRAI_SARIF_OUT  (optional) SARIF output path (default: sentrai-results.sarif)
 *   SENTRAI_MAX_MB     (optional) max total payload size in MB (default: 20)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
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

/** True on a push to the repository's default branch, i.e. the code has landed. */
function isDefaultBranchPush() {
  if (process.env.GITHUB_EVENT_NAME !== 'push') return false;
  try {
    const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf-8'));
    return ev.ref === `refs/heads/${ev.repository?.default_branch}`;
  } catch {
    return false;
  }
}

function collectFiles(root, maxTotalBytes) {
  const out = [];
  let total = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) {
        if (!SKIP_DIR.has(name)) walk(abs);
        continue;
      }
      const rel = relative(root, abs).split('\\').join('/');
      const keep = SCAN_EXT.has(extname(name).toLowerCase()) || rel === '.sentrai/policy.yaml';
      if (!keep || st.size > MAX_FILE_BYTES) continue;
      total += st.size;
      if (total > maxTotalBytes) throw new Error(`Repository snapshot exceeds ${maxTotalBytes} bytes; narrow the scan or raise SENTRAI_MAX_MB.`);
      out.push({ path: rel, content: readFileSync(abs, 'utf-8') });
    }
  };
  walk(root);
  return out;
}

async function main() {
  const base = (process.env.SENTRAI_URL || '').replace(/\/$/, '');
  const token = process.env.SENTRAI_CI_TOKEN;
  if (!base || !token) {
    console.error('❌ SENTRAI_URL and SENTRAI_CI_TOKEN are required.');
    process.exit(1);
  }
  const sarifOut = process.env.SENTRAI_SARIF_OUT || 'sentrai-results.sarif';
  const maxBytes = (parseInt(process.env.SENTRAI_MAX_MB || '20', 10)) * 1024 * 1024;

  console.log('🚀 Sentrai-Console pre-deployment compliance audit…');
  const files = collectFiles(process.cwd(), maxBytes);
  console.log(`   bundled ${files.length} source files`);

  const payload = {
    commit_sha: process.env.GITHUB_SHA || 'local',
    pr_number: process.env.PR_NUMBER || null,
    pipeline_run_id: process.env.GITHUB_RUN_ID || null,
    default_branch_push: isDefaultBranchPush(),
    files,
  };

  let res;
  try {
    res = await fetch(`${base}/api/v1/ci/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error(`❌ Could not reach Sentrai-Console (${String(e)}). Failing closed.`);
    process.exit(1);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`❌ Sentrai API error (HTTP ${res.status}). Failing closed.`);
    if (body?.message) console.error(`   ${JSON.stringify(body.message)}`);
    process.exit(1);
  }

  if (body.sarif) writeFileSync(sarifOut, JSON.stringify(body.sarif, null, 2));

  const s = body.summary || {};
  console.log(`   models detected: ${s.models_detected ?? '?'} | ast coverage: ${body.ast_coverage} | policy: ${body.policy_source}`);

  if (body.verdict === 'fail') {
    console.error('🚨 COMPLIANCE GATE FAILED — build blocked.');
    for (const v of body.blocking_violations || []) {
      console.error(`   • [${v.severity}] ${v.model_name} (${v.file_location})${v.shadow ? ' [SHADOW]' : ''}`);
      console.error(`     ${v.reason}`);
    }
    console.error(`   gate event: ${body.gate_event_id}  (SARIF → ${sarifOut})`);
    process.exit(1);
  }

  console.log(`✅ COMPLIANCE GATE PASSED — cleared for deployment. (gate event: ${body.gate_event_id})`);
  process.exit(0);
}

main().catch((e) => { console.error(`❌ ${String(e)}`); process.exit(1); });
