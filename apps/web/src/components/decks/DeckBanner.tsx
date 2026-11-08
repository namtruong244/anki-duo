import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../ui';

export interface DeckBannerProps {
  id?: string;
  name: string;
  due: number;
  fresh: number;
  /** Kept for callers; the design meta line shows only due and new counts. */
  total?: number;
  masteredPct?: number;
  /** Picks color + icon in rotation (green, blue, gold, purple) unless `color` is given. */
  index?: number;
  color?: 'green' | 'blue' | 'gold' | 'purple';
  icon?: IconName;
  className?: string;
  /** Renders the white HỌC NGAY button as a real button when provided; otherwise a decorative span. */
  onStudy?: () => void;
}

const THEMES = {
  green: {
    card: 'bg-primary shadow-[0_4px_0_var(--color-primary-depth)]',
    text: 'text-primary-depth',
    icon: 'layers',
  },
  blue: {
    card: 'bg-secondary shadow-[0_4px_0_var(--color-secondary-depth)]',
    text: 'text-secondary-depth',
    icon: 'languages',
  },
  gold: {
    card: 'bg-gold shadow-[0_4px_0_var(--color-gold-depth)]',
    text: 'text-[var(--color-ink)]',
    icon: 'pen-tool',
  },
  purple: {
    card: 'bg-purple shadow-[0_4px_0_var(--color-purple-depth)]',
    text: 'text-purple-depth',
    icon: 'heart-pulse',
  },
} as const;
const ORDER = ['green', 'blue', 'gold', 'purple'] as const;

/** Colored deck card with lip, diagonal stripes, mastery bar and a full-width white study button. */
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
}: DeckBannerProps) {
  const { t } = useTranslation();
  const key = color ?? ORDER[index % ORDER.length]!;
  const theme = THEMES[key];
  const dark = key === 'gold';
  const fg = dark ? 'text-[var(--color-ink)]' : 'text-white';
  const pct = Math.min(100, Math.max(0, masteredPct));
  const btnCls = `flex h-12 w-full items-center justify-center rounded-2xl bg-white text-sm font-extrabold uppercase tracking-[0.06em] shadow-[0_4px_0_rgba(0,0,0,0.18)] ${theme.text}`;

  return (
    <div className={`relative overflow-hidden rounded-3xl p-6 ${fg} ${theme.card} ${className}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-10 h-80 w-40 rotate-[20deg]"
      >
        <div className="absolute left-0 h-full w-12 bg-white/10" />
        <div className="absolute left-16 h-full w-6 bg-white/10" />
      </div>

      <div className="relative z-10 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="truncate text-2xl font-black tracking-tight">{name}</h3>
            <p className="text-sm font-bold opacity-90">{t('home.deckMetaShort', { due, fresh })}</p>
          </div>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20">
            <Icon name={icon ?? theme.icon} size={28} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-[0.08em]">
            <span>{t('home.mastered')}</span>
            <span>{pct}%</span>
          </div>
          <div aria-hidden="true" className="h-3.5 w-full overflow-hidden rounded-full bg-white/30">
            <div
              className={`h-full rounded-full transition-all duration-300 ${dark ? 'bg-[var(--color-ink)]' : 'bg-white'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {onStudy ? (
          <button type="button" onClick={onStudy} className={`${btnCls} cursor-pointer`}>
            {t('home.studyNow')}
          </button>
        ) : (
          <span className={btnCls}>{t('home.studyNow')}</span>
        )}
      </div>
    </div>
  );
}
