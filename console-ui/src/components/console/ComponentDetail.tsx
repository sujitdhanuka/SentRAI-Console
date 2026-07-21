import { PencilLine, Sparkles } from 'lucide-react';

import { AIComponent } from '../../providers/governance';
import { useConsoleUi } from '../../stores/consoleUi';
import { Panel, PanelError } from '../ui/Panel';
import { SkeletonBlock } from '../ui/Skeleton';

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-text-tertiary">{label}</div>
      <div className="font-mono text-[10.5px] text-text">{value}</div>
    </div>
  );
}

export function ComponentDetail({
  component,
  loading,
  error,
  onRetry,
}: {
  component: AIComponent | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { setDrawer, toast } = useConsoleUi();

  let body;
  if (error) body = <PanelError onRetry={onRetry} />;
  else if (loading) body = <SkeletonBlock />;
  else if (!component) body = <div className="p-3 text-[11px] text-text-secondary">No component selected.</div>;
  else
    body = (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <h3 className="font-heading text-[13px] font-medium text-text">{component.name}</h3>
          <p className="mb-3 mt-1 text-[10.5px] leading-relaxed text-text-secondary">{component.description}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Kv label="Owner" value={component.owner} />
            <Kv label="Model" value={component.model} />
            <Kv label="Version" value={component.version} />
            <Kv label="Risk tier" value={component.riskTier} />
            <Kv label="Sutras declared" value={`${component.sutrasDeclared}/7`} />
            <Kv label="Incidents 30d" value={String(component.incidents30d)} />
            <Kv label="Last red-team" value={`${component.lastRedTeamDaysAgo}d ago`} />
            <Kv label="Oversight" value={component.humanOversight ? 'HUMAN' : 'AUTO'} />
          </div>
        </div>
        <div className="flex shrink-0 gap-2 border-t border-border p-2.5">
          <button
            onClick={() => setDrawer(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-[11px] font-medium text-white hover:opacity-90"
          >
            <PencilLine size={12} /> Edit Entry
          </button>
          <button
            onClick={() => toast('Remediation draft queued (demo)')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px] text-text-secondary hover:bg-surface-hover"
          >
            <Sparkles size={12} /> Draft Remediation
          </button>
        </div>
      </div>
    );

  return (
    <Panel title="Component Detail" className="flex-[4]" bodyClassName="!overflow-hidden">
      {body}
    </Panel>
  );
}
