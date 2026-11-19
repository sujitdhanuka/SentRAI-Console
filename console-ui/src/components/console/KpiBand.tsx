import { AIComponent, GovernanceGap, Grievance } from '../../providers';
import { Skeleton } from '../ui/Skeleton';

interface Kpi {
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
}

/** All six KPIs are computed live from the environment-scoped component set —
 *  the band visibly recomputes when the filter changes. */
export function KpiBand({
  components,
  gaps,
  grievances,
  loading,
}: {
  components: AIComponent[];
  gaps: GovernanceGap[];
  grievances: Grievance[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid shrink-0 grid-cols-3 gap-px border-b border-border bg-border lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="bg-surface p-2.5">
            <Skeleton className="mb-1.5 h-2.5 w-16" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    );
  }

  const prod = components.filter((c) => c.env === 'PROD').length;
  const checks = components.flatMap((c) => Object.values(c.frameworks));
  const okChecks = checks.filter((f) => f.status === 'ok').length;
  const applicable = checks.filter((f) => f.status !== 'na').length;
  const compliancePct = applicable ? Math.round((okChecks / applicable) * 100) : 100;
  const highGaps = gaps.filter((g) => g.severity === 'HIGH').length;
  const driftAlerts = components.filter((c) => c.drift === 'alert').length;
  const driftWarns = components.filter((c) => c.drift === 'warn').length;
  // The server applies the validators' rule (per-tier interval, attached
  // red_team reports count); fall back to 90 days only for the mock provider.
  const redteamOverdue = components.filter((c) => c.redTeamOverdue ?? c.lastRedTeamDaysAgo > (c.redTeamIntervalDays ?? 90)).length;
  const intervals = [...new Set(components.map((c) => c.redTeamIntervalDays ?? 90))];
  const redteamPolicy = intervals.length === 1 ? `>${intervals[0]} day policy` : 'per-tier interval';
  const openGrv = grievances.filter((g) => g.status === 'open').length;
  const unresolvedGrv = grievances.filter((g) => g.status !== 'resolved').length;

  const kpis: Kpi[] = [
    { label: 'AI Components', value: String(components.length), sub: `${prod} in PROD` },
    { label: 'Compliance %', value: `${compliancePct}%`, sub: `${okChecks}/${applicable} checks` },
    {
      label: 'Open Gaps',
      value: String(gaps.length),
      sub: `${highGaps} high severity`,
      valueClass: gaps.length > 0 ? 'text-negative' : 'text-positive',
    },
    {
      label: 'Drift Flags',
      value: String(driftAlerts + driftWarns),
      sub: `${driftAlerts} alert · ${driftWarns} warn`,
      valueClass: driftAlerts + driftWarns > 0 ? 'text-warning' : 'text-positive',
    },
    {
      label: 'Red-team Overdue',
      value: String(redteamOverdue),
      sub: redteamPolicy,
      valueClass: redteamOverdue > 0 ? 'text-negative' : 'text-positive',
    },
    {
      label: 'Open Grievances',
      value: String(openGrv),
      sub: `${unresolvedGrv} unresolved`,
      valueClass: unresolvedGrv > 0 ? 'text-warning' : undefined,
    },
  ];

  return (
    <div className="grid shrink-0 grid-cols-3 gap-px border-b border-border bg-border lg:grid-cols-6">
      {kpis.map((k) => (
        <div key={k.label} className="bg-surface px-3 py-2">
          <div className="font-mono text-[9px] font-medium uppercase tracking-wider text-text-tertiary">{k.label}</div>
          <div className={`font-mono text-base leading-tight ${k.valueClass ?? 'text-text'}`}>{k.value}</div>
          <div className="font-mono text-[8.5px] text-text-tertiary">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}
