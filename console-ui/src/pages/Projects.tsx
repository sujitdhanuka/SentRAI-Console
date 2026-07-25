import { FileArchive, FolderUp, Github, Loader2, Play, Trash2, Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, apiUpload } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { GithubImportModal } from '../components/console/GithubImportModal';
import { NewProjectWizard } from '../components/console/NewProjectWizard';
import { ScanResultsModal, type ScanCandidate, type ScanReview } from '../components/console/ScanResultsModal';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';
import { navigate } from '../stores/route';
import { useSession } from '../stores/session';

interface Project {
  project_id: string;
  name: string;
  description?: string;
  root_directory: string;
  model_count: number;
  compliant_count?: number;
  last_scanned_at: string | null;
  has_scan_result?: boolean;
  codebase_source?: string | null;
}

const CARD = 'rounded-md border border-border bg-surface p-3';

export function Projects() {
  const toast = useConsoleUi((s) => s.toast);
  const { activeProjectId, setActiveProject } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await api<Project[]>('/projects'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (projectId: string, files: FileList, mode: 'zip' | 'folder') => {
    setBusyId(projectId);
    try {
      const form = new FormData();
      if (mode === 'zip') {
        form.append('file', files[0]);
        await apiUpload(`/projects/${projectId}/codebase`, form);
      } else {
        for (const f of Array.from(files)) form.append('files', f, f.webkitRelativePath || f.name);
        await apiUpload(`/projects/${projectId}/codebase/folder`, form);
      }
      toast('Codebase uploaded — review the discovered AI components', 'positive');
      void load();
      // The upload already scanned server-side; fetch the result and open the
      // review so the user can pick what enters the inventory.
      await scan(projectId);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'negative');
    } finally {
      setBusyId(null);
    }
  };

  // GitHub import runs through a dedicated popup (URL parsing, branch, token)
  // instead of window.prompt — the API needs owner/repo, not a raw URL.
  const [githubFor, setGithubFor] = useState<Project | null>(null);

  // The review step between scan and inventory: scan, then show every
  // discovered component with a checkbox so the user chooses what to govern.
  const [scanReview, setScanReview] = useState<ScanReview | null>(null);

  const scan = async (projectId: string, projectName?: string) => {
    setBusyId(projectId);
    try {
      const res = await api<{ candidates: ScanCandidate[]; ast_coverage?: string }>('/discovery/scan', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId }),
      });
      if (res.candidates.length === 0) {
        toast('Scan complete — no AI components detected', 'positive');
        void load();
        return;
      }
      const name = projectName ?? projects.find((p) => p.project_id === projectId)?.name ?? 'project';
      setScanReview({
        project: { project_id: projectId, name },
        candidates: res.candidates,
        astCoverage: res.ast_coverage,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Scan failed', 'negative');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: Project) => {
    // A project with a tracked inventory needs cascade=true, which also deletes
    // its models — spell that out so it's a deliberate choice, not a surprise.
    const n = p.model_count;
    const message =
      n > 0
        ? `Delete project "${p.name}" and its ${n} tracked model(s)?\n\nThis permanently removes those models and their governance history. This cannot be undone.`
        : `Delete project "${p.name}"?`;
    if (!window.confirm(message)) return;
    try {
      await api(`/projects/${p.project_id}${n > 0 ? '?cascade=true' : ''}`, { method: 'DELETE' });
      if (activeProjectId === p.project_id) setActiveProject(null);
      toast(n > 0 ? `Project and ${n} model(s) deleted` : 'Project deleted');
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'negative');
    }
  };

  const activate = (p: Project) => {
    setActiveProject(p.project_id, p.name);
    toast(`Scope set to ${p.name}`, 'positive');
    navigate('inventory');
  };

  return (
    <AppShell
      title="Projects"
      actions={
        <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>
          + New Project
        </Button>
      }
    >
      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-3 max-w-[80ch] font-serif text-[12.5px] leading-relaxed text-text-secondary">
          Each project tracks one application's codebase — its own scan history and its own scoped model
          inventory. Add a codebase by uploading a .zip, uploading a folder, or importing a GitHub repository,
          then scan to discover its AI components and choose which ones to govern in the inventory.
        </p>

        {error && (
          <div className={`${CARD} flex items-center gap-3`}>
            <span className="text-[11px] text-text-secondary">{error}</span>
            <Button variant="secondary" size="xs" onClick={() => void load()}>RETRY</Button>
          </div>
        )}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[150px] w-full" />)}
          </div>
        ) : !projects.length && !error ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-bg-elevated px-6 py-10 text-center">
            <p className="text-[11px] text-text-secondary">No projects yet — create one to start tracking an application's AI models.</p>
            <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>+ New Project</Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {projects.map((p) => {
              const scanned = Boolean(p.last_scanned_at) || p.model_count > 0;
              const isActive = p.project_id === activeProjectId;
              const busy = busyId === p.project_id;
              return (
                <div key={p.project_id} className={`${CARD} ${isActive ? 'border-accent' : ''} flex flex-col gap-2`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[12.5px] font-medium">{p.name}</h3>
                    {isActive && <Badge tone="accent">active</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone="neutral">{p.model_count} model(s)</Badge>
                    {p.compliant_count !== undefined && (
                      <Badge tone={p.compliant_count === p.model_count && p.model_count > 0 ? 'positive' : 'negative'}>
                        {p.compliant_count}/{p.model_count} compliant
                      </Badge>
                    )}
                    <Badge tone={scanned ? 'positive' : 'warning'}>{scanned ? 'scanned' : 'not scanned'}</Badge>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                    <Button variant="primary" size="sm" onClick={() => activate(p)} icon={<Check size={11} />}>Select</Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => scan(p.project_id, p.name)} title="Scan the uploaded codebase for AI components" icon={busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}>Scan</Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => { uploadTarget.current = p.project_id; zipRef.current?.click(); }} title="Upload a .zip of the codebase" icon={<FileArchive size={11} />}>Zip</Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => { uploadTarget.current = p.project_id; folderRef.current?.click(); }} title="Upload a folder" icon={<FolderUp size={11} />}>Folder</Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => setGithubFor(p)} title="Import from GitHub" icon={<Github size={11} />}>GitHub</Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(p)} title="Delete project" aria-label={`Delete ${p.name}`} className="ml-auto px-2 hover:text-negative" icon={<Trash2 size={11} />} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Shared hidden inputs — one pair for all cards. */}
        <input ref={zipRef} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files; if (f?.length && uploadTarget.current) void upload(uploadTarget.current, f, 'zip'); e.target.value = ''; }} />
        <input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => { const f = e.target.files; if (f?.length && uploadTarget.current) void upload(uploadTarget.current, f, 'folder'); e.target.value = ''; }} />
      </main>

      <NewProjectWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); void load(); }}
        onReady={(proj) => {
          // Codebase loaded (and scanned server-side) — jump straight to the
          // model-selection review, the final screen of the sequence.
          void load();
          void scan(proj.project_id, proj.name);
        }}
      />

      <GithubImportModal
        project={githubFor}
        onClose={() => setGithubFor(null)}
        onImported={() => {
          void load();
          // Import scans on upload — open the review straight away.
          if (githubFor) void scan(githubFor.project_id, githubFor.name);
        }}
      />

      <ScanResultsModal
        review={scanReview}
        onClose={() => setScanReview(null)}
        onImported={() => void load()}
      />
    </AppShell>
  );
}
