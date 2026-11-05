import { useTranslation } from 'react-i18next';
import type { StreakStatus } from '@anki-duo/domain';

const ICON: Record<StreakStatus, string> = { met: '🔥', at_risk: '🔥', broken: '❄️' };

/** The streak count with a flame. State is conveyed by text as well as colour (WCAG). */
export function StreakFlame({ count, status }: { count: number; status: StreakStatus }) {
  const { t } = useTranslation();
  const note =
    status === 'met'
      ? t('home.streakMet')
      : status === 'at_risk'
        ? t('home.streakAtRisk')
        : t('home.streakBroken');
  return (
    <div
      data-testid="streak"
      data-status={status}
      className={`flex items-center gap-3 rounded-[var(--radius-card)] border p-4 ${status === 'at_risk' ? 'border-danger' : 'border-border'} bg-surface`}
    >
      <span aria-hidden="true" className={`text-4xl ${status === 'broken' ? 'opacity-60' : ''}`}>
        {ICON[status]}
      </span>
      <div>
        <p className="text-xl font-bold">{t('home.streak', { n: count })}</p>
        <p
          className={`text-sm ${status === 'at_risk' ? 'font-semibold text-danger' : 'text-text-muted'}`}
        >
          {note}
        </p>
      </div>
    </div>
  );
}
