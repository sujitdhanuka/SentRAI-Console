import { FileDown, MessageSquarePlus } from 'lucide-react';

import { provider } from '../../providers';
import { EnvFilter, useConsoleUi } from '../../stores/consoleUi';

const ENVS: EnvFilter[] = ['All', 'PROD', 'STAGING', 'DEV'];

/** Inventory-specific header controls, injected into the AppShell header. */
export function InventoryActions() {
  const { env, setEnv, setGrievance, toast } = useConsoleUi();

  const exportAudit = async () => {
    try {
      const { url } = await provider.exportAudit();
      if (url.startsWith('blob:')) window.open(url, '_blank');
      toast('Audit report ready', 'positive');
    } catch {
      toast('Audit export failed', 'negative');
    }
  };

  return (
    <>
      <div className="hidden overflow-hidden rounded-md border border-border md:flex" role="group" aria-label="Environment filter">
        {ENVS.map((e) => (
          <button
            key={e}
            onClick={() => setEnv(e)}
            aria-pressed={env === e}
            className={`px-2 py-1 font-mono text-[10px] transition-colors ${
              env === e ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:bg-surface-hover'
            }`}
          >
            {e}
          </button>
        ))}
      </div>
      <button onClick={exportAudit} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover">
        <FileDown size={13} /> <span className="hidden lg:inline">Audit PDF</span>
      </button>
      <button onClick={() => setGrievance(true)} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover">
        <MessageSquarePlus size={13} /> <span className="hidden lg:inline">Grievance</span>
      </button>
    </>
  );
}
