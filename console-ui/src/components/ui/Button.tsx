import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';

/**
 * The one button, per SR-DL-001. Architectural, not decorative: Archivo label,
 * 3px radius, fixed heights for vertical rhythm, one focus ring (the global
 * :focus-visible outline), no gloss and no shadow. Every button in the console
 * routes through here so padding, type, and states stay identical everywhere.
 *
 *   variant  primary   the single Signal-Blue action (one per view)
 *            secondary hairline-bordered — the default
 *            ghost     borderless, for dense inline actions
 *            danger    outlined fail — destructive intent
 *   size     xs        inline micro-actions (Draft, Retry)
 *            sm        default toolbar/row actions
 *            md        page-level and dialog CTAs
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md';

const BASE =
  'inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-heading font-medium ' +
  'transition-colors disabled:pointer-events-none disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'border border-border-strong bg-transparent text-text hover:bg-surface-hover',
  ghost: 'bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text',
  danger: 'border border-negative bg-transparent text-negative hover:bg-negative-soft',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-5 gap-1 px-1.5 text-[9.5px]',
  sm: 'h-7 gap-1.5 px-2.5 text-[10.5px]',
  md: 'h-8 gap-1.5 px-3.5 text-[11.5px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon node; caller sizes it (e.g. <PenLine size={11} />). */
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', icon, className = '', type = 'button', children, ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
});
