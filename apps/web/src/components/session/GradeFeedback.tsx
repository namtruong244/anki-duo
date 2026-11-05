import { motion } from 'motion/react';
import type { Grade } from '@anki-duo/domain';

/**
 * One small pulse after every grade. It is the same for all four grades: Again gets no "mistake"
 * cue (FR-021, FR-024). `token` changes per grade so the pulse replays.
 */
export function GradeFeedback({
  token,
  motion: preference,
}: {
  token: number;
  grade?: Grade | null;
  motion: 'reduced' | 'full';
}) {
  if (token === 0 || preference === 'reduced') return null;
  return (
    <motion.span
      key={token}
      aria-hidden="true"
      className="pointer-events-none fixed bottom-28 left-1/2 -ml-3 size-6 rounded-full bg-primary"
      initial={{ opacity: 0.8, scale: 0.4, y: 0 }}
      animate={{ opacity: 0, scale: 1.6, y: -40 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
    />
  );
}
