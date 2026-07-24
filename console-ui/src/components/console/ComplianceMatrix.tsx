import { AlertTriangle, Eye } from 'lucide-react';
import { KeyboardEvent } from 'react';

import { AIComponent, GovernanceGap } from '../../providers';
import { EnvFilter, useConsoleUi } from '../../stores/consoleUi';
import { Badge } from '../ui/Badge';
import { Panel, PanelError } from '../ui/Panel';
import { SkeletonRows } from '../ui/Skeleton';
import { DriftCell, RedTeamAge } from './DriftCell';
import { StatusCell } from './StatusCell';

const ENV_TONE = { PROD: 'positive', STAGING: 'warning', DEV: 'accent' } as const;
const TIER_TONE = { Low: 'positive', Medium: 'warning', High: 'negative' } as const;

const TH = 'sticky top-0 z-10 bg-surface px-2 py-1.5 text-left text-[9px] font-medium uppercase tracking-widest text-text-tertiary border-b border-border';
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
            <th className={`${TH} text-center`}>RBI FREE-AI</th>
            <th className={`${TH} text-center`}>NIST RMF</th>
            <th className={`${TH} text-center`}>EU AI Act</th>
            <th className={`${TH} text-center`}>ISO 42001</th>
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
                <td className={TD}><Badge tone={TIER_TONE[c.riskTier]}>{c.riskTier}</Badge></td>
                <td className={`${TD} text-center`}><StatusCell check={c.frameworks.rbi} framework="RBI FREE-AI" /></td>
                <td className={`${TD} text-center`}><StatusCell check={c.frameworks.nist} framework="NIST RMF" /></td>
                <td className={`${TD} text-center`}><StatusCell check={c.frameworks.eu} framework="EU AI Act" /></td>
                <td className={`${TD} text-center`}><StatusCell check={c.frameworks.iso} framework="ISO 42001" /></td>
                <td className={`${TD} text-center`}>
                  {c.humanOversight ? (
                    <Eye size={13} className="inline text-positive" aria-label="Human oversight required" />
                  ) : (
                    <span className="font-mono text-[9px] text-text-tertiary" title={c.autonomousScope ?? 'autonomous'}>AUTO</span>
                  )}
                </td>
                <td className={TD}><DriftCell drift={c.drift} /></td>
                <td className={TD}><RedTeamAge days={c.lastRedTeamDaysAgo} /></td>
                <td className={TD}>
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
