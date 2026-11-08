import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HeatmapCell } from '@anki-duo/domain';

const SIZE = 9;
const GAP = 3;
const HEADER_HEIGHT = 18;
/** Level 0 follows the theme track colour; the greens are the design's fixed activity ramp. */
export const HEATMAP_LEVEL_FILL = [
  'var(--color-track)',
  '#b8f28b',
  '#89e219',
  '#58cc02',
  '#46a302',
];

export interface HeatmapProps {
  cells: HeatmapCell[];
}

/**
 * 12-month review heatmap SVG with Duolingo greens, month labels, keyboard navigation,
 * and WCAG 2.2 accessible tooltips.
 */
export function Heatmap({ cells }: HeatmapProps) {
  const { t } = useTranslation();
  const [tip, setTip] = useState<number | null>(null);
  const refs = useRef<(SVGGElement | null)[]>([]);
  const offset = cells.length ? new Date(`${cells[0]!.date}T00:00:00Z`).getUTCDay() : 0;
  const weeks = Math.ceil((cells.length + offset) / 7);
  const label = (c: HeatmapCell) => t('dashboard.heatmapCell', { date: c.date, n: c.reviews });

  const move = (i: number, key: string) => {
    const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[key];
    if (delta === undefined) return;
    const next = i + delta;
    if (next >= 0 && next < cells.length) refs.current[next]?.focus();
  };

  const pos = (i: number) => ({
    x: Math.floor((i + offset) / 7) * (SIZE + GAP),
    y: HEADER_HEIGHT + ((i + offset) % 7) * (SIZE + GAP),
  });

  const width = Math.max(weeks * (SIZE + GAP), 100);
  const height = HEADER_HEIGHT + 7 * (SIZE + GAP);

  // One label per month (T1..T12); skip a label that would sit on top of the previous one.
  const monthLabels: { month: string; x: number }[] = [];
  let lastMonth = -1;
  cells.forEach((c, i) => {
    const d = new Date(`${c.date}T00:00:00Z`);
    const m = d.getUTCMonth();
    if (m === lastMonth) return;
    lastMonth = m;
    const x = Math.floor((i + offset) / 7) * (SIZE + GAP);
    const prev = monthLabels[monthLabels.length - 1];
    if (prev && x - prev.x < 3 * (SIZE + GAP)) return;
    monthLabels.push({ month: t('dashboard.monthShort', { n: m + 1 }), x });
  });

  const tipPos = tip === null ? null : pos(tip);

  return (
    <div className="max-w-full overflow-x-auto pb-1" data-testid="heatmap">
      <div className="relative min-w-[640px] sm:min-w-0">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full"
          aria-label={t('dashboard.heatmap')}
        >
          {monthLabels.map((ml, idx) => (
            <text
              key={idx}
              x={ml.x}
              y={11}
              className="select-none fill-text-muted text-[8px] font-bold"
            >
              {ml.month}
            </text>
          ))}

          {cells.map((c, i) => {
            const { x, y } = pos(i);
            return (
              <g
                key={c.date}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role="img"
                aria-label={label(c)}
                tabIndex={i === cells.length - 1 ? 0 : -1}
                onMouseEnter={() => setTip(i)}
                onMouseLeave={() => setTip(null)}
                onFocus={() => setTip(i)}
                onBlur={() => setTip(null)}
                onClick={() => setTip(i)}
                onKeyDown={(e) => move(i, e.key)}
                className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-focus focus-visible:[&>rect]:stroke-2"
              >
                <rect
                  x={x}
                  y={y}
                  width={SIZE}
                  height={SIZE}
                  rx={2}
                  fill={HEATMAP_LEVEL_FILL[c.level]}
                />
              </g>
            );
          })}
        </svg>

        {tip !== null && tipPos && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-2.5 py-1 text-xs font-bold text-white shadow-md"
            style={{
              left: `${((tipPos.x + SIZE / 2) / width) * 100}%`,
              top: `${((tipPos.y + SIZE + 4) / height) * 100}%`,
            }}
          >
            {label(cells[tip]!)}
          </div>
        )}
      </div>
    </div>
  );
}
