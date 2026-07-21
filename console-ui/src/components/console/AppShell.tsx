import { LogOut, Moon, ShieldCheck, Sun, X } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';

import { useConsoleUi } from '../../stores/consoleUi';
import { useSession } from '../../stores/session';
import { Toasts } from '../ui/Toast';
import { IconRail } from './IconRail';

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
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
    <div className="flex h-screen flex-col overflow-auto bg-bg font-ui text-text lg:overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <IconRail />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-bg-elevated px-3">
            <ShieldCheck size={16} className="text-accent" strokeWidth={2} />
            <h1 className="font-heading text-[13px] font-medium tracking-wide">
              sentRAI Console <span className="text-text-tertiary">·</span> {title}
            </h1>
            <span className="hidden font-mono text-[10px] text-text-tertiary md:inline">{clock}</span>

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

          {children}

          <footer className="shrink-0 border-t border-border py-1 text-center font-mono text-[8.5px] text-text-tertiary">
            sentRAI Console · RBI FREE-AI · NIST AI RMF · EU AI Act · ISO 42001
          </footer>
        </div>
      </div>
      <Toasts />
    </div>
  );
}
