import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { content } from '../../client/runtime';
import { dexieStore } from '../../client/store';
import { validateCard } from '../../client/card-validation';
import { useOnlineOnly } from '../../client/online-only';
import { CardContent } from '../../components/session/CardContent';
import { MediaPicker } from '../../components/editor/MediaPicker';
import { ChunkyButton } from '../../components/ui';
import { notify } from '../../client/notify';
import { describeApiError } from '../../lib/api-error';

/**
 * Create or edit a card: Markdown on both sides with a live preview. Media can be attached once the
 * card exists (the upload is tied to a card id), so a new card is saved first.
 */
export function CardEditorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { deckId = '', cardId } = useParams();
  const net = useOnlineOnly();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!cardId);

  useEffect(() => {
    if (!cardId) return;
    void dexieStore.getCard(cardId).then((c) => {
      if (c) {
        setFront(c.front);
        setBack(c.back);
        setTags(c.tags.join(' '));
      }
      setLoaded(true);
    });
  }, [cardId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateCard(front, back, tags);
    if (!v.ok) return setError(t(`cards.errors.${v.error}`));
    setError(null);
    try {
      if (cardId) {
        await content.updateCard(cardId, { front: v.front, back: v.back, tags: v.tags });
        notify.show(t('cards.saved'));
        navigate(`/decks/${deckId}/cards`);
      } else {
        const created = await content.createCard(deckId, {
          front: v.front,
          back: v.back,
          tags: v.tags,
        });
        notify.show(t('cards.saved'));
        // Go to the edit view so media can be attached to the saved card.
        navigate(`/decks/${deckId}/cards/${created.id}`, { replace: true });
      }
    } catch (err) {
      setError(describeApiError(t, err));
    }
  };

  if (!loaded) return <p role="status">{t('common.loading')}</p>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 py-4">
      <h1 className="text-2xl font-bold">{cardId ? t('cards.editTitle') : t('cards.newTitle')}</h1>
      {net.message && (
        <p role="status" className="text-text-muted">
          {net.message}
        </p>
      )}
      {(['front', 'back'] as const).map((side) => {
        const value = side === 'front' ? front : back;
        const set = side === 'front' ? setFront : setBack;
        return (
          <fieldset key={side} className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 font-bold">
              {side === 'front' ? t('cards.front') : t('cards.back')}
              <textarea
                className="min-h-28 rounded-lg border border-border p-3 font-normal"
                value={value}
                onChange={(e) => set(e.target.value)}
                disabled={!net.online}
              />
            </label>
            <div
              className="rounded-lg border border-dashed border-border p-3"
              aria-label={t('cards.preview')}
            >
              <CardContent markdown={value} />
            </div>
            {cardId && (
              <MediaPicker
                cardId={cardId}
                side={side}
                onInsert={(token) => set((v) => `${v}${v ? '\n\n' : ''}${token}`)}
              />
            )}
          </fieldset>
        );
      })}
      <label className="flex flex-col gap-1 font-bold">
        {t('cards.tags')}
        <input
          className="min-h-11 rounded-lg border border-border px-3 font-normal"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          disabled={!net.online}
        />
        <span className="text-sm font-normal text-text-muted">{t('cards.tagsHint')}</span>
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <ChunkyButton variant="neutral" onClick={() => navigate(`/decks/${deckId}/cards`)}>
          {t('common.cancel')}
        </ChunkyButton>
        <ChunkyButton type="submit" {...net.buttonProps}>
          {t('cards.save')}
        </ChunkyButton>
      </div>
    </form>
  );
}
