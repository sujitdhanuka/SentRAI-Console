import { Copy, KeyRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { useConsoleUi } from '../../stores/consoleUi';
import { Button } from '../ui/Button';

interface Project {
  project_id: string;
  name: string;
}

/**
 * Mints a project-scoped CI service token and shows a ready-to-paste pipeline
 * snippet. The token is displayed EXACTLY once — the backend never returns it
 * again — so the copy affordance is deliberately prominent.
 */
export function CiSetupModal({
  open,
  onClose,
  canMint,
  defaultProjectId,
}: {
  open: boolean;
  onClose: () => void;
  /** Minting is Admin/CISO/Owner only on the backend; everyone else gets the guide without the button. */
  canMint: boolean;
  defaultProjectId?: string | null;
}) {
  const toast = useConsoleUi((s) => s.toast);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setToken(null);
    setLoadError(null);
    api<Project[]>('/projects')
      .then((p) => {
        setProjects(p);
        setProjectId((cur) => {
          if (cur && p.some((x) => x.project_id === cur)) return cur;
          if (defaultProjectId && p.some((x) => x.project_id === defaultProjectId)) return defaultProjectId;
          return p[0]?.project_id || '';
        });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load projects'));
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, defaultProjectId]);

  if (!open) return null;

  const mint = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api<{ token: string }>('/ci/tokens', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          label: `${projects.find((p) => p.project_id === projectId)?.name ?? 'Console'} CI`.slice(0, 120),
        }),
      });
      setToken(res.token);
      toast('CI token minted — copy it now, it is not shown again', 'positive');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not mint token', 'negative');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      toast('Copy failed — select and copy manually', 'negative');
    }
  };

  const snippet = `- name: SentRAI Pre-Deployment Gate
  env:
    SENTRAI_URL: \${{ vars.SENTRAI_URL }}
    SENTRAI_CI_TOKEN: \${{ secrets.SENTRAI_CI_TOKEN }}
    GITHUB_SHA: \${{ github.event.pull_request.head.sha || github.sha }}
    PR_NUMBER: \${{ github.event.pull_request.number }}
  run: |
    curl -sSfL "$SENTRAI_URL/api/v1/ci/gate.mjs" -o sentrai-gate.mjs
    node sentrai-gate.mjs`;

  // A ready-to-run scan against this host, so a freshly minted token can be
  // proven end to end before any pipeline is touched (ported from /console).
  const origin = window.location.origin;
  const projectName = projects.find((p) => p.project_id === projectId)?.name ?? '';
  const testSnippet = token
    ? [
        `curl -s -X POST ${origin}/api/v1/ci/scan \\`,
        `  -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \\`,
        `  -d '{`,
        `    "commit_sha": "manual-test-001",`,
        `    "files": [`,
        `      { "path": ".sentrai/policy.yaml", "content": "gates:\\n  block_on:\\n    - severity: HIGH\\n      missing: [registered, owner_team, board_policy_ref]\\n  frameworks: [eu_ai_act]\\n" },`,
        `      { "path": "app/model.py", "content": "import openai\\n\\ndef score(x):\\n    return openai.chat.completions.create(model=\\"gpt-4\\", messages=[])\\n" }`,
        `    ]`,
        `  }'`,
      ].join('\n')
    : '';

  // Everything needed to wire the gate into a GitHub repo from a terminal:
  // the self-contained workflow (ci-integration/github-workflow-selfcontained.yml),
  // the repo variable + secret via the gh CLI, and a branch + PR to land it.
  const gitSetup = [
    '# Run from the root of the app repo you want to gate (needs git + the gh CLI, logged in)',
    'git checkout -b ci/sentrai-gate',
    'mkdir -p .github/workflows',
    "cat > .github/workflows/sentrai-gate.yml <<'YAML'",
    'name: SentRAI AI Compliance Gate',
    'on:',
    '  pull_request:',
    '  push:',
    '    branches: [main]',
    'permissions:',
    '  contents: read',
    '  security-events: write',
    'jobs:',
    '  sentrai-gate:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    "        with: { node-version: '20' }",
    '      - name: SentRAI Pre-Deployment Gate',
    '        env:',
    '          SENTRAI_URL: ${{ vars.SENTRAI_URL }}',
    '          SENTRAI_CI_TOKEN: ${{ secrets.SENTRAI_CI_TOKEN }}',
    '          GITHUB_SHA: ${{ github.event.pull_request.head.sha || github.sha }}',
    '          PR_NUMBER: ${{ github.event.pull_request.number }}',
    '          GITHUB_RUN_ID: ${{ github.run_id }}',
    '        run: |',
    '          curl -sSfL "$SENTRAI_URL/api/v1/ci/gate.mjs" -o sentrai-gate.mjs',
    '          node sentrai-gate.mjs',
    '      - name: Upload SARIF to the Security tab',
    "        if: always() && hashFiles('sentrai-results.sarif') != ''",
    '        uses: github/codeql-action/upload-sarif@v3',
    '        with: { sarif_file: sentrai-results.sarif }',
    'YAML',
    '',
    '# Repo variable + secret the workflow reads',
    `gh variable set SENTRAI_URL --body "${origin}"`,
    token
      ? `gh secret set SENTRAI_CI_TOKEN --body "${token}"`
      : 'gh secret set SENTRAI_CI_TOKEN   # paste the CI token when prompted',
    '',
    'git add .github/workflows/sentrai-gate.yml',
    'git commit -m "ci: add SentRAI AI compliance gate"',
    'git push -u origin ci/sentrai-gate',
    'gh pr create --fill   # the gate runs on this PR; refresh the ledger to see it',
  ].join('\n');

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Set up CI scanning">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[86vh] w-[540px] max-w-[94vw] overflow-y-auto rounded-md border border-border-strong bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-[13px] font-medium">Set up CI scanning</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-text-tertiary hover:bg-surface-hover">
            <X size={15} />
          </button>
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">
          The gate blocks a deploy when a pipeline introduces ungoverned or non-compliant AI. Mint a
          project-scoped token, store it as the <code className="font-mono text-accent">SENTRAI_CI_TOKEN</code> secret,
          and add the step below.
        </p>

        <details className="mb-3 rounded-md border border-border bg-bg-elevated">
          <summary className="cursor-pointer select-none px-2.5 py-2 text-[11px] font-medium text-accent">
            Step-by-step guide: GitHub Actions
          </summary>
          <ol className="list-decimal space-y-2 px-2.5 pb-3 pl-7 text-[10.5px] leading-relaxed text-text-secondary">
            <li>
              <span className="font-medium text-text">Generate the token.</span> Pick the project below
              ({projectName || 'the project to gate'}) and click <em>Generate token</em>. Copy it now; it is shown once
              and is valid for 365 days. Generate it on the same SentRAI that the pipeline will call ({origin}).
            </li>
            <li>
              <span className="font-medium text-text">Add the credentials to the app&apos;s repo</span> (the repo being
              deployed, not SentRAI). In GitHub: <em>Settings → Secrets and variables → Actions</em>.
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li><em>Variables</em> tab → <code className="font-mono text-accent">SENTRAI_URL</code> = <code className="font-mono text-accent">{origin}</code></li>
                <li><em>Secrets</em> tab → <code className="font-mono text-accent">SENTRAI_CI_TOKEN</code> = the token</li>
              </ul>
              Or run the two <code className="font-mono">gh</code> lines in the commands below.
            </li>
            <li>
              <span className="font-medium text-text">Check Actions is enabled:</span> <em>Settings → Actions → General</em>.
              No third-party Action is needed; the workflow downloads the gate script from SentRAI.
            </li>
            <li>
              <span className="font-medium text-text">Add the workflow.</span> Run the <em>Add it to your repo</em> commands
              below from the repo root. They create <code className="font-mono">.github/workflows/sentrai-gate.yml</code> on a
              <code className="font-mono"> ci/sentrai-gate</code> branch. If the default branch is not <code className="font-mono">main</code>,
              edit <code className="font-mono">branches: [main]</code>.
            </li>
            <li>
              <span className="font-medium text-text">Optional policy.</span> Commit <code className="font-mono">.sentrai/policy.yaml</code>
              {' '}(see <code className="font-mono">ci-integration/policy.example.yaml</code>). Without it a safe default blocks
              HIGH/CRITICAL unregistered or ungoverned models.
            </li>
            <li>
              <span className="font-medium text-text">Open the PR.</span> The <em>SentRAI AI Compliance Gate</em> check runs:
              green on pass, red with file annotations on fail. Findings also appear under <em>Security → Code scanning</em>,
              and the event lands in this ledger.
            </li>
            <li>
              <span className="font-medium text-text">Make it blocking.</span> <em>Settings → Branches</em> (or Rules → Rulesets)
              for <code className="font-mono">main</code> → <em>Require status checks to pass</em> → select
              <code className="font-mono"> sentrai-gate</code> (it appears after the first run).
            </li>
          </ol>
          <div className="mx-2.5 mb-2.5 rounded border border-border p-2 text-[10px] leading-relaxed text-text-tertiary">
            <span className="font-medium text-text-secondary">Troubleshooting.</span> &ldquo;SENTRAI_URL and SENTRAI_CI_TOKEN are
            required&rdquo; means the variable or secret is missing or misnamed. A 401 means the token expired, is for another
            project, or was generated on a different SentRAI server. A reviewed FAIL can be overridden here by an Approver,
            Admin or CISO; the original verdict stays on the ledger.
          </div>
        </details>

        <label className="mb-1 block text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Project to gate</label>
        {loadError ? (
          <p className="mb-3 text-[11px] text-negative">Couldn't load projects — {loadError}</p>
        ) : !projects.length ? (
          <p className="mb-3 text-[11px] text-text-secondary">
            Create a project first (Projects), then come back to generate a CI token for it.
          </p>
        ) : (
          <div className="mb-3 flex gap-2">
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setToken(null);
              }}
              className="flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text focus:border-accent"
            >
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>{p.name}</option>
              ))}
            </select>
            {canMint && (
              <Button variant="primary" size="sm" onClick={mint} disabled={busy || !projectId} icon={<KeyRound size={13} />}>
                {busy ? 'Minting…' : 'Generate token'}
              </Button>
            )}
          </div>
        )}
        {!canMint && (
          <p className="mb-3 rounded-md border border-border bg-bg-elevated p-2 text-[10.5px] leading-relaxed text-text-secondary">
            Only an Admin, CISO or Owner can generate a CI token. Ask one to open <span className="font-medium text-text">CI Gate Ledger → Set up CI</span> and
            share the token with you as the <code className="font-mono text-accent">SENTRAI_CI_TOKEN</code> secret; the pipeline step below is the same.
          </p>
        )}

        {token && (
          <div className="mb-3 rounded-md border border-warning bg-warning-soft p-2.5">
            <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-warning">
              Copy now — this token is never shown again
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-bg-elevated px-2 py-1 font-mono text-[10px] text-text">{token}</code>
              <Button variant="secondary" size="sm" onClick={() => copy(token, 'Token')} icon={<Copy size={11} />}>Copy</Button>
            </div>
          </div>
        )}

        {token && (
          <>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Test it now — paste into a terminal</label>
              <Button variant="secondary" size="xs" onClick={() => copy(testSnippet, 'Test command')} icon={<Copy size={11} />}>Copy</Button>
            </div>
            <pre className="mb-3 overflow-x-auto rounded-md border border-border bg-bg-elevated p-2.5 font-mono text-[9.5px] leading-relaxed text-text">
{testSnippet}
            </pre>
          </>
        )}

        <div className="mb-1 flex items-center justify-between">
          <label className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Add it to your repo (git + gh)</label>
          <Button variant="secondary" size="xs" onClick={() => copy(gitSetup, 'Git commands')} icon={<Copy size={11} />}>Copy</Button>
        </div>
        <pre className="mb-3 max-h-64 overflow-auto rounded-md border border-border bg-bg-elevated p-2.5 font-mono text-[9.5px] leading-relaxed text-text">
{gitSetup}
        </pre>

        <div className="mb-1 flex items-center justify-between">
          <label className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Or just the step, for an existing workflow / other CI</label>
          <Button variant="secondary" size="xs" onClick={() => copy(snippet, 'Snippet')} icon={<Copy size={11} />}>Copy</Button>
        </div>
        <pre className="overflow-x-auto rounded-md border border-border bg-bg-elevated p-2.5 font-mono text-[9.5px] leading-relaxed text-text">
{snippet}
        </pre>
        <p className="mt-2 text-[10px] text-text-tertiary">
          Set the <code className="font-mono text-accent">SENTRAI_URL</code> variable to <code className="font-mono text-accent">{origin}</code>.
          Works on GitLab CI, Jenkins, and any runner — the gate script is served publicly and honours its own exit code.
          Refresh this ledger after a run to see the gate event.
        </p>
      </div>
    </div>
  );
}
