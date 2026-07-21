import { Boxes, CornerDownRight, FolderGit2 } from 'lucide-react';

import { useModels } from '../api/models';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Panel } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useSession } from '../stores/session';

const RISK_TONE: Record<string, BadgeTone> = {
  LOW: 'positive', MINIMAL: 'positive', MEDIUM: 'warning', LIMITED: 'warning',
  HIGH: 'negative', CRITICAL: 'negative', PROHIBITED: 'negative',
};

/**
 * Project → model lineage. Rendered as a hierarchy rather than a force-directed
 * graph: the real relationship in the inventory is containment (a project's
 * codebase yields models), and a tree stays readable at 60+ models where a
 * node-edge canvas turns into a hairball.
 */
export function Lineage() {
  const { models, loading } = useModels();
  const { activeProjectId, activeProjectName } = useSession();

  const byStage = models.reduce<Record<string, typeof models>>((acc, m) => {
    (acc[m.lifecycle_stage] ??= []).push(m);
    return acc;
  }, {});
  const stages = ['DEPLOYED', 'MONITORING', 'VALIDATION', 'DEVELOPMENT', 'DESIGN', 'DECOMMISSIONED']
    .filter((s) => byStage[s]?.length);

  return (
    <AppShell title="Lineage Graph">
      <main className="min-h-0 flex-1 overflow-y-auto p-2">
        <Panel
          title={activeProjectId ? `Lineage · ${activeProjectName ?? 'active project'}` : 'Lineage · all projects'}
          right={<Badge tone="neutral">{models.length} model(s)</Badge>}
        >
          {loading ? (
            <SkeletonRows rows={6} />
          ) : !models.length ? (
            <p className="p-3 text-[11px] text-text-secondary">
              No models in scope. Select a project on the Projects page, or scan a codebase to discover components.
            </p>
          ) : (
            <div className="p-3">
              <div className="mb-3 flex items-center gap-2">
                <FolderGit2 size={15} className="text-accent" />
                <span className="text-[12px] font-medium text-text">
                  {activeProjectName ?? 'All projects'}
                </span>
                <span className="font-mono text-[9px] text-text-tertiary">
                  {stages.length} lifecycle stage(s) · {models.length} model(s)
                </span>
              </div>

              <div className="ml-2 border-l border-border pl-4">
                {stages.map((stage) => (
                  <div key={stage} className="mb-3 last:mb-0">
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <CornerDownRight size={12} className="text-text-tertiary" />
                      <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">{stage}</span>
                      <Badge tone="neutral">{byStage[stage].length}</Badge>
                    </div>
                    <div className="ml-5 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                      {byStage[stage].map((m) => (
                        <div key={m.model_id} className="rounded-md border border-border bg-bg-elevated px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <Boxes size={12} className="shrink-0 text-text-tertiary" />
                            <span className="truncate text-[11px] font-medium text-text" title={m.name}>{m.name}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge tone={RISK_TONE[m.risk_level] ?? 'neutral'}>{m.risk_level}</Badge>
                            <Badge tone={m.compliance_pass ? 'positive' : 'negative'}>
                              {m.compliance_pass ? 'compliant' : `${m.open_gap_count} gap(s)`}
                            </Badge>
                            <span className="truncate font-mono text-[8.5px] text-text-tertiary">
                              {m.owner_team ?? 'unassigned'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </main>
    </AppShell>
  );
}
