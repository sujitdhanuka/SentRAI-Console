import { ReactNode } from 'react';

import { Button } from './Button';

/** Bordered surface with a slim header and an internally-scrolling body —
 *  the only places the dashboard is allowed to scroll. */
export function Panel({
  title,
  right,
  children,
  className = '',
  bodyClassName = '',
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface ${className}`}>
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <h2 className="font-heading text-[11px] font-medium uppercase tracking-wider text-text-secondary">{title}</h2>
        {right}
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function PanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="text-[11px] text-text-secondary">Couldn't load data.</p>
      <Button variant="secondary" size="xs" onClick={onRetry}>RETRY</Button>
    </div>
  );
}
