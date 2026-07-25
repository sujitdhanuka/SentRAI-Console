import { ReactNode } from 'react';

/**
 * A labelled measured value, per SR-DL-001 — the console's specification-callout
 * pattern: an IBM Plex Mono uppercase label above its value. Use wherever data
 * should read like an engineering spec sheet (cards, detail blocks, summaries).
 */
export function Spec({
  label,
  value,
  valueClass = 'text-text',
}: {
  label: string;
  value: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[8px] font-medium uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className={`truncate font-mono text-[11px] ${valueClass}`}>{value}</div>
    </div>
  );
}
