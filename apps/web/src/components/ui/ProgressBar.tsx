import { motion } from 'motion/react';
import { useMotionPreference } from '../../lib/motion';

export interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  className?: string;
}

/** Fills with a spring; with reduced motion it just jumps (FR-022). */
export function ProgressBar({ value, max, label, className = '' }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const reduced = useMotionPreference() === 'reduced';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`h-4 w-full overflow-hidden rounded-full bg-neutral ${className}`}
    >
      <motion.div
        className="h-full rounded-full bg-primary"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 26 }}
      />
    </div>
  );
}
