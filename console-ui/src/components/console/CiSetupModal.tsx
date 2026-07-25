import { Copy, KeyRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { useConsoleUi } from '../../stores/consoleUi';

interface Project {
  project_id: string;
  name: string;
}

/**
 * Mints a project-scoped CI service token and shows a ready-to-paste pipeline
 * snippet. The token is displayed EXACTLY once — the backend never returns it
 * again — so the copy affordance is deliberately prominent.
 */
export function CiSetupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useConsoleUi((s) => s.toast);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setToken(null);
    api<Project[]>('/projects')
      .then((p) => {
        setProjects(p);
        setProjectId((cur) => cur || p[0]?.project_id || '');
      })
      .catch(() => undefined);
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const mint = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api<{ token: string }>('/ci/tokens', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, label: 'console-generated' }),
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

        <label className="mb-1 block text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Project to gate</label>
        <div className="mb-3 flex gap-2">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text focus:border-accent"
          >
            {projects.map((p) => (
              <option key={p.project_id} value={p.project_id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={mint}
            disabled={busy || !projectId}
            className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <KeyRound size={13} /> {busy ? 'Minting…' : 'Generate token'}
          </button>
        </div>

        {token && (
          <div className="mb-3 rounded-md border border-warning bg-warning-soft p-2.5">
            <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-warning">
              Copy now — this token is never shown again
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-bg-elevated px-2 py-1 font-mono text-[10px] text-text">{token}</code>
              <button onClick={() => copy(token, 'Token')} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface-hover">
                <Copy size={11} /> Copy
              </button>
            </div>
          </div>
        )}

        <div className="mb-1 flex items-center justify-between">
          <label className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Pipeline step</label>
          <button onClick={() => copy(snippet, 'Snippet')} className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover">
            <Copy size={11} /> Copy
          </button>
        </div>
        <pre className="overflow-x-auto rounded-md border border-border bg-bg-elevated p-2.5 font-mono text-[9.5px] leading-relaxed text-text">
{snippet}
        </pre>
        <p className="mt-2 text-[10px] text-text-tertiary">
          Works on GitLab CI, Jenkins, and any runner — the gate script is served publicly and honours its own exit code.
        </p>
      </div>
    </div>
  );
}
