import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Grade } from '@anki-duo/domain';
import type { ReviewedCard } from '../../client/session/session-machine';
import { intervalLabel } from '../../lib/interval';
import { ChunkyButton, Icon } from '../ui';

const GRADE_STYLE: Record<Grade, { key: 'again' | 'hard' | 'good' | 'easy'; cls: string }> = {
  1: { key: 'again', cls: 'bg-danger text-white' },
  2: { key: 'hard', cls: 'bg-gold text-[var(--color-ink)]' },
  3: { key: 'good', cls: 'bg-primary text-white' },
  4: { key: 'easy', cls: 'bg-secondary text-white' },
};

/** Plain-text preview of a card side: markdown and media tokens removed. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[\[audio:[^\]]*\]\]/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The cards reviewed in a finished session: front, last grade and next due, linking to the editor. */
export function ReviewedCardsList({
  items,
  now,
  onBack,
}: {
  items: ReviewedCard[];
  now: Date;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="mx-auto flex w-full max-w-[720px] items-center gap-3 px-4 pb-3 pt-4">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('session.reviewList.back')}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface focus-visible:outline-3 focus-visible:outline-focus"
        >
          <Icon name="arrow-right" size={26} className="rotate-180" />
        </button>
        <h1 className="text-xl font-black text-text">
          {t('session.reviewList.title', { n: items.length })}
        </h1>
      </header>
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8">
        <ul className="flex flex-col gap-3">
          {items.map(({ card, lastGrade, reviews }) => {
            const g = GRADE_STYLE[lastGrade];
            const ms = new Date(card.fsrs.due).getTime() - now.getTime();
            const next =
              ms <= 0
                ? t('session.reviewList.dueNow')
                : intervalLabel(ms, (k, o) => t(k, { ...o }));
            const front = plainText(card.front) || '—';
            return (
              <li key={card.id}>
                <Link
                  to={`/decks/${card.deckId}/cards/${card.id}`}
                  aria-label={t('session.reviewList.edit', { front })}
                  className="flex items-center gap-3 rounded-2xl border-2 border-border bg-[var(--color-card)] p-3 shadow-[0_3px_0_var(--color-border)] hover:border-primary focus-visible:outline-3 focus-visible:outline-focus"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-bold text-text">{front}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-text-muted">
                      <Icon name="timer" size={14} />
                      <span>{t('session.reviewList.next', { when: next })}</span>
                      {reviews > 1 && (
                        <span>· {t('session.reviewList.times', { count: reviews })}</span>
                      )}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-[0.06em] ${g.cls}`}
                  >
                    {t(`grade.${g.key}`)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </main>
      <div className="sticky bottom-0 z-10 border-t-2 border-border bg-bg">
        <div className="mx-auto flex w-full max-w-[1100px] justify-end px-4 py-4">
          <ChunkyButton size="lg" className="min-w-48 rounded-2xl" onClick={onBack}>
            {t('session.reviewList.back')}
          </ChunkyButton>
        </div>
      </div>
    </div>
  );
}
