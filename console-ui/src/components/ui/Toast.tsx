import { useConsoleUi } from '../../stores/consoleUi';

const TONE_BORDER = {
  info: 'border-accent',
  positive: 'border-positive',
  negative: 'border-negative',
} as const;

export function Toasts() {
  const toasts = useConsoleUi((s) => s.toasts);
  const dismiss = useConsoleUi((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="fixed right-4 top-4 z-50 flex w-72 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`rounded-md border-l-2 ${TONE_BORDER[t.tone]} border border-border bg-bg-elevated px-3 py-2 text-left text-[11px] text-text shadow-lg`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
