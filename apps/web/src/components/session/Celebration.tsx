import { useEffect } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui';

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
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: -20 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
      transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 320, damping: 20 }}
      className="fixed inset-x-4 top-4 z-50 mx-auto max-w-sm space-y-1.5 rounded-[22px] border-2 border-gold bg-gold-tint p-4 text-center font-extrabold text-text shadow-[0_6px_0_var(--color-gold-depth)]"
    >
      {goalMet && (
        <p className="flex items-center justify-center gap-2 text-sm sm:text-base">
          <Icon name="sparkles" size={18} className="shrink-0 text-gold-depth" />
          <span>{t('celebration.goal')}</span>
        </p>
      )}
      {streakIncreased && (
        <p className="flex items-center justify-center gap-2 text-sm sm:text-base">
          <Icon name="flame" size={18} className="shrink-0 text-orange" />
          <span>{t('celebration.streak', { n: streak })}</span>
        </p>
      )}
    </motion.div>
  );
}
