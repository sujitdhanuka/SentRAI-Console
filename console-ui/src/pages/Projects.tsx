import { FileArchive, FolderUp, Github, Loader2, Play, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, apiUpload } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Badge } from '../components/ui/Badge';
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
}

const CARD = 'rounded-md border border-border bg-surface p-3';
const FIELD = 'w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text placeholder:text-text-tertiary focus:border-accent';

export function Projects() {
  const toast = useConsoleUi((s) => s.toast);
  const { activeProjectId, setActiveProject } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
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

  const create = async () => {
    if (!name.trim()) return;
    try {
      await api('/projects', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      toast('Project created', 'positive');
      setName('');
      setCreating(false);
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Create failed', 'negative');
    }
  };

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
      toast('Codebase uploaded — run Scan to discover models', 'positive');
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'negative');
    } finally {
      setBusyId(null);
    }
  };

  const importGithub = async (projectId: string) => {
    const url = window.prompt('GitHub repository URL (public, or with a token configured):');
    if (!url) return;
    setBusyId(projectId);
    try {
      await api(`/projects/${projectId}/codebase/github`, { method: 'POST', body: JSON.stringify({ repo_url: url }) });
      toast('Repository imported', 'positive');
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed', 'negative');
    } finally {
      setBusyId(null);
    }
  };

  const scan = async (projectId: string) => {
    setBusyId(projectId);
    try {
      const res = await api<{ candidates: unknown[] }>('/discovery/scan', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId }),
      });
      toast(`Scan complete — ${res.candidates.length} AI component(s) detected`, 'positive');
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Scan failed', 'negative');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: Project) => {
    if (!window.confirm(`Delete project "${p.name}"? Its tracked models must be removed first.`)) return;
    try {
      await api(`/projects/${p.project_id}`, { method: 'DELETE' });
      if (activeProjectId === p.project_id) setActiveProject(null);
      toast('Project deleted');
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
        <button
          onClick={() => setCreating((v) => !v)}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
        >
          + New Project
        </button>
      }
    >
      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-3 max-w-[80ch] text-[11px] leading-relaxed text-text-secondary">
          Each project tracks one application's codebase — its own scan history and its own scoped model
          inventory. Add a codebase by uploading a .zip, uploading a folder, or importing a GitHub repository,
          then scan to discover the AI components inside it.
        </p>

        {creating && (
          <div className={`${CARD} mb-3 max-w-md`}>
            <label className="mb-1 block text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Project name</label>
            <input className={FIELD} value={name} autoFocus placeholder="e.g. Payments Service" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => setCreating(false)} className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover">Cancel</button>
              <button onClick={create} className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90">Create</button>
            </div>
          </div>
        )}

        {error && (
          <div className={`${CARD} flex items-center gap-3`}>
            <span className="text-[11px] text-text-secondary">{error}</span>
            <button onClick={() => void load()} className="rounded border border-border-strong px-2 py-0.5 font-mono text-[10px]">RETRY</button>
          </div>
        )}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[150px] w-full" />)}
          </div>
        ) : !projects.length && !error ? (
          <div className="rounded-md border border-border bg-bg-elevated px-6 py-8 text-center text-[11px] text-text-secondary">
            No projects yet — create one to start tracking an application's AI models.
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

                  <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    <button onClick={() => activate(p)} className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[10.5px] font-medium text-white hover:opacity-90">
                      <Zap size={11} /> Select
                    </button>
                    <button disabled={busy} onClick={() => scan(p.project_id)} title="Scan the uploaded codebase for AI components" className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50">
                      {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Scan
                    </button>
                    <button disabled={busy} onClick={() => { uploadTarget.current = p.project_id; zipRef.current?.click(); }} title="Upload a .zip of the codebase" className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50">
                      <FileArchive size={11} /> Zip
                    </button>
                    <button disabled={busy} onClick={() => { uploadTarget.current = p.project_id; folderRef.current?.click(); }} title="Upload a folder" className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50">
                      <FolderUp size={11} /> Folder
                    </button>
                    <button disabled={busy} onClick={() => importGithub(p.project_id)} title="Import from GitHub" className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50">
                      <Github size={11} /> GitHub
                    </button>
                    <button onClick={() => remove(p)} title="Delete project" aria-label={`Delete ${p.name}`} className="ml-auto rounded-md border border-border px-1.5 py-1 text-text-tertiary hover:bg-surface-hover hover:text-negative">
                      <Trash2 size={11} />
                    </button>
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
    </AppShell>
  );
}
