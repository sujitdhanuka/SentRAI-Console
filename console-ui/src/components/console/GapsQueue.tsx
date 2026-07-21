import { AIComponent, GovernanceGap } from '../../providers';
import { Badge } from '../ui/Badge';
import { Panel, PanelError } from '../ui/Panel';
import { SkeletonBlock } from '../ui/Skeleton';

const SEV_TONE = { HIGH: 'negative', MED: 'warning', LOW: 'accent' } as const;
const SEV_BORDER = { HIGH: 'border-l-negative', MED: 'border-l-warning', LOW: 'border-l-accent' } as const;
const SEV_RANK = { HIGH: 0, MED: 1, LOW: 2 } as const;

export function GapsQueue({
  gaps,
  components,
  loading,
  error,
  onRetry,
}: {
  gaps: GovernanceGap[];
  components: AIComponent[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const name = (id: string) => components.find((c) => c.id === id)?.name ?? id;
  const sorted = [...gaps].sort((a, b) => {
    const ao = a.due === 'OVERDUE' ? 0 : 1;
    const bo = b.due === 'OVERDUE' ? 0 : 1;
    return ao - bo || SEV_RANK[a.severity] - SEV_RANK[b.severity];
  });

  let body;
  if (error) body = <PanelError onRetry={onRetry} />;
  else if (loading) body = <SkeletonBlock />;
  else if (!sorted.length) body = <div className="p-3 text-[11px] text-text-secondary">No open gaps in scope. 🎉</div>;
  else
    body = (
      <div className="space-y-1.5 p-2">
        {sorted.map((g) => (
          <div key={g.id} className={`rounded-md border border-border border-l-2 ${SEV_BORDER[g.severity]} bg-bg-elevated px-2.5 py-2`}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Badge tone={SEV_TONE[g.severity]}>{g.severity}</Badge>
                <span className="text-[10.5px] font-medium text-text">{name(g.componentId)}</span>
              </span>
              <span
                className={`rounded border px-1 py-0.5 font-mono text-[9px] ${
                  g.due === 'OVERDUE' ? 'border-negative text-negative' : 'border-border text-text-secondary'
                }`}
              >
                {g.due}
              </span>
            </div>
            <p className="truncate text-[10.5px] text-text-secondary" title={g.description}>{g.description}</p>
            <div className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-text-tertiary">{g.framework}</div>
          </div>
        ))}
      </div>
    );

  return (
    <Panel
      title="Open Gaps · Prioritized"
      className="flex-[5]"
      right={!loading && !error ? <Badge tone={sorted.length ? 'negative' : 'positive'}>{sorted.length} OPEN</Badge> : undefined}
    >
      {body}
    </Panel>
  );
}
