import { AlertTriangle, Eye } from 'lucide-react';
import { KeyboardEvent } from 'react';

import { AIComponent, FRAMEWORK_COLUMNS, frameworkInScope, FrameworkCheck, GovernanceGap } from '../../providers';
import { EnvFilter, useConsoleUi } from '../../stores/consoleUi';
import { Badge } from '../ui/Badge';
import { Panel, PanelError } from '../ui/Panel';
import { SkeletonRows } from '../ui/Skeleton';
import { DriftCell, RedTeamAge } from './DriftCell';
import { StatusCell } from './StatusCell';

const ENV_TONE = { PROD: 'positive', STAGING: 'warning', DEV: 'accent' } as const;
const TIER_TONE = { Low: 'positive', Medium: 'warning', High: 'negative' } as const;
const DRIFT_TITLE = { ok: 'no drift detected', warn: 'warning — investigate', alert: 'alert — retrain / breaker armed' } as const;

// Hover tooltips spell out the real value behind each icon/abbreviation.
const fwTitle = (label: string, check: FrameworkCheck) =>
  check.status === 'ok'
    ? `${label}: ${check.evidenceUrl ? 'Checks pass — evidence attached (not a compliance assessment)' : 'Checks pass, no evidence — attach an artifact'}`
    : check.status === 'gap'
      ? `${label}: Gap — control not satisfied`
      : `${label}: Not applicable`;

const TH = 'sticky top-0 z-10 bg-surface px-2 py-1.5 text-left font-mono text-[9px] font-medium uppercase tracking-wider text-text-tertiary border-b border-border';
const TD = 'px-2 py-1.5 align-middle';

export function ComplianceMatrix({
  components,
  gaps,
  env,
  selectedId,
  loading,
  error,
  onRetry,
}: {
  components: AIComponent[];
  gaps: GovernanceGap[];
  env: EnvFilter;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const select = useConsoleUi((s) => s.select);
  // A framework column shows only while its pack is enabled for at least one listed model.
  const columns = FRAMEWORK_COLUMNS.filter((f) => !components.length || components.some((c) => frameworkInScope(c, f.key)));
  const gapCount = (id: string) => gaps.filter((g) => g.componentId === id).length;

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, id: string, idx: number) => {
    if (e.key === 'Enter') { select(id); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = components[e.key === 'ArrowDown' ? idx + 1 : idx - 1];
      if (next) {
        select(next.id);
        (e.currentTarget.parentElement?.children[e.key === 'ArrowDown' ? idx + 1 : idx - 1] as HTMLElement)?.focus();
      }
    }
  };

  let body;
  if (error) body = <PanelError onRetry={onRetry} />;
  else if (loading) body = <SkeletonRows rows={8} />;
  else if (!components.length)
    body = (
      <div className="flex h-full items-center justify-center">
        <p className="rounded-md border border-border bg-bg-elevated px-6 py-4 text-[11px] text-text-secondary">
          No AI components in {env}
        </p>
      </div>
    );
  else
    body = (
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className={TH}>Component</th>
            <th className={TH}>Env</th>
            <th className={TH}>Risk Tier</th>
            {columns.map((f) => <th key={f.key} className={`${TH} text-center`}>{f.label}</th>)}
            <th className={`${TH} text-center`}>Oversight</th>
            <th className={TH}>Drift</th>
            <th className={TH}>Red-team</th>
            <th className={TH}>Gaps</th>
          </tr>
        </thead>
        <tbody>
          {components.map((c, idx) => {
            const selected = c.id === selectedId;
            const gc = gapCount(c.id);
            return (
              <tr
                key={c.id}
                tabIndex={0}
                aria-selected={selected}
                onClick={() => select(c.id)}
                onKeyDown={(e) => onKey(e, c.id, idx)}
                className={`cursor-pointer border-b border-border transition-colors ${
                  selected ? 'bg-accent-soft' : 'hover:bg-surface-hover'
                }`}
              >
                <td className={`${TD} ${selected ? 'border-l-2 border-l-accent' : 'border-l-2 border-l-transparent'}`}>
                  <div className="font-medium text-text">{c.name}</div>
                  <div className="font-mono text-[9px] text-text-tertiary">{c.model} · {c.version}</div>
                </td>
                <td className={TD}><Badge tone={ENV_TONE[c.env]}>{c.env}</Badge></td>
                <td className={TD} title={`Risk tier: ${c.riskTier}${c.riskRationale ? ` — ${c.riskRationale}` : ''}`}><Badge tone={TIER_TONE[c.riskTier]}>{c.riskTier}</Badge></td>
                {columns.map((f) => (
                  <td key={f.key} className={`${TD} text-center`} title={frameworkInScope(c, f.key) ? fwTitle(f.label, c.frameworks[f.key]) : `${f.label}: pack switched off for this model's organisation (Governance › Setup)`}>
                    <StatusCell check={c.frameworks[f.key]} framework={f.label} />
                  </td>
                ))}
                <td
                  className={`${TD} text-center`}
                  title={c.humanOversight ? 'Oversight: human-in-the-loop required' : `Oversight: autonomous${c.autonomousScope ? ` — ${c.autonomousScope}` : ''}`}
                >
                  {c.humanOversight ? (
                    <Eye size={13} className="inline text-positive" aria-label="Human oversight required" />
                  ) : (
                    <span className="font-mono text-[9px] text-text-tertiary">AUTO</span>
                  )}
                </td>
                <td className={TD} title={`Drift: ${DRIFT_TITLE[c.drift]}`}><DriftCell drift={c.drift} /></td>
                <td
                  className={TD}
                  title={c.lastRedTeamDaysAgo >= 9999 ? 'Red-team: never performed' : `Red-team: last performed ${c.lastRedTeamDaysAgo} days ago (policy ≤ ${c.redTeamIntervalDays ?? 90}d for ${c.riskTier} risk)`}
                >
                  <RedTeamAge days={c.lastRedTeamDaysAgo} interval={c.redTeamIntervalDays} />
                </td>
                <td className={TD} title={gc > 0 ? `${gc} open governance gap${gc === 1 ? '' : 's'}` : 'No open gaps'}>
                  {gc > 0 ? (
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] font-medium text-negative">
                      <AlertTriangle size={11} /> {gc}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-positive">0</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );

  return (
    <Panel title="Compliance Matrix" className="flex-1" bodyClassName="overscroll-contain">
      {body}
    </Panel>
  );
}
