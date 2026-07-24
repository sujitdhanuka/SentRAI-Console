import { PencilLine } from 'lucide-react';

import { AIComponent } from '../../providers';
import { useConsoleUi } from '../../stores/consoleUi';
import { AiGenerations } from './AiGenerations';
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
  const setDrawer = useConsoleUi((s) => s.setDrawer);

  let body;
  if (error) body = <PanelError onRetry={onRetry} />;
  else if (loading) body = <SkeletonBlock />;
  else if (!component) body = <div className="p-3 text-[11px] text-text-secondary">No component selected.</div>;
  else
    body = (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <h3 className="font-heading text-[13px] font-medium text-text">{component.name}</h3>
          <p className="mb-3 mt-1 font-serif text-[12px] leading-relaxed text-text-secondary">{component.description}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Kv label="Owner" value={component.owner} />
            <Kv label="Model" value={component.model} />
            <Kv label="Version" value={component.version} />
            <Kv label="Risk tier" value={component.riskTier} />
            <Kv label="Sutras declared" value={`${component.sutrasDeclared}/7`} />
            <Kv label="Incidents 30d" value={String(component.incidents30d)} />
            <Kv label="Last red-team" value={component.lastRedTeamDaysAgo >= 9000 ? 'never' : `${component.lastRedTeamDaysAgo}d ago`} />
            <Kv label="Oversight" value={component.humanOversight ? 'HUMAN' : 'AUTO'} />
          </div>

          <div className="-mx-3 mt-3">
            <AiGenerations component={component} onChanged={onRetry} />
          </div>
        </div>
        <div className="shrink-0 border-t border-border p-2.5">
          <button
            onClick={() => setDrawer(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-[11px] font-medium text-white hover:opacity-90"
          >
            <PencilLine size={12} /> Edit Entry
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
