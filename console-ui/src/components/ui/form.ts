/**
 * Shared form styling, per SR-DL-001. One source of truth for the ~30 inputs
 * and labels that were re-declaring these strings inline.
 *
 * fieldClass — hairline input on the elevated ground, with a deliberate Signal
 * focus state (accent border + 1px accent ring) layered ON TOP of the global
 * :focus-visible outline, so keyboard focus is never lost.
 * labelClass — a specification label: IBM Plex Mono, uppercase, tracked. Field
 * labels read as engineering-drawing callouts, not generic form text.
 */
export const fieldClass =
  'w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text ' +
  'placeholder:text-text-tertiary transition-colors focus:border-accent focus:ring-1 focus:ring-accent';

export const labelClass =
  'mb-1 block font-mono text-[9px] font-medium uppercase tracking-wider text-text-tertiary';
