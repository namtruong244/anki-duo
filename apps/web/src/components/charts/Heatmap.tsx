import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HeatmapCell } from '@anki-duo/domain';

const SIZE = 12;
const GAP = 3;
const LEVEL_FILL = ['rgba(120,120,120,0.18)', '#bbf7d0', '#86efac', '#22c55e', '#15803d'];

/**
 * A 12-month review heatmap as SVG: weeks in columns, days in rows. It scrolls horizontally inside
 * its own container on narrow screens. Cells are keyboard-focusable with arrow-key navigation and
 * a tooltip on hover, focus and tap.
 */
export function Heatmap({ cells }: { cells: HeatmapCell[] }) {
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
    y: ((i + offset) % 7) * (SIZE + GAP),
  });
  const width = weeks * (SIZE + GAP);
  const height = 7 * (SIZE + GAP);

  return (
    <div className="relative overflow-x-auto pb-2" data-testid="heatmap">
      <svg width={width} height={height} className="block" aria-label={t('dashboard.heatmap')}>
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
              className="outline-none focus-visible:[&>rect]:stroke-[var(--color-focus,#1d4ed8)] focus-visible:[&>rect]:stroke-2"
            >
              <rect x={x} y={y} width={SIZE} height={SIZE} rx={3} fill={LEVEL_FILL[c.level]} />
            </g>
          );
        })}
      </svg>
      {tip !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-0 left-0 rounded bg-text px-2 py-1 text-xs text-bg"
          style={{ transform: `translate(${pos(tip).x}px, ${pos(tip).y + SIZE + 4}px)` }}
        >
          {label(cells[tip]!)}
        </div>
      )}
    </div>
  );
}
