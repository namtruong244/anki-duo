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
      className="pointer-events-none fixed bottom-28 left-1/2 -ml-4 size-8 rounded-full border-2 border-primary bg-primary/25 backdrop-blur-[2px]"
      initial={{ opacity: 0.9, scale: 0.4, y: 0 }}
      animate={{ opacity: 0, scale: 2.2, y: -48 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
    />
  );
}
