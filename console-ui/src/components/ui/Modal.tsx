import { X } from 'lucide-react';
import { ReactNode, useEffect, useRef } from 'react';

/**
 * The one dialog shell, per SR-DL-001. A hairline-bordered plate on a plain
 * scrim — elevation reads from the border and the ground, never a drop shadow
 * (no shadow, no blur, no glass). Centralizes the overlay, Escape-to-close,
 * focus trap, and autofocus so every dialog in the console shares one chrome.
 */
const SIZES = {
  sm: 'max-w-[400px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[760px]',
  xl: 'max-w-5xl',
} as const;

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  className = '',
  bodyClassName = 'p-4',
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  size?: keyof typeof SIZES;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    setTimeout(() => el?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && el) {
        const els = [...el.querySelectorAll<HTMLElement>('input,select,textarea,button,a[href]')].filter(
          (n) => !n.hasAttribute('disabled'),
        );
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 md:p-8" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        ref={ref}
        className={`relative flex max-h-full w-full ${SIZES[size]} flex-col overflow-hidden rounded-md border border-border-strong bg-surface ${className}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="font-heading text-[13px] font-medium text-text">{title}</h2>
            {subtitle && <div className="mt-0.5 text-[10px] text-text-tertiary">{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 rounded p-1 text-text-tertiary hover:bg-surface-hover">
            <X size={15} />
          </button>
        </header>
        <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
        {footer && (
          <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">{footer}</footer>
        )}
      </div>
    </div>
  );
}
