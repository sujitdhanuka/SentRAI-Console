import { DriftStatus } from '../../providers';

const DRIFT = {
  ok: { text: 'OK', cls: 'text-positive' },
  warn: { text: 'WARN', cls: 'text-warning' },
  alert: { text: 'ALERT', cls: 'text-negative' },
} as const;

export function DriftCell({ drift }: { drift: DriftStatus }) {
  const d = DRIFT[drift];
  return <span className={`font-mono text-[10px] font-medium ${d.cls}`}>{d.text}</span>;
}

/** Red-team age against the tier's interval: first half green, second half
 *  amber, past the interval red. */
export function RedTeamAge({ days, interval = 90 }: { days: number; interval?: number }) {
  if (days >= 9999) return <span className="font-mono text-[10px] text-negative">never</span>;
  const cls = days <= interval / 2 ? 'text-positive' : days <= interval ? 'text-warning' : 'text-negative';
  return <span className={`font-mono text-[10px] ${cls}`}>{days}d</span>;
}
