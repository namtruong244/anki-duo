import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useMotionPreference } from '../../lib/motion';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** `xl` is the 1152px editor surface, which also turns off the default padding. */
  size?: 'md' | 'xl';
  /** Custom header content; the accessible title is still rendered for screen readers. */
  header?: ReactNode;
}

/** A modal dialog: labelled, traps focus, closes on Escape, restores focus on close. */
export function Dialog({ open, title, onClose, children, size = 'md', header }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const motionPreference = useMotionPreference();
  const reduced = motionPreference === 'reduced';

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <motion.div
      initial={reduced ? { opacity: 1 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0.01 } : { duration: 0.15 }}
      className={`fixed inset-0 z-50 flex items-end justify-center overscroll-contain bg-black/55 backdrop-blur-[2px] sm:items-center sm:p-4 ${
        size === 'xl' ? 'p-0' : 'p-4'
      }`}
    >
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        initial={reduced ? false : { scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        transition={reduced ? { duration: 0.01 } : { type: 'spring', stiffness: 360, damping: 28 }}
        className={`w-full ${size === 'xl' ? 'max-h-[100dvh] max-w-[1152px] overflow-y-auto rounded-none sm:max-h-[92vh] sm:rounded-[var(--radius-banner)]' : 'max-w-md rounded-3xl p-6'} overscroll-contain border-2 border-border bg-[var(--color-card)] text-text shadow-[0_8px_0_var(--color-border)]`}
      >
        <h2 id={titleId} className={header ? 'sr-only' : 'mb-4 text-xl font-black tracking-tight'}>
          {title}
        </h2>
        {header}
        {children}
      </motion.div>
    </motion.div>
  );
}
