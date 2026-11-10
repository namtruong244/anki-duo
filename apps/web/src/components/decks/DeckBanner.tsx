import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../ui';

export interface DeckBannerProps {
  id?: string;
  name: string;
  due: number;
  fresh: number;
  /** Kept for callers; the meta line shows only due and new counts. */
  total?: number;
  masteredPct?: number;
  /** Picks color + icon in rotation (green, blue, gold, purple) unless `color` is given. */
  index?: number;
  color?: 'green' | 'blue' | 'gold' | 'purple';
  icon?: IconName;
  className?: string;
  /** Renders the study button as a real button when provided; otherwise a decorative span. */
  onStudy?: () => void;
  /** Secondary per-deck actions (icon buttons) shown before the study button. */
  actions?: ReactNode;
}

const THEMES = {
  green: {
    tile: 'bg-primary shadow-[0_3px_0_var(--color-primary-depth)] text-on-primary',
    btn: 'bg-primary shadow-[0_3px_0_var(--color-primary-depth)] text-on-primary',
    bar: 'bg-primary',
    icon: 'layers',
  },
  blue: {
    tile: 'bg-secondary shadow-[0_3px_0_var(--color-secondary-depth)] text-on-secondary',
    btn: 'bg-secondary shadow-[0_3px_0_var(--color-secondary-depth)] text-on-secondary',
    bar: 'bg-secondary',
    icon: 'languages',
  },
  gold: {
    tile: 'bg-gold shadow-[0_3px_0_var(--color-gold-depth)] text-on-gold',
    btn: 'bg-gold shadow-[0_3px_0_var(--color-gold-depth)] text-on-gold',
    bar: 'bg-gold',
    icon: 'pen-tool',
  },
  purple: {
    tile: 'bg-purple shadow-[0_3px_0_var(--color-purple-depth)] text-on-purple',
    btn: 'bg-purple shadow-[0_3px_0_var(--color-purple-depth)] text-on-purple',
    bar: 'bg-purple',
    icon: 'heart-pulse',
  },
} as const;
const ORDER = ['green', 'blue', 'gold', 'purple'] as const;

/** Compact deck row: colored icon tile, name + due/new meta + slim mastery bar, actions, study button. */
export function DeckBanner({
  name,
  due,
  fresh,
  masteredPct = 0,
  index = 0,
  color,
  icon,
  className = '',
  onStudy,
  actions,
}: DeckBannerProps) {
  const { t } = useTranslation();
  const key = color ?? ORDER[index % ORDER.length]!;
  const theme = THEMES[key];
  const pct = Math.min(100, Math.max(0, masteredPct));
  const pending = due + fresh > 0;
  const btnCls = `inline-flex h-9 shrink-0 items-center justify-center rounded-xl px-3 text-xs font-extrabold uppercase tracking-[0.06em] transition-[transform,box-shadow,filter] duration-[var(--duration-fast)] hover:brightness-105 active:translate-y-[3px] active:shadow-none ${
    pending
      ? theme.btn
      : 'border-2 border-border bg-surface text-text-muted shadow-[0_3px_0_var(--color-border)]'
  }`;

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border-2 border-border bg-[var(--color-card)] p-2.5 pr-3 transition-colors duration-[var(--duration-fast)] hover:border-nav-active-border ${className}`}
    >
      <div
        aria-hidden="true"
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${theme.tile}`}
      >
        <Icon name={icon ?? theme.icon} size={20} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="truncate text-[15px] font-extrabold leading-tight text-text" title={name}>
          {name}
        </h3>
        <div className="flex items-center gap-2">
          <p
            className={`shrink-0 text-xs font-bold ${pending ? 'text-text-muted' : 'text-text-subtle'}`}
          >
            {t('home.deckMetaShort', { due, fresh })}
          </p>
          <div
            className="flex min-w-0 flex-1 items-center gap-1.5"
            title={`${t('home.mastered')} ${pct}%`}
          >
            <div
              aria-hidden="true"
              className="h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-track"
            >
              <div
                className={`h-full rounded-full transition-all duration-300 ${theme.bar}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[11px] font-extrabold text-text-subtle">{pct}%</span>
          </div>
        </div>
      </div>

      {actions && <div className="flex shrink-0 items-center">{actions}</div>}

      {onStudy ? (
        <button type="button" onClick={onStudy} className={`${btnCls} cursor-pointer`}>
          {t('home.studyNow')}
        </button>
      ) : (
        <span className={btnCls}>{t('home.studyNow')}</span>
      )}
    </div>
  );
}
