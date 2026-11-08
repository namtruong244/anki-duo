import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { content } from '../../client/runtime';
import { useOnlineOnly } from '../../client/online-only';
import type { Deck } from '../../client/local-store';
import { ChunkyButton, Dialog, Icon } from '../../components/ui';
import { describeApiError } from '../../lib/api-error';
import { downloadText } from '../../lib/download';

/** Create a deck (`deck` null) or rename, change the new-card limit, export or delete one. */
export function DeckSettingsDialog({
  open,
  deck,
  cardCount,
  onClose,
}: {
  open: boolean;
  deck: Deck | null;
  cardCount: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const net = useOnlineOnly();
  const [name, setName] = useState('');
  const [perDay, setPerDay] = useState('20');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(deck?.name ?? '');
    setPerDay(String(deck?.newCardsPerDay ?? 20));
    setError(null);
    setConfirmDelete(false);
  }, [open, deck]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(describeApiError(t, e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    const n = Number(perDay);
    if (trimmed.length < 1 || trimmed.length > 100) return setError(t('decks.nameInvalid'));
    if (!Number.isInteger(n) || n < 0 || n > 999) return setError(t('decks.perDayInvalid'));
    const ok = await run(() =>
      deck
        ? content.updateDeck(deck.id, { name: trimmed, newCardsPerDay: n })
        : content.createDeck({ name: trimmed, newCardsPerDay: n }),
    );
    if (ok) onClose();
  };

  const exportDeck = () =>
    run(async () => {
      const file = await content.exportDeck(deck!);
      downloadText(file.fileName, file.text);
    });

  // Step 2: Confirmation Danger Zone
  if (confirmDelete && deck) {
    return (
      <Dialog open={open} title={t('decks.deleteTitle')} onClose={() => setConfirmDelete(false)}>
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border-2 border-danger/30 bg-danger-tint p-4 text-sm font-bold text-text">
            <p className="leading-relaxed">
              {t('decks.deleteConfirm', { name: deck.name, count: cardCount })}
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-xl border-2 border-danger bg-danger-tint p-3 text-xs font-bold text-text"
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <ChunkyButton variant="neutral" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </ChunkyButton>
            <ChunkyButton
              variant="danger"
              disabled={busy || !net.online}
              onClick={async () => {
                if (await run(() => content.deleteDeck(deck.id))) onClose();
              }}
            >
              {t('decks.delete')}
            </ChunkyButton>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} title={deck ? t('decks.settings') : t('decks.new')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs font-black uppercase tracking-wide text-text-muted">
          <span>{t('decks.name')}</span>
          <input
            className="min-h-11 rounded-[var(--radius-button)] border-2 border-border bg-surface px-3.5 text-sm font-bold text-text focus-visible:border-focus focus-visible:outline-none transition-colors"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            disabled={!net.online}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-black uppercase tracking-wide text-text-muted">
          <span>{t('decks.newPerDay')}</span>
          <input
            className="min-h-11 rounded-[var(--radius-button)] border-2 border-border bg-surface px-3.5 text-sm font-bold text-text focus-visible:border-focus focus-visible:outline-none transition-colors"
            inputMode="numeric"
            value={perDay}
            onChange={(e) => setPerDay(e.target.value)}
            disabled={!net.online}
          />
        </label>

        {net.message && (
          <p role="status" className="text-xs font-bold text-text-muted">
            {net.message}
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-xl border-2 border-danger bg-danger-tint p-3 text-xs font-bold text-text"
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {deck && (
            <>
              <ChunkyButton
                variant="outline"
                onClick={() => void exportDeck()}
                {...net.buttonProps}
              >
                <Icon name="upload" size={16} />
                <span>{t('decks.export')}</span>
              </ChunkyButton>
              <ChunkyButton
                variant="danger"
                onClick={() => setConfirmDelete(true)}
                {...net.buttonProps}
              >
                <Icon name="trash-2" size={16} />
                <span>{t('decks.delete')}</span>
              </ChunkyButton>
            </>
          )}
          <ChunkyButton variant="neutral" onClick={onClose}>
            {t('common.cancel')}
          </ChunkyButton>
          <ChunkyButton type="submit" disabled={busy || !net.online}>
            {deck ? t('common.save') : t('decks.create')}
          </ChunkyButton>
        </div>
      </form>
    </Dialog>
  );
}
