import { useTranslation } from 'react-i18next';
import type { DonutCounts, Segment } from '@anki-duo/domain';

const ORDER: { key: Segment; color: string }[] = [
  { key: 'new', color: 'var(--color-primary, #1d4ed8)' },
  { key: 'learning', color: '#b45309' },
  { key: 'due', color: '#b91c1c' },
  { key: 'notDue', color: '#15803d' },
  { key: 'suspended', color: '#6b7280' },
];

const R = 40;
const C = 2 * Math.PI * R;

/**
 * Hand-built SVG donut. Every segment also has a text label with its number in the legend, so
 * the chart never relies on colour alone (FR-033). The centre shows today's workload.
 */
export function DonutRing({ counts, centre }: { counts: DonutCounts; centre: number }) {
  const { t } = useTranslation();
  const total = ORDER.reduce((n, s) => n + counts[s.key], 0);
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative h-40 w-40 shrink-0">
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label={t('dashboard.donutLabel', { n: total })}
          className="h-full w-full -rotate-90"
        >
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.1"
            strokeWidth="14"
          />
          {total > 0 &&
            ORDER.map(({ key, color }) => {
              const len = (counts[key] / total) * C;
              const el =
                len > 0 ? (
                  <circle
                    key={key}
                    cx="50"
                    cy="50"
                    r={R}
                    fill="none"
                    stroke={color}
                    strokeWidth="14"
                    strokeDasharray={`${len} ${C - len}`}
                    strokeDashoffset={-offset}
                  />
                ) : null;
              offset += len;
              return el;
            })}
        </svg>
        <div
          data-testid="donut-centre"
          className="absolute inset-0 flex flex-col items-center justify-center text-center"
        >
          <span className="text-3xl font-bold tabular-nums">{centre}</span>
          <span className="text-xs text-text-muted">{t('dashboard.centreLabel')}</span>
        </div>
      </div>
      <ul aria-label={t('dashboard.donut')} className="flex flex-col gap-1">
        {ORDER.map(({ key, color }) => (
          <li key={key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: color }}
            />
            <span>{t(`dashboard.${key}`)}</span>
            <span className="font-bold tabular-nums">{counts[key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
