import { FileCode2, PencilLine } from 'lucide-react';

import { AIComponent } from '../../providers';
import { useConsoleUi } from '../../stores/consoleUi';
import { AiGenerations } from './AiGenerations';
import { Button } from '../ui/Button';
import { Panel, PanelError } from '../ui/Panel';
import { SkeletonBlock } from '../ui/Skeleton';

/** "3, 7, 12–15" — consecutive lines collapse into a range. */
function formatLines(lines: number[]): string {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? String(start) : `${start}–${sorted[i]}`);
  }
  return parts.join(', ');
}

function SourceSection({ component }: { component: AIComponent }) {
  const locations =
    component.sourceLocations ?? (component.sourceRefs ?? []).map((file) => ({ file, lines: [] as number[] }));
  return (
    <section className="mt-3" aria-label="Source">
      <div className="mb-1 flex items-center gap-1.5">
        <FileCode2 size={11} className="text-accent" />
        <span className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Source</span>
        {locations.length > 0 && (
          <span className="font-mono text-[9px] text-text-tertiary">
            {locations.length} {locations.length === 1 ? 'file' : 'files'}
          </span>
        )}
      </div>
      {locations.length === 0 ? (
        <p className="text-[10.5px] italic text-text-tertiary">Registered manually — no source files on record.</p>
      ) : (
        <ul className="space-y-1">
          {locations.map((l) => (
            <li key={l.file} className="rounded border border-border bg-bg-elevated px-2 py-1">
              <div className="break-all font-mono text-[10px] text-text">{l.file}</div>
              <div className="font-mono text-[9.5px] text-text-secondary">
                {l.lines.length ? `${l.lines.length === 1 ? 'line' : 'lines'} ${formatLines(l.lines)}` : 'lines not recorded — re-scan to fill in'}
              </div>
            </li>
          ))}
        </ul>
      )}
      {locations.length > 1 && (
        <p className="mt-1 text-[9px] text-text-tertiary">
          The scan found this model in several places; they are governed as one record.
        </p>
      )}
    </section>
  );
}

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

          <SourceSection component={component} />

          <div className="-mx-3 mt-3">
            <AiGenerations component={component} onChanged={onRetry} />
          </div>
        </div>
        <div className="shrink-0 border-t border-border p-2.5">
          <Button variant="primary" size="md" onClick={() => setDrawer(true)} className="w-full" icon={<PencilLine size={12} />}>
            Edit Entry
          </Button>
        </div>
      </div>
    );

  return (
    <Panel title="Component Detail" className="flex-[4]" bodyClassName="!overflow-hidden">
      {body}
    </Panel>
  );
}
