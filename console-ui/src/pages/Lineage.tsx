import { Boxes, CornerDownRight, FolderGit2 } from 'lucide-react';

import { useModels } from '../api/models';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { FigurePlate, PLATE } from '../components/ui/FigurePlate';
import { Panel } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useSession } from '../stores/session';

const PROD_STAGES = new Set(['DEPLOYED', 'MONITORING']);

/** A blueprint schematic of the estate → its lifecycle stages, derived from the
 *  real inventory. Production stages carry white 2px stroke (emphasis by weight,
 *  not colour, per SR-DL-001). */
function GovernanceGraph({ stages, byStage, total }: { stages: string[]; byStage: Record<string, unknown[]>; total: number }) {
  const top = 20, stageH = 34, gap = 16, stageX = 430, stageW = 200, estateX = 110, estateR = 26;
  // Floor keeps the estate node + its label from clipping when few stages exist.
  const H = Math.max(112, top * 2 + stages.length * stageH + Math.max(0, stages.length - 1) * gap);
  const midY = H / 2;
  const stageY = (i: number) => top + stageH / 2 + i * (stageH + gap);
  return (
    <svg viewBox={`0 0 760 ${H}`} className="w-full" style={{ height: H }} role="img" aria-label="Governance graph: estate to lifecycle stages">
      {stages.map((s, i) => (
        <line key={`e-${s}`} x1={estateX + estateR} y1={midY} x2={stageX} y2={stageY(i)} stroke={PLATE.dim} strokeWidth={1} />
      ))}
      <circle cx={estateX} cy={midY} r={estateR} fill="none" stroke={PLATE.line} strokeWidth={1.5} />
      <circle cx={estateX} cy={midY} r={estateR - 6} fill="none" stroke={PLATE.line} strokeWidth={1} opacity={0.4} />
      <text x={estateX} y={midY + 4} textAnchor="middle" fontFamily="IBM Plex Mono" fontSize={13} fill={PLATE.white}>{total}</text>
      <text x={estateX} y={midY + estateR + 16} textAnchor="middle" fontFamily="IBM Plex Mono" fontSize={10} fill={PLATE.line} letterSpacing={1}>ORG ESTATE</text>
      {stages.map((s, i) => {
        const y = stageY(i), prod = PROD_STAGES.has(s);
        return (
          <g key={s}>
            <rect x={stageX} y={y - stageH / 2} width={stageW} height={stageH} rx={3} fill="none" stroke={prod ? PLATE.white : PLATE.line} strokeWidth={prod ? 2 : 1.5} />
            <text x={stageX + 12} y={y + 4} fontFamily="IBM Plex Mono" fontSize={10.5} fill={prod ? PLATE.white : PLATE.line} letterSpacing={0.5}>{s}</text>
            <text x={stageX + stageW - 12} y={y + 4} textAnchor="end" fontFamily="IBM Plex Mono" fontSize={11} fill={PLATE.line}>{(byStage[s] ?? []).length}</text>
          </g>
        );
      })}
    </svg>
  );
}

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
              <div className="mb-4">
                <FigurePlate
                  fig="9.1"
                  title="Governance Graph"
                  fields={[
                    { label: 'STYLE', value: 'Blueprint' },
                    { label: 'REV', value: '1.0' },
                    { label: 'REF', value: 'P3' },
                  ]}
                  caption="Estate → lifecycle stage, from the live inventory. Production stages (deployed, monitoring) are drawn in white — emphasis is carried by stroke weight, not colour."
                >
                  <GovernanceGraph stages={stages} byStage={byStage} total={models.length} />
                </FigurePlate>
              </div>

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
                            <a href={`#/model?id=${encodeURIComponent(m.model_id)}`} className="truncate text-[11px] font-medium text-text hover:text-accent hover:underline" title={`Open the model page for ${m.name}`}>{m.name}</a>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge tone={RISK_TONE[m.risk_level] ?? 'neutral'}>{m.risk_level}</Badge>
                            <Badge tone={m.compliance_pass ? 'positive' : 'negative'}>
                              {m.compliance_pass ? 'no gaps' : `${m.open_gap_count} gap(s)`}
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
