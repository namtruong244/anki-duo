import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { HeatmapCell } from '@anki-duo/domain';

const SIZE = 9;
const GAP = 3;
const STEP = SIZE + GAP;
const MARGIN = 8;
const TIP_OFFSET = 6;
/** Level 0 follows the theme track colour; the greens are the design's fixed activity ramp. */
export const HEATMAP_LEVEL_FILL = [
  'var(--color-track)',
  '#BFF18E',
  '#89E219',
  '#58CC02',
  '#46A302',
];

export interface HeatmapProps {
  cells: HeatmapCell[];
}

const cellStyle = { width: SIZE, height: SIZE, borderRadius: 2 } as const;
const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/**
 * Calendar-year review heatmap (Jan-Dec): fixed 9px cells in a horizontally scrolling viewport,
 * month labels aligned to week columns, keyboard navigation and a portalled, viewport-clamped
 * tooltip so hovering never produces scrollbars.
 */
export function Heatmap({ cells }: HeatmapProps) {
  const { t } = useTranslation();
  const [tip, setTip] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const tipRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const offset = cells.length ? new Date(`${cells[0]!.date}T00:00:00Z`).getUTCDay() : 0;
  const weeks = Math.ceil((cells.length + offset) / 7);
  const trailing = cells.length ? weeks * 7 - cells.length - offset : 0;
  const width = Math.max(weeks * STEP - GAP, 0);
  let todayIdx = -1;
  cells.forEach((c, i) => {
    if (!c.future) todayIdx = i;
  });
  const label = (c: HeatmapCell) => t('dashboard.heatmapCell', { date: c.date, n: c.reviews });

  // Month label at the week column holding each month's 1st day.
  const months: { month: number; x: number }[] = [];
  cells.forEach((c, i) => {
    if (c.date.slice(8, 10) === '01') {
      months.push({
        month: Number(c.date.slice(5, 7)),
        x: Math.floor((i + offset) / 7) * STEP,
      });
    }
  });

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || todayIdx < 0) return;
    const x = Math.floor((todayIdx + offset) / 7) * STEP;
    vp.scrollLeft = Math.max(0, x + STEP - vp.clientWidth);
  }, []);

  const place = useCallback(() => {
    const cell = tip === null ? null : refs.current[tip];
    const el = tipRef.current;
    if (!cell || !el) return;
    const r = cell.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const left = Math.min(
      Math.max(r.left + r.width / 2 - w / 2, MARGIN),
      Math.max(vw - w - MARGIN, MARGIN),
    );
    let top = r.top - h - TIP_OFFSET;
    if (top < MARGIN) top = r.bottom + TIP_OFFSET;
    setCoords((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [tip]);

  useLayoutEffect(() => {
    if (tip === null) {
      setCoords(null);
      return;
    }
    place();
    const vp = viewportRef.current;
    vp?.addEventListener('scroll', place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      vp?.removeEventListener('scroll', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [tip, place]);

  const move = (i: number, key: string) => {
    const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[key];
    if (delta === undefined) return;
    const next = i + delta;
    if (next >= 0 && next < cells.length && !cells[next]!.future) refs.current[next]?.focus();
  };

  const placeholder = (key: string) => (
    <div
      key={key}
      aria-hidden="true"
      style={{ ...cellStyle, background: 'var(--color-track)', opacity: 0.45 }}
    />
  );

  return (
    <div
      ref={viewportRef}
      className="max-w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="heatmap"
      aria-label={t('dashboard.heatmap')}
    >
      <div className="flex flex-col gap-1" style={{ width }}>
        <div className="relative h-[14px]" aria-hidden="true">
          {months.map((m) => (
            <span
              key={m.month}
              className="absolute top-0 select-none text-[11px] font-extrabold leading-[14px] whitespace-nowrap text-text-muted"
              style={{ left: m.x }}
            >
              {MONTH_FMT.format(new Date(Date.UTC(2000, m.month - 1, 1)))}
            </span>
          ))}
        </div>
        <div
          className="grid"
          style={{
            gridAutoFlow: 'column',
            gridTemplateRows: `repeat(7, ${SIZE}px)`,
            gridAutoColumns: `${SIZE}px`,
            gap: GAP,
          }}
        >
          {Array.from({ length: offset }, (_, k) => placeholder(`lead-${k}`))}
          {cells.map((c, i) =>
            c.future ? (
              placeholder(`f-${c.date}`)
            ) : (
              <div
                key={c.date}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role="img"
                aria-label={label(c)}
                tabIndex={i === todayIdx ? 0 : -1}
                onMouseEnter={() => setTip(i)}
                onMouseLeave={() => setTip(null)}
                onFocus={() => setTip(i)}
                onBlur={() => setTip(null)}
                onClick={() => setTip(i)}
                onKeyDown={(e) => move(i, e.key)}
                className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1"
                style={{ ...cellStyle, background: HEATMAP_LEVEL_FILL[c.level] }}
              />
            ),
          )}
          {Array.from({ length: trailing }, (_, k) => placeholder(`trail-${k}`))}
        </div>
      </div>

      {tip !== null &&
        cells[tip] &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="pointer-events-none fixed z-[1000] whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-2.5 py-1 text-xs font-bold text-white shadow-md"
            style={{
              left: coords?.left ?? 0,
              top: coords?.top ?? 0,
              visibility: coords ? 'visible' : 'hidden',
            }}
          >
            {label(cells[tip]!)}
          </div>,
          document.body,
        )}
    </div>
  );
}
