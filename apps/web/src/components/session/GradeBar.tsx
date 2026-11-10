import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Grade } from '@anki-duo/domain';
import type { Previews } from '../../client/session/session-machine';
import { intervalLabel } from '../../lib/interval';
import { ChunkyButton } from '../ui';

const GRADES: {
  grade: Grade;
  key: 'again' | 'hard' | 'good' | 'easy';
  variant: 'danger' | 'gold' | 'primary' | 'secondary';
}[] = [
  { grade: 1, key: 'again', variant: 'danger' },
  { grade: 2, key: 'hard', variant: 'gold' },
  { grade: 3, key: 'good', variant: 'primary' },
  { grade: 4, key: 'easy', variant: 'secondary' },
];

/**
 * The element that really received a key. Slot widgets live in a shadow root, where
 * `event.target` is retargeted to the host `div`, so the composed path is the reliable source.
 */
function keyOrigin(e: KeyboardEvent): HTMLElement | null {
  return (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
}

/** Keys typed in a field never act on the session (FR-011). */
const isField = (el: HTMLElement | null) =>
  !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Enter on a focused control already activates it natively; it must not also confirm. */
const isControl = (el: HTMLElement | null) => !!el && /^(BUTTON|A|SUMMARY)$/.test(el.tagName);

/**
 * Four chunky grade buttons labelled "Good · 3d". 2x2 grid on mobile, one row on desktop.
 * `suggested` (from an answer check) gets a visible ring and a text badge; Space and Enter
 * confirm it (see `useSessionHotkeys`).
 */
export function GradeBar({
  previews,
  onGrade,
  suggested,
}: {
  previews: Previews;
  onGrade: (g: Grade) => void;
  suggested?: 1 | 2 | 3 | null;
}) {
  const { t } = useTranslation();
  const [hotkeyGrade, setHotkeyGrade] = useState<Grade | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = keyOrigin(e);
      if (isField(el)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let targetGrade: Grade | null = null;
      if (['1', '2', '3', '4'].includes(e.key)) {
        targetGrade = Number(e.key) as Grade;
      } else if (e.key === ' ') {
        targetGrade = suggested ?? 3;
      } else if (e.key === 'Enter' && suggested && !isControl(el)) {
        targetGrade = suggested;
      }
      if (targetGrade !== null) {
        setHotkeyGrade(targetGrade);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          setHotkeyGrade(null);
        }, 140);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (timer) clearTimeout(timer);
    };
  }, [suggested]);

  return (
    <div
      role="group"
      aria-label={t('session.gradeBar')}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4"
    >
      {GRADES.map(({ grade, key, variant }) => {
        const interval = intervalLabel(previews[key], (k, o) => t(k, { ...o }));
        const label = t('grade.label', { grade: t(`grade.${key}`), interval });
        const isSuggested = suggested === grade;
        return (
          <div key={grade} className="relative">
            {isSuggested && (
              <span
                id={`grade-suggested-${grade}`}
                className="pointer-events-none absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-text px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-bg"
              >
                {t('session.suggested')}
              </span>
            )}
            <ChunkyButton
              variant={variant}
              aria-label={label}
              aria-keyshortcuts={isSuggested ? `${grade} Space Enter` : String(grade)}
              aria-describedby={isSuggested ? `grade-suggested-${grade}` : undefined}
              data-suggested={isSuggested ? 'true' : undefined}
              pressed={hotkeyGrade === grade}
              onClick={() => onGrade(grade)}
              className={`h-12 w-full whitespace-nowrap rounded-2xl px-2 text-[13px] sm:px-3${
                isSuggested ? ' ring-4 ring-text ring-offset-2 ring-offset-bg' : ''
              }`}
            >
              <span aria-hidden="true">{label}</span>
            </ChunkyButton>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Keyboard (FR-018): Space reveals, 1-4 grade, Z undoes. With a `suggested` grade, Space and
 * Enter confirm it instead of Good. While `continuing` (auto-graded back), Space/Enter call
 * `onContinue`. Keys that originate in a field never act (FR-011), so the Enter that submits a
 * type-in answer cannot also confirm the suggestion that answer produces.
 */
export function useSessionHotkeys(opts: {
  revealed: boolean;
  onReveal: () => void;
  onGrade: (g: Grade) => void;
  onUndo: () => void;
  enabled?: boolean;
  suggested?: 1 | 2 | 3 | null;
  continuing?: boolean;
  onContinue?: () => void;
}) {
  const {
    revealed,
    onReveal,
    onGrade,
    onUndo,
    enabled = true,
    suggested = null,
    continuing = false,
    onContinue,
  } = opts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = keyOrigin(e);
      if (isField(el)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (continuing) {
        if (e.key === ' ' || (e.key === 'Enter' && !isControl(el))) {
          e.preventDefault();
          onContinue?.();
        } else if (e.key.toLowerCase() === 'z') {
          onUndo();
        }
        return;
      }
      if (e.key === 'Enter' && revealed && suggested && !isControl(el)) {
        e.preventDefault();
        onGrade(suggested);
      } else if (e.key === ' ' && !revealed) {
        e.preventDefault();
        onReveal();
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        onGrade(Number(e.key) as Grade);
      } else if (e.key === ' ' && revealed) {
        e.preventDefault();
        onGrade(suggested ?? 3);
      } else if (e.key.toLowerCase() === 'z') {
        onUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, revealed, onReveal, onGrade, onUndo, suggested, continuing, onContinue]);
}
