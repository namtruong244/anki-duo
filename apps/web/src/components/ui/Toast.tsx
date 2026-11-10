import { useEffect } from 'react';
import { motion } from 'motion/react';
import { useMotionPreference } from '../../lib/motion';

export interface ToastProps {
  message: string;
  onDismiss: () => void;
  durationMs?: number;
}

export function Toast({ message, onDismiss, durationMs = 4000 }: ToastProps) {
  const motionPreference = useMotionPreference();
  const reduced = motionPreference === 'reduced';

  useEffect(() => {
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [onDismiss, durationMs]);

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={reduced ? { x: '-50%' } : { y: 16, scale: 0.94, x: '-50%' }}
      animate={{ y: 0, scale: 1, x: '-50%' }}
      transition={reduced ? { duration: 0.01 } : { type: 'spring', stiffness: 360, damping: 26 }}
      className="fixed bottom-22 left-1/2 z-50 rounded-2xl border-2 border-border bg-[var(--color-ink)] px-5 py-3 text-sm font-extrabold text-white shadow-lg"
    >
      {message}
    </motion.div>
  );
}
