import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { dueCards, pathNodes, type PathNode } from '@anki-duo/domain';
import { studyWindow } from '../../client/session/session-machine';
import { dexieStore } from '../../client/store';
import { PathMap } from '../../components/path/PathMap';
import { ChunkyButton } from '../../components/ui';
import { useMotionPreference } from '../../lib/motion';

interface Data {
  decks: { id: string; name: string }[];
  motion: 'system' | 'reduced' | 'full';
  byDeck: Record<string, { nodes: PathNode[]; due: number }>;
}

const key = (deckId: string) => `anki-duo:path:${deckId}`;
const readPrev = (deckId: string): Record<number, string> => {
  try {
    return JSON.parse(sessionStorage.getItem(key(deckId)) ?? '{}') as Record<number, string>;
  } catch {
    return {};
  }
};

/** A deck as a winding path of 10-card nodes. Locks only guide; Review is never locked (FR-023). */
export function PathPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [lockedMsg, setLockedMsg] = useState<number | null>(null);
  const [unlocked, setUnlocked] = useState<number | undefined>();

  const data = useLiveQuery(async (): Promise<Data> => {
    const userId = (await dexieStore.getMeta('userId')) ?? '';
    const settings = await dexieStore.getSettings(userId);
    const end = settings ? studyWindow(new Date(), settings).end : new Date();
    const decks = (await dexieStore.listDecks())
      .filter((d) => !d.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
    const byDeck: Data['byDeck'] = {};
    for (const d of decks) {
      const cards = (await dexieStore.listCards(d.id)).filter((c) => !c.deletedAt);
      const q = cards.map((c) => ({
        id: c.id,
        state: c.fsrs.state,
        due: new Date(c.fsrs.due),
        position: c.position,
        suspended: c.suspended,
        nodeIndex: c.nodeIndex,
      }));
      byDeck[d.id] = { nodes: pathNodes(q), due: dueCards(q, end).length };
    }
    return {
      decks: decks.map((d) => ({ id: d.id, name: d.name })),
      motion: settings?.motion ?? 'system',
      byDeck,
    };
  }, []);

  const motion = useMotionPreference(data?.motion ?? 'system');
  const deckId = data
    ? (data.decks.find((d) => d.id === params.get('deck'))?.id ?? data.decks[0]?.id)
    : undefined;
  const entry = deckId ? data?.byDeck[deckId] : undefined;

  // Returning from a session: a node that was locked and now is not animates in.
  useEffect(() => {
    if (!deckId || !entry) return;
    const prev = readPrev(deckId);
    const opened = entry.nodes.find((n) => prev[n.index] === 'locked' && n.status !== 'locked');
    if (opened) setUnlocked(opened.index);
    sessionStorage.setItem(
      key(deckId),
      JSON.stringify(Object.fromEntries(entry.nodes.map((n) => [n.index, n.status]))),
    );
  }, [deckId, entry]);

  if (!data)
    return (
      <p role="status" className="py-4">
        {t('common.loading')}
      </p>
    );
  if (!deckId || !entry) return <p className="py-4">{t('path.noDecks')}</p>;

  const position = (index: number) => entry.nodes.findIndex((n) => n.index === index) + 1;

  return (
    <section className="py-4">
      <h1 className="mb-3 text-2xl font-bold">{t('path.title')}</h1>
      <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 bg-bg py-2">
        {data.decks.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="text-sm">{t('path.pickDeck')}</span>
            <select
              className="min-h-11 rounded border border-border bg-surface px-2"
              value={deckId}
              onChange={(e) => {
                setLockedMsg(null);
                setParams({ deck: e.target.value });
              }}
            >
              {data.decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <ChunkyButton onClick={() => navigate(`/session/${deckId}`)}>
          {t('path.review', { n: entry.due })}
        </ChunkyButton>
      </div>
      {entry.due > 0 && <p className="text-sm text-text-muted">{t('path.dueFirst')}</p>}
      {lockedMsg !== null && (
        <p role="status" className="my-2 rounded bg-neutral p-2">
          {t('path.lockedMessage', { n: lockedMsg })}
        </p>
      )}
      {entry.nodes.length === 0 ? (
        <p className="py-4">{t('path.empty')}</p>
      ) : (
        <PathMap
          nodes={entry.nodes}
          motion={motion}
          justUnlocked={unlocked}
          onLocked={(_, prev) => setLockedMsg(position(prev))}
          onStart={(i) => navigate(`/session/${deckId}?node=${i}`)}
        />
      )}
    </section>
  );
}
