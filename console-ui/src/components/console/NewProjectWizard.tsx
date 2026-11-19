import { Check, FileArchive, FolderUp, Github, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { api, apiUpload } from '../../api/client';
import { OrgSelect, useAssignableOrgs } from '../../api/organizations';
import { useSession } from '../../stores/session';
import { useConsoleUi } from '../../stores/consoleUi';
import { GithubRepoFields, parseGithubRepo } from './GithubImportModal';

import { Button } from '../ui/Button';
import { fieldClass as FIELD } from '../ui/form';
import { labelClass as LABEL } from '../ui/form';

type Source = 'github' | 'zip' | 'folder';
type Step = 1 | 2;

export interface CreatedProject { project_id: string; name: string }

/**
 * Guided project creation: Name → Codebase. On success it hands the created
 * project back to the caller, which opens the scan-results review (the third
 * screen) — so the whole flow is one continuous sequence instead of three
 * separate clicks on a project card.
 */
export function NewProjectWizard({
  open,
  onClose,
  onReady,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired once a codebase is loaded (and thus scanned server-side): the
   *  parent opens the scan review for this project. */
  onReady: (project: CreatedProject) => void;
}) {
  const toast = useConsoleUi((s) => s.toast);
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const { orgs, canChoose } = useAssignableOrgs();
  const scopeOrgId = useSession((s) => s.activeOrgId);
  const [orgId, setOrgId] = useState(scopeOrgId ?? '');
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [source, setSource] = useState<Source>('github');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GitHub fields
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [token, setToken] = useState('');
  const parsed = useMemo(() => parseGithubRepo(url), [url]);

  const zipRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStep(1); setName(''); setCreated(null); setSource('github');
      setUrl(''); setBranch(''); setToken(''); setError(null); setBusy(false);
      setOrgId(scopeOrgId ?? '');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // A /tree/<branch> URL implies the branch.
  useEffect(() => { if (parsed?.branch) setBranch((b) => b || parsed.branch!); }, [parsed?.branch]);

  if (!open) return null;

  const goToCodebase = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const proj = await api<{ project_id: string; name: string }>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), ...(canChoose && orgId ? { organization_id: orgId } : {}) }),
      });
      setCreated({ project_id: proj.project_id, name: proj.name });
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the project');
    } finally {
      setBusy(false);
    }
  };

  // Every codebase source ends the same way: the server scans on load, so we
  // hand the project to the review step and close the wizard.
  const finishWith = (project: CreatedProject) => {
    toast('Codebase loaded — choose the AI components to govern', 'positive');
    onReady(project);
    onClose();
  };

  const importGithub = async () => {
    if (!parsed || !created) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${created.project_id}/codebase/github`, {
        method: 'POST',
        body: JSON.stringify({
          owner: parsed.owner,
          repo: parsed.repo,
          branch: branch.trim() || null,
          token: token.trim() || null,
        }),
      });
      finishWith(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (files: FileList, mode: 'zip' | 'folder') => {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (mode === 'zip') {
        form.append('file', files[0]);
        await apiUpload(`/projects/${created.project_id}/codebase`, form);
      } else {
        for (const f of Array.from(files)) form.append('files', f, f.webkitRelativePath || f.name);
        await apiUpload(`/projects/${created.project_id}/codebase/folder`, form);
      }
      finishWith(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const StepDot = ({ n, label }: { n: Step; label: string }) => {
    const done = step > n;
    const active = step === n;
    return (
      <div className="flex items-center gap-1.5">
        <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold ${
          done ? 'bg-positive text-white' : active ? 'bg-accent text-white' : 'bg-bg-elevated text-text-tertiary'
        }`}>
          {done ? <Check size={9} /> : n}
        </span>
        <span className={`text-[10px] ${active ? 'text-text' : 'text-text-tertiary'}`}>{label}</span>
      </div>
    );
  };

  const TabBtn = ({ s, icon, label }: { s: Source; icon: React.ReactNode; label: string }) => (
    <button
      type="button"
      onClick={() => { setSource(s); setError(null); }}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[10.5px] ${
        source === s ? 'border-accent bg-accent/10 text-text' : 'border-border text-text-secondary hover:bg-surface-hover'
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Create a project">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-md border border-border-strong bg-surface">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex-1">
            <h2 className="font-heading text-[13px] font-medium">New project</h2>
          </div>
          <div className="flex items-center gap-2.5">
            <StepDot n={1} label="Name" />
            <span className="h-px w-3 bg-border" />
            <StepDot n={2} label="Codebase" />
            <span className="h-px w-3 bg-border" />
            <div className="flex items-center gap-1.5 opacity-60">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-bg-elevated text-[8px] font-semibold text-text-tertiary">3</span>
              <span className="text-[10px] text-text-tertiary">Models</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-text-tertiary hover:bg-surface-hover">
            <X size={15} />
          </button>
        </header>

        <div className="p-4">
          {step === 1 && (
            <div className="space-y-3">
              <div>
                <label className={LABEL}>Project name</label>
                <input
                  className={FIELD}
                  value={name}
                  autoFocus
                  placeholder="e.g. Payments Fraud Service"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && goToCodebase()}
                />
                <p className="mt-1 text-[9.5px] leading-snug text-text-tertiary">
                  One project tracks one application's codebase and its scoped AI model inventory.
                </p>
              </div>
              {canChoose && (
                <div>
                  <label className={LABEL}>Organization</label>
                  <OrgSelect className={FIELD} value={orgId} onChange={setOrgId} orgs={orgs} label="Organization" />
                  <p className="mt-1 text-[9.5px] leading-snug text-text-tertiary">
                    The organization whose governance (risk register, settings, approvals) covers this project's models.
                  </p>
                </div>
              )}
              {error && <p className="rounded-md border border-negative bg-negative-soft px-2.5 py-1.5 text-[10.5px] text-negative">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={goToCodebase} disabled={busy || !name.trim()} icon={busy ? <Loader2 size={12} className="animate-spin" /> : undefined}>
                  Next: add codebase
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="font-mono text-[9px] text-text-tertiary">into {created?.name}</div>
              <div className="flex gap-1.5">
                <TabBtn s="github" icon={<Github size={12} />} label="GitHub" />
                <TabBtn s="zip" icon={<FileArchive size={12} />} label="Zip" />
                <TabBtn s="folder" icon={<FolderUp size={12} />} label="Folder" />
              </div>

              {source === 'github' && (
                <div className="space-y-3">
                  <GithubRepoFields url={url} setUrl={setUrl} branch={branch} setBranch={setBranch} token={token} setToken={setToken} parsed={parsed} namePrefix="wiz" />
                </div>
              )}

              {(source === 'zip' || source === 'folder') && (
                <div
                  className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-bg-elevated px-4 py-8 text-center"
                >
                  {source === 'zip' ? <FileArchive size={22} className="text-text-tertiary" /> : <FolderUp size={22} className="text-text-tertiary" />}
                  <p className="text-[11px] text-text-secondary">
                    {source === 'zip' ? 'Upload a .zip of the application codebase.' : 'Upload the application source folder.'}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => (source === 'zip' ? zipRef.current : folderRef.current)?.click()}
                    className="flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-[11px] text-text hover:bg-surface-hover disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : source === 'zip' ? <FileArchive size={12} /> : <FolderUp size={12} />}
                    Choose {source === 'zip' ? 'file' : 'folder'}
                  </button>
                </div>
              )}

              {error && <p className="rounded-md border border-negative bg-negative-soft px-2.5 py-1.5 text-[10.5px] text-negative">{error}</p>}

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={onClose}>I'll add it later</Button>
                {source === 'github' && (
                  <Button variant="primary" size="sm" onClick={importGithub} disabled={busy || !parsed} title={!parsed ? 'Enter a valid GitHub repository first' : undefined} icon={busy ? <Loader2 size={12} className="animate-spin" /> : <Github size={12} />}>
                    Import &amp; scan
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <input ref={zipRef} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files; if (f?.length) void uploadFiles(f, 'zip'); e.target.value = ''; }} />
        <input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => { const f = e.target.files; if (f?.length) void uploadFiles(f, 'folder'); e.target.value = ''; }} />
      </div>
    </div>
  );
}
