import { useTranslation } from 'react-i18next';
import type { DonutCounts, Segment } from '@anki-duo/domain';

/** Class names are written out in full so Tailwind can see them. */
export const DONUT_ORDER: { key: Segment; stroke: string; dot: string }[] = [
  { key: 'new', stroke: 'stroke-secondary', dot: 'bg-secondary' },
  { key: 'learning', stroke: 'stroke-orange', dot: 'bg-orange' },
  { key: 'due', stroke: 'stroke-danger', dot: 'bg-danger' },
  { key: 'notDue', stroke: 'stroke-primary', dot: 'bg-primary' },
  { key: 'suspended', stroke: 'stroke-text-subtle', dot: 'bg-text-subtle' },
];

const R = 40;
const C = 2 * Math.PI * R;

export interface DonutRingProps {
  counts: DonutCounts;
  /** Number shown in the middle of the ring; defaults to the total of all segments. */
  centre?: number;
}

/**
 * Hand-built SVG donut (design "Phân bố trạng thái thẻ"): ring left, legend right.
 * Every segment has a text label and number in the legend, so the chart never relies on colour alone.
 */
export function DonutRing({ counts, centre }: DonutRingProps) {
  const { t } = useTranslation();
  const total = DONUT_ORDER.reduce((n, s) => n + counts[s.key], 0);
  let offset = 0;

  return (
    <div className="flex items-center gap-5 sm:gap-8">
      <div className="relative h-32 w-32 shrink-0 sm:h-44 sm:w-44">
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label={t('dashboard.donutLabel', { n: total })}
          className="h-full w-full -rotate-90 transform"
        >
          <circle cx="50" cy="50" r={R} fill="none" className="stroke-track" strokeWidth="14" />
          {total > 0 &&
            DONUT_ORDER.map(({ key, stroke }) => {
              const len = (counts[key] / total) * C;
              const el =
                len > 0 ? (
                  <circle
                    key={key}
                    cx="50"
                    cy="50"
                    r={R}
                    fill="none"
                    className={stroke}
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
          className="absolute inset-0 flex select-none flex-col items-center justify-center text-center"
        >
          <span className="text-3xl font-black tabular-nums tracking-tight text-text sm:text-4xl">
            {centre ?? total}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted sm:text-xs">
            {t('dashboard.centreLabel')}
          </span>
        </div>
      </div>

      <ul aria-label={t('dashboard.donut')} className="flex min-w-0 flex-1 flex-col gap-2.5">
        {DONUT_ORDER.map(({ key, dot }) => (
          <li key={key} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={`inline-block h-3 w-3 shrink-0 rounded-full ${dot}`}
              />
              <span className="truncate font-bold text-text">{t(`dashboard.${key}`)}</span>
            </div>
            {/* CRITICAL CONTRACT: only span.font-bold inside li for e2e test query */}
            <span className="font-bold tabular-nums text-text">{counts[key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
