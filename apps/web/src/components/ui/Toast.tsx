import { useEffect } from 'react';

export interface ToastProps {
  message: string;
  onDismiss: () => void;
  durationMs?: number;
}

export function Toast({ message, onDismiss, durationMs = 4000 }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [onDismiss, durationMs]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-22 left-1/2 z-50 -translate-x-1/2 rounded-2xl border-2 border-border bg-[var(--color-ink)] px-5 py-3 text-sm font-extrabold text-white shadow-lg"
    >
      {message}
    </div>
  );
}
