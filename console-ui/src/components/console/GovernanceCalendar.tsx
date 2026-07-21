import { CalendarEvent } from '../../providers';
import { Panel, PanelError } from '../ui/Panel';
import { SkeletonBlock } from '../ui/Skeleton';

export function GovernanceCalendar({
  events,
  loading,
  error,
  onRetry,
}: {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  let body;
  if (error) body = <PanelError onRetry={onRetry} />;
  else if (loading) body = <SkeletonBlock />;
  else
    body = (
      <ul className="p-2">
        {events.map((e, i) => (
          <li
            key={i}
            className={`mb-1 flex items-center gap-2 rounded-md px-1.5 py-1.5 ${e.overdue ? 'bg-negative-soft' : ''}`}
          >
            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-text-secondary">
              {e.date}
            </span>
            <span className="truncate text-[10.5px] text-text-secondary" title={e.label}>
              {e.label}
              {e.overdue && <span className="font-mono text-[9px] font-medium text-negative"> · OVERDUE</span>}
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <Panel title="Governance Calendar" className="flex-[4]">
      {body}
    </Panel>
  );
}
