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

/** Four chunky grade buttons labelled "Good · 3d". 2x2 grid on mobile, one row on desktop. */
export function GradeBar({
  previews,
  onGrade,
}: {
  previews: Previews;
  onGrade: (g: Grade) => void;
}) {
  const { t } = useTranslation();
  const [hotkeyGrade, setHotkeyGrade] = useState<Grade | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let targetGrade: Grade | null = null;
      if (['1', '2', '3', '4'].includes(e.key)) {
        targetGrade = Number(e.key) as Grade;
      } else if (e.key === ' ') {
        targetGrade = 3;
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
  }, []);

  return (
    <div
      role="group"
      aria-label={t('session.gradeBar')}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4"
    >
      {GRADES.map(({ grade, key, variant }) => {
        const interval = intervalLabel(previews[key], (k, o) => t(k, { ...o }));
        const label = t('grade.label', { grade: t(`grade.${key}`), interval });
        return (
          <ChunkyButton
            key={grade}
            variant={variant}
            aria-label={label}
            aria-keyshortcuts={String(grade)}
            pressed={hotkeyGrade === grade}
            onClick={() => onGrade(grade)}
            className="h-12 w-full whitespace-nowrap rounded-2xl px-2 text-[13px] sm:px-3"
          >
            <span aria-hidden="true">{label}</span>
          </ChunkyButton>
        );
      })}
    </div>
  );
}

/** Keyboard (FR-018): Space reveals, 1-4 grade, Z undoes. Ignored while typing in a field. */
export function useSessionHotkeys(opts: {
  revealed: boolean;
  onReveal: () => void;
  onGrade: (g: Grade) => void;
  onUndo: () => void;
  enabled?: boolean;
}) {
  const { revealed, onReveal, onGrade, onUndo, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' && !revealed) {
        e.preventDefault();
        onReveal();
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        onGrade(Number(e.key) as Grade);
      } else if (e.key === ' ' && revealed) {
        e.preventDefault();
        onGrade(3);
      } else if (e.key.toLowerCase() === 'z') {
        onUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, revealed, onReveal, onGrade, onUndo]);
}
