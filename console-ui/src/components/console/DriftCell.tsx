import { DriftStatus } from '../../providers/governance';

const DRIFT = {
  ok: { text: 'OK', cls: 'text-positive' },
  warn: { text: 'WARN', cls: 'text-warning' },
  alert: { text: 'ALERT', cls: 'text-negative' },
} as const;

export function DriftCell({ drift }: { drift: DriftStatus }) {
  const d = DRIFT[drift];
  return <span className={`font-mono text-[10px] font-medium ${d.cls}`}>{d.text}</span>;
}

/** Red-team age with the policy thresholds: <=45d green, 46-90d amber, >90d red. */
export function RedTeamAge({ days }: { days: number }) {
  const cls = days <= 45 ? 'text-positive' : days <= 90 ? 'text-warning' : 'text-negative';
  return <span className={`font-mono text-[10px] ${cls}`}>{days}d</span>;
}
