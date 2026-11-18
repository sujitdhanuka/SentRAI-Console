import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { AIComponent, GovernanceGap } from '../../providers';
import { useGovernanceFeatures } from '../../stores/governanceFeatures';
import { useConsoleUi } from '../../stores/consoleUi';
import { Badge } from '../ui/Badge';
import { Panel, PanelError } from '../ui/Panel';
import { SkeletonBlock } from '../ui/Skeleton';

const SEV_TONE = { HIGH: 'negative', MED: 'warning', LOW: 'accent' } as const;
const SEV_BORDER = { HIGH: 'border-l-negative', MED: 'border-l-warning', LOW: 'border-l-accent' } as const;
const SEV_RANK = { HIGH: 0, MED: 1, LOW: 2 } as const;

export function GapsQueue({
  gaps,
  components,
  scopeName,
  scopeId,
  loading,
  error,
  onRetry,
}: {
  gaps: GovernanceGap[];
  components: AIComponent[];
  /** When set, the queue is scoped to a single selected component. */
  scopeName?: string;
  /** Model id of the scoped component (filters overdue corrective actions). */
  scopeId?: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const select = useConsoleUi((s) => s.select);
  const setDrawer = useConsoleUi((s) => s.setDrawer);
  const name = (id: string) => components.find((c) => c.id === id)?.name ?? id;
  // A gap is a computed finding, not a togglable to-do: it clears only when its
  // cause is fixed. So clicking a gap opens that model's editor to remediate —
  // never a silent "close".
  const openEditor = (componentId: string) => {
    select(componentId);
    setDrawer(true);
  };
  // Governance E1.7: overdue corrective actions surface here while the register is on.
  const features = useGovernanceFeatures((s) => s.features);
  const [overdueActions, setOverdueActions] = useState<GovernanceGap[]>([]);
  useEffect(() => {
    if (!features?.correctiveActions) { setOverdueActions([]); return; }
    api<{ actions: Array<{ action_id: string; model_id: string | null; nonconformity: string; action: string }> }>('/governance/actions?overdue=true')
      .then((r) => setOverdueActions(r.actions.filter((x) => x.model_id && (!scopeId || x.model_id === scopeId)).map((x) => ({
        id: `ca-${x.action_id}`, severity: 'HIGH', componentId: x.model_id!, framework: 'Corrective action (ISO 10.2)',
        description: `${x.action} — ${x.nonconformity}`, due: 'OVERDUE',
      }))))
      .catch(() => setOverdueActions([]));
  }, [features?.correctiveActions, scopeId, gaps]);
  const sorted = [...gaps, ...overdueActions].sort((a, b) => {
    const ao = a.due === 'OVERDUE' ? 0 : 1;
    const bo = b.due === 'OVERDUE' ? 0 : 1;
    return ao - bo || SEV_RANK[a.severity] - SEV_RANK[b.severity];
  });

  let body;
  if (error) body = <PanelError onRetry={onRetry} />;
  else if (loading) body = <SkeletonBlock />;
  else if (!sorted.length)
    body = (
      <div className="p-3 text-[11px] text-text-secondary">
        {scopeName ? `No open gaps for ${scopeName}. 🎉` : 'No open gaps in scope. 🎉'}
      </div>
    );
  else
    body = (
      <div className="space-y-1.5 p-2">
        {sorted.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => openEditor(g.componentId)}
            aria-label={`Resolve this ${g.framework} gap — open ${name(g.componentId)} in the editor`}
            className={`block w-full rounded-md border border-border border-l-2 ${SEV_BORDER[g.severity]} bg-bg-elevated px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Badge tone={SEV_TONE[g.severity]}>{g.severity}</Badge>
                {!scopeName && <span className="text-[10.5px] font-medium text-text">{name(g.componentId)}</span>}
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
          </button>
        ))}
      </div>
    );

  return (
    <Panel
      title={scopeName ? `Open Gaps · ${scopeName}` : 'Open Gaps · Prioritized'}
      className="flex-[5]"
      right={!loading && !error ? <Badge tone={sorted.length ? 'negative' : 'positive'}>{sorted.length} OPEN</Badge> : undefined}
    >
      {body}
    </Panel>
  );
}
