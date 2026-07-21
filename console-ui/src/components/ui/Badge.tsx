import { ReactNode } from 'react';

export type BadgeTone = 'positive' | 'negative' | 'warning' | 'purple' | 'accent' | 'neutral';

const TONES: Record<BadgeTone, string> = {
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  warning: 'bg-warning-soft text-warning',
  purple: 'bg-purple-soft text-purple',
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-surface-hover text-text-secondary',
};

export function Badge({ tone, children, title }: { tone: BadgeTone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
