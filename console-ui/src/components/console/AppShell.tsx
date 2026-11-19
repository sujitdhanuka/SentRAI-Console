import { ArrowLeft, LogOut, Moon, ShieldCheck, Sun, X } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';

import { useConsoleUi } from '../../stores/consoleUi';
import { navigate, useRoute } from '../../stores/route';
import { useSession } from '../../stores/session';
import { Toasts } from '../ui/Toast';
import { ContextHelp } from './ContextHelp';
import { IconRail } from './IconRail';
import { APP_VERSION } from '../../version';

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}

const WORKFLOW_BACK_KEY = 'sentrai_workflow_back';

/** "Back to workflow" while a form was opened from a step on the Workflows page. */
function WorkflowBackBar() {
  const route = useRoute();
  const [, bump] = useState(0);
  let back: { query: Record<string, string>; label: string } | null = null;
  try { back = JSON.parse(sessionStorage.getItem(WORKFLOW_BACK_KEY) ?? 'null'); } catch { back = null; }
  if (!back || route === 'workflows') return null;
  const clear = () => { try { sessionStorage.removeItem(WORKFLOW_BACK_KEY); } catch { /* ignore */ } bump((n) => n + 1); };
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-accent bg-accent-soft px-3 py-1 text-[11px] text-accent">
      <button
        onClick={() => { const q = back!.query; clear(); navigate('workflows', q); }}
        className="flex items-center gap-1 font-medium hover:underline"
      >
        <ArrowLeft size={12} /> Back to workflow
      </button>
      <span className="min-w-0 truncate text-text-secondary">{back.label}</span>
      <button onClick={clear} aria-label="Dismiss" className="ml-auto text-text-tertiary hover:text-text"><X size={12} /></button>
    </div>
  );
}

/**
 * The console frame every page renders inside: rail, header (title, clock,
 * active-project scope, session, theme), and a fixed-viewport content area.
 * Pages own their own internal scrolling.
 */
export function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const { theme, toggleTheme } = useConsoleUi();
  const { user, logout, activeProjectId, activeProjectName, setActiveProject } = useSession();
  const clock = useClock();

  return (
    <div className="blueprint-grid flex h-screen flex-col overflow-auto bg-bg font-ui text-text lg:overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <IconRail />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-bg-elevated px-3">
            <ShieldCheck size={16} className="text-accent" strokeWidth={2} />
            <h1 className="flex items-baseline gap-1.5 font-heading text-[13px] tracking-wide">
              <span className="font-mono text-[10.5px] font-normal text-text-tertiary">sentRAI Console</span>
              <span className="text-text-tertiary">/</span>
              <span className="font-semibold text-text">{title}</span>
            </h1>
            <span className="hidden items-center gap-2 font-mono text-[10px] text-text-tertiary md:flex">
              <span>{clock}</span>
              <span className="opacity-40">·</span>
              <span>REV {APP_VERSION}</span>
            </span>

            {activeProjectId && (
              <span className="flex items-center gap-1 rounded border border-border bg-surface px-2 py-0.5 font-mono text-[9.5px] text-text-secondary">
                scope: {activeProjectName || activeProjectId.slice(0, 8)}
                <button
                  onClick={() => setActiveProject(null)}
                  title="Clear project scope"
                  aria-label="Clear project scope"
                  className="text-text-tertiary hover:text-negative"
                >
                  <X size={10} />
                </button>
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              {actions}
              <span className="hidden items-center gap-1.5 rounded-md border border-border px-2 py-1 lg:flex">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent font-mono text-[8px] font-bold text-white">
                  {(user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="text-[10.5px] text-text-secondary">{user?.email}</span>
                <span className="font-mono text-[8.5px] text-text-tertiary">{user?.role}</span>
              </span>
              <ContextHelp />
              <button
                onClick={toggleTheme}
                title="Toggle theme"
                aria-label="Toggle theme"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-hover"
              >
                {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
              </button>
              <button
                onClick={logout}
                title="Sign out"
                aria-label="Sign out"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-hover hover:text-negative"
              >
                <LogOut size={13} />
              </button>
            </div>
          </header>

          <WorkflowBackBar />
          {children}

          <footer className="shrink-0 border-t border-border py-1 text-center font-mono text-[8.5px] text-text-tertiary">
            sentRAI Console · v{APP_VERSION} · RBI FREE-AI · NIST AI RMF · EU AI Act · ISO 42001
          </footer>
        </div>
      </div>
      <Toasts />
    </div>
  );
}
