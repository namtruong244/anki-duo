import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CardEditor } from '../../components/editor/CardEditor';
import { NoteEditor } from '../../components/editor/NoteEditor';
import { content } from '../../client/runtime';
import { dexieStore } from '../../client/store';
import type { Note } from '../../client/content';
import { describeApiError } from '../../lib/api-error';

type Loaded =
  { kind: 'legacy' } | { kind: 'note'; note: Note } | { kind: 'error'; message: string };

/**
 * Route wrapper: new cards use the note editor; an existing card opens its note when it has one,
 * otherwise the legacy Markdown editor.
 */
export function CardEditorPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { deckId = '', cardId } = useParams();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const close = () => navigate(`/decks/${deckId}/cards`);

  useEffect(() => {
    setLoaded(null);
    if (!cardId) return;
    let live = true;
    void (async () => {
      const card = await dexieStore.getCard(cardId);
      if (!card?.noteId) return live && setLoaded({ kind: 'legacy' });
      try {
        const note = await content.getNote(card.noteId);
        if (live) setLoaded({ kind: 'note', note });
      } catch (e) {
        if (live) setLoaded({ kind: 'error', message: describeApiError(t, e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [cardId, t]);

  if (!cardId) {
    return (
      <NoteEditor
        deckId={deckId}
        onClose={close}
        onCreated={(n) =>
          navigate(`/decks/${n.deckId}/cards/${n.cards[0]?.id ?? ''}`, { replace: true })
        }
      />
    );
  }
  if (!loaded)
    return (
      <p role="status" className="p-8 text-center font-bold text-text-muted">
        {t('common.loading')}
      </p>
    );
  if (loaded.kind === 'error')
    return (
      <p role="alert" className="p-8 text-center font-bold text-text">
        {loaded.message}
      </p>
    );
  if (loaded.kind === 'note')
    return (
      <NoteEditor
        key={loaded.note.id}
        deckId={loaded.note.deckId}
        note={loaded.note}
        onClose={close}
      />
    );
  return (
    <CardEditor
      deckId={deckId}
      cardId={cardId}
      onClose={close}
      onCreated={(c) => navigate(`/decks/${c.deckId}/cards/${c.id}`, { replace: true })}
    />
  );
}
