import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { content } from '../../client/runtime';
import { useOnlineOnly } from '../../client/online-only';
import type { Deck } from '../../client/local-store';
import { ChunkyButton, Dialog } from '../../components/ui';
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

  if (confirmDelete && deck) {
    return (
      <Dialog open={open} title={t('decks.deleteTitle')} onClose={() => setConfirmDelete(false)}>
        <p className="mb-4">{t('decks.deleteConfirm', { name: deck.name, count: cardCount })}</p>
        {error && (
          <p role="alert" className="mb-3 text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
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
      </Dialog>
    );
  }

  return (
    <Dialog open={open} title={deck ? t('decks.settings') : t('decks.new')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          {t('decks.name')}
          <input
            className="min-h-11 rounded-lg border border-border px-3"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            disabled={!net.online}
          />
        </label>
        <label className="flex flex-col gap-1">
          {t('decks.newPerDay')}
          <input
            className="min-h-11 rounded-lg border border-border px-3"
            inputMode="numeric"
            value={perDay}
            onChange={(e) => setPerDay(e.target.value)}
            disabled={!net.online}
          />
        </label>
        {net.message && (
          <p role="status" className="text-text-muted">
            {net.message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {deck && (
            <>
              <ChunkyButton
                variant="neutral"
                onClick={() => void exportDeck()}
                {...net.buttonProps}
              >
                {t('decks.export')}
              </ChunkyButton>
              <ChunkyButton
                variant="danger"
                onClick={() => setConfirmDelete(true)}
                {...net.buttonProps}
              >
                {t('decks.delete')}
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
