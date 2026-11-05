import { motion as m } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { PathNode as Node } from '@anki-duo/domain';

const ICON: Record<Node['status'], string> = {
  completed: '✓',
  available: '★',
  in_progress: '▶',
  locked: '🔒',
};
const TONE: Record<Node['status'], string> = {
  completed: 'bg-success text-white border-success',
  available: 'bg-primary text-white border-primary',
  in_progress: 'bg-primary text-white border-primary',
  locked: 'bg-neutral text-text-muted border-border',
};

interface Props {
  node: Node;
  /** 1-based position shown to the learner. */
  position: number;
  current: boolean;
  motion: 'reduced' | 'full';
  justUnlocked: boolean;
  onPress: () => void;
}

/** One round node: icon, text state and mastery ring, so state never depends on colour alone. */
export function PathNode({ node, position, current, motion, justUnlocked, onPress }: Props) {
  const { t } = useTranslation();
  const status = t(`path.status.${node.status}`);
  const pct = Math.round(node.mastery * 100);
  const R = 34;
  const C = 2 * Math.PI * R;
  const unlock = justUnlocked ? (motion === 'reduced' ? 'fade' : 'spring') : undefined;

  const initial = !justUnlocked
    ? false
    : motion === 'reduced'
      ? { opacity: 0 }
      : { scale: 0.6, opacity: 0.4 };
  const animate =
    current && motion === 'full' && !justUnlocked ? { y: [0, -4, 0] } : { scale: 1, opacity: 1 };
  const transition =
    current && motion === 'full' && !justUnlocked
      ? { repeat: Infinity, duration: 2.4 }
      : motion === 'reduced'
        ? { duration: 0.4 }
        : { type: 'spring' as const, stiffness: 260, damping: 14 };

  return (
    <m.button
      type="button"
      onClick={onPress}
      aria-label={`${t('path.node', { n: position })}, ${status}, ${t('path.mastery', { pct })}`}
      aria-current={current ? 'step' : undefined}
      data-status={node.status}
      data-unlock={unlock}
      initial={initial}
      animate={animate}
      transition={transition}
      className="relative flex h-24 w-24 flex-col items-center justify-center rounded-full"
    >
      <svg viewBox="0 0 80 80" aria-hidden className="absolute inset-0 h-full w-full -rotate-90">
        <circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="5"
        />
        <circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${node.mastery * C} ${C}`}
        />
      </svg>
      <span
        className={`flex h-16 w-16 flex-col items-center justify-center rounded-full border-b-4 ${TONE[node.status]}`}
      >
        <span aria-hidden className="text-xl leading-none">
          {ICON[node.status]}
        </span>
        <span className="text-xs font-bold">{pct}%</span>
      </span>
      <span className="sr-only">{status}</span>
    </m.button>
  );
}
