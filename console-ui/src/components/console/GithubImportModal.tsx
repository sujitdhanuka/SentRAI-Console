import { Github, KeyRound, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../api/client';
import { useConsoleUi } from '../../stores/consoleUi';

const FIELD = 'w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text placeholder:text-text-tertiary focus:border-accent';
const LABEL = 'mb-1 block text-[9px] font-medium uppercase tracking-widest text-text-tertiary';

/**
 * Accepts every way people paste a GitHub repo and normalises it to owner/repo:
 *   https://github.com/owner/repo            (optionally .git, trailing /)
 *   https://github.com/owner/repo/tree/br    (branch is captured too)
 *   git@github.com:owner/repo.git
 *   owner/repo
 */
export function parseGithubRepo(input: string): { owner: string; repo: string; branch?: string } | null {
  const s = input.trim();
  if (!s) return null;
  let m = s.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = s.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/\s]+).*)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2], branch: m[3] };
  m = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

/**
 * Import-from-GitHub popup: URL (parsed live to owner/repo), branch, and an
 * optional access token for private repositories. Replaces the old
 * window.prompt, which collected a bare URL the API never accepted.
 */
/** 'github:owner/repo@branch' (as persisted on the project) → its parts. */
function parseStoredSource(source?: string | null): { owner: string; repo: string; branch?: string } | null {
  const m = source?.match(/^github:([^/\s]+)\/([^@\s]+?)(?:@(.+))?$/);
  return m ? { owner: m[1], repo: m[2], branch: m[3] } : null;
}

export function GithubImportModal({
  project,
  onClose,
  onImported,
}: {
  project: { project_id: string; name: string; codebase_source?: string | null } | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useConsoleUi((s) => s.toast);
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseGithubRepo(url), [url]);

  useEffect(() => {
    if (project) {
      // A project previously imported from GitHub prefills its repo and branch.
      // The token is intentionally blank every time: it is used once per import
      // and never stored, so each re-import asks for it afresh.
      const prev = parseStoredSource(project.codebase_source);
      setUrl(prev ? `https://github.com/${prev.owner}/${prev.repo}` : '');
      setBranch(prev?.branch ?? '');
      setToken(''); setError(null);
      setTimeout(() => ref.current?.querySelector<HTMLElement>('input')?.focus(), 0);
    }
  }, [project]);

  // A /tree/<branch> URL implies the branch — prefill once, still editable.
  useEffect(() => {
    if (parsed?.branch) setBranch((b) => b || parsed.branch!);
  }, [parsed?.branch]);

  useEffect(() => {
    if (!project) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [project, onClose]);

  if (!project) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${project.project_id}/codebase/github`, {
        method: 'POST',
        body: JSON.stringify({
          owner: parsed.owner,
          repo: parsed.repo,
          branch: branch.trim() || null,
          token: token.trim() || null,
        }),
      });
      toast(`Imported ${parsed.owner}/${parsed.repo} — run Scan to discover its AI`, 'positive');
      onImported();
      onClose();
    } catch (err) {
      // Errors stay inside the popup, next to the fields they concern.
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Import GitHub repository into ${project.name}`}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} className="relative w-full max-w-md overflow-hidden rounded-md border border-border-strong bg-surface">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Github size={15} className="text-accent" />
          <div>
            <h2 className="font-heading text-[13px] font-medium">Import from GitHub</h2>
            <div className="font-mono text-[9px] text-text-tertiary">into {project.name}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-text-tertiary hover:bg-surface-hover">
            <X size={15} />
          </button>
        </header>

        {/* autoComplete choices matter: browsers heuristically treat a text
            input next to a password input as a username field and fill the
            saved email + password into it (branch showed the user's email).
            new-password on the token plus off + non-credential names stops it. */}
        <form onSubmit={submit} autoComplete="off" className="space-y-3 p-4">
          <div>
            <label className={LABEL}>Repository URL</label>
            <input
              className={`${FIELD} font-mono`}
              name="github-repo-url"
              autoComplete="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo · git@github.com:owner/repo.git · owner/repo"
            />
            {url.trim() && (
              parsed ? (
                <p className="mt-1 font-mono text-[10px] text-positive">
                  ✓ {parsed.owner} / {parsed.repo}{parsed.branch ? ` · branch ${parsed.branch}` : ''}
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-warning">
                  Not a recognisable GitHub repository — expected https://github.com/owner/repo, an SSH URL, or owner/repo.
                </p>
              )
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Branch</label>
              <input
                className={`${FIELD} font-mono`}
                name="github-branch"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main (default)"
              />
            </div>
            <div>
              <label className={LABEL}>Access token <span className="normal-case text-text-tertiary">(private repos)</span></label>
              <span className="flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2 focus-within:border-accent">
                <KeyRound size={11} className="shrink-0 text-text-tertiary" />
                <input
                  type="password"
                  className="w-full bg-transparent py-1.5 font-mono text-[11px] text-text placeholder:text-text-tertiary focus:outline-none"
                  name="github-access-token"
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_… / fine-grained PAT"
                />
              </span>
            </div>
          </div>
          <p className="text-[9.5px] leading-snug text-text-tertiary">
            The token needs read-only contents access and is used once to download the archive — it is never stored,
            so every import asks for it again. Public repositories need no token.
          </p>

          {error && (
            <p className="rounded-md border border-negative bg-negative-soft px-2.5 py-1.5 text-[10.5px] text-negative">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-[11px] text-text-secondary hover:bg-surface-hover">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !parsed}
              title={!parsed ? 'Enter a valid GitHub repository first' : undefined}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Github size={12} /> {busy ? 'Importing…' : 'Import repository'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
