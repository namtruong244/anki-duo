import { motion } from 'motion/react';
import { useMotionPreference } from '../../lib/motion';

export interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  tone?: 'primary' | 'secondary' | 'gold' | 'orange' | 'purple';
  className?: string;
}

const TONES: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  gold: 'bg-gold',
  orange: 'bg-orange',
  purple: 'bg-purple',
};

/** Glossy Duolingo progress bar; fills with a spring or jumps under reduced motion (FR-022). */
export function ProgressBar({
  value,
  max,
  label,
  tone = 'primary',
  className = '',
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const reduced = useMotionPreference() === 'reduced';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`h-4 w-full overflow-hidden rounded-full bg-track ${className}`}
    >
      <motion.div
        className={`relative h-full rounded-full ${TONES[tone]} after:pointer-events-none after:absolute after:inset-x-2 after:top-[3px] after:h-[3px] after:rounded-full after:bg-white/40`}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 26 }}
      />
    </div>
  );
}
