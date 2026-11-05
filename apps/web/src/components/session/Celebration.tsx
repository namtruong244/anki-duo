import { useEffect } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';

/**
 * Shown when the daily goal is crossed or the streak goes up. A spring pop with full motion, a
 * plain fade with reduced motion (FR-022). Dismisses itself.
 */
export function Celebration({
  goalMet,
  streak,
  streakIncreased,
  onDone,
  motion: preference,
}: {
  goalMet: boolean;
  streak: number;
  streakIncreased: boolean;
  onDone: () => void;
  motion: 'reduced' | 'full';
}) {
  const { t } = useTranslation();
  const show = goalMet || streakIncreased;
  useEffect(() => {
    if (!show) return;
    const id = setTimeout(onDone, 3000);
    return () => clearTimeout(id);
  }, [show, onDone]);
  if (!show) return null;
  const reduced = preference === 'reduced';
  return (
    <motion.div
      role="status"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 300, damping: 18 }}
      className="fixed inset-x-4 top-4 z-50 mx-auto max-w-sm rounded-[var(--radius-card)] bg-primary p-4 text-center font-bold text-on-primary shadow-lg"
    >
      {goalMet && <p>🎉 {t('celebration.goal')}</p>}
      {streakIncreased && <p>🔥 {t('celebration.streak', { n: streak })}</p>}
    </motion.div>
  );
}
