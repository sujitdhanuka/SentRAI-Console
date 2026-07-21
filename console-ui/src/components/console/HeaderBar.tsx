import { FileDown, MessageSquarePlus, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { provider } from '../../providers/governance';
import { EnvFilter, useConsoleUi } from '../../stores/consoleUi';

const ENVS: EnvFilter[] = ['All', 'PROD', 'STAGING', 'DEV'];

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}

export function HeaderBar() {
  const { theme, toggleTheme, env, setEnv, setGrievance, toast } = useConsoleUi();
  const clock = useClock();

  const exportAudit = async () => {
    try {
      const { url } = await provider.exportAudit();
      toast(`Audit report ready · ${url.split('/').pop()}`, 'positive');
    } catch {
      toast('Audit export failed', 'negative');
    }
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-bg-elevated px-3">
      <ShieldCheck size={16} className="text-accent" strokeWidth={2} />
      <h1 className="font-heading text-[13px] font-medium tracking-wide">
        sentRAI Console <span className="text-text-tertiary">·</span> Model Inventory
      </h1>
      <span className="font-mono text-[10px] text-text-tertiary">{clock}</span>

      <div className="ml-auto flex items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Environment filter">
          {ENVS.map((e) => (
            <button
              key={e}
              onClick={() => setEnv(e)}
              aria-pressed={env === e}
              className={`px-2.5 py-1 font-mono text-[10px] transition-colors ${
                env === e ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:bg-surface-hover'
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <button
          onClick={exportAudit}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:bg-surface-hover"
        >
          <FileDown size={13} /> Audit Report (PDF)
        </button>
        <button
          onClick={() => setGrievance(true)}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:bg-surface-hover"
        >
          <MessageSquarePlus size={13} /> Grievance
        </button>
        <button
          onClick={toggleTheme}
          title="Toggle theme"
          aria-label="Toggle theme"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-hover"
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>
    </header>
  );
}
