import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Grade } from '@anki-duo/domain';
import type { Previews } from '../../client/session/session-machine';
import { intervalLabel } from '../../lib/interval';
import { ChunkyButton } from '../ui';

const GRADES: {
  grade: Grade;
  key: 'again' | 'hard' | 'good' | 'easy';
  variant: 'danger' | 'neutral' | 'primary' | 'secondary';
}[] = [
  { grade: 1, key: 'again', variant: 'danger' },
  { grade: 2, key: 'hard', variant: 'neutral' },
  { grade: 3, key: 'good', variant: 'primary' },
  { grade: 4, key: 'easy', variant: 'secondary' },
];

/** Four grade buttons labelled "Good · 3d". Sticky, so it stays reachable under long content. */
export function GradeBar({
  previews,
  onGrade,
}: {
  previews: Previews;
  onGrade: (g: Grade) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('session.gradeBar')}
      className="sticky bottom-0 grid grid-cols-2 gap-2 bg-bg py-3 sm:grid-cols-4"
    >
      {GRADES.map(({ grade, key, variant }) => (
        <ChunkyButton
          key={grade}
          variant={variant}
          aria-keyshortcuts={String(grade)}
          onClick={() => onGrade(grade)}
        >
          {t('grade.label', {
            grade: t(`grade.${key}`),
            interval: intervalLabel(previews[key], (k, o) => t(k, { ...o })),
          })}
        </ChunkyButton>
      ))}
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
