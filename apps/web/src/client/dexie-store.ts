import Dexie, { type Table } from 'dexie';
import type {
  Card,
  DailyActivity,
  Deck,
  LocalStore,
  MediaAsset,
  MetaValues,
  NoteType,
  OutboxEvent,
  PullApplication,
  Settings,
  Stats,
  StoredSession,
} from './local-store';

type MetaRow = { key: string; value: unknown };
type StoredCard = Card & { state: Card['fsrs']['state']; due: string };

/** Dexie implementation of `LocalStore` (data-model "Client store"). */
export class DexieStore extends Dexie implements LocalStore {
  meta!: Table<MetaRow, string>;
  settings!: Table<{ userId: string } & Settings, string>;
  stats!: Table<{ userId: string } & Stats, string>;
  decks!: Table<Deck, string>;
  cards!: Table<StoredCard, string>;
  media!: Table<MediaAsset, string>;
  noteTypes!: Table<NoteType, string>;
  outbox!: Table<OutboxEvent, string>;
  sessions!: Table<StoredSession, string>;
  dailyActivity!: Table<DailyActivity, string>;

  constructor(name = 'anki-duo') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      settings: 'userId',
      stats: 'userId',
      decks: 'id',
      // state/due are denormalised from `fsrs` so the compound index can see them.
      cards: 'id, [deckId+state+due], [deckId+nodeIndex], deckId',
      media: 'id, cardId',
      outbox: 'id',
      sessions: 'id',
      dailyActivity: 'studyDay',
    });
    this.version(2).stores({ noteTypes: 'id' });
    // v3 (feature 002) only widens the stored rows (cards: ordinal/interaction/answerText, decks:
    // mcPractice, settings: autoGrade, noteTypes: kind/options/builtinKey). No new index, no
    // upgrade function: v2 rows are kept untouched and missing fields are read as 0 / null / ''.
    this.version(3).stores({});
  }

  async getMeta<K extends keyof MetaValues>(key: K) {
    return (await this.meta.get(key))?.value as MetaValues[K] | undefined;
  }
  async setMeta<K extends keyof MetaValues>(key: K, value: MetaValues[K]) {
    await this.meta.put({ key, value });
  }

  async getSettings(userId: string) {
    const row = await this.settings.get(userId);
    if (!row) return undefined;
    return omit(row, ['userId']) as Settings;
  }
  async putSettings(userId: string, settings: Settings) {
    await this.settings.put({ userId, ...settings });
  }
  async getStats(userId: string) {
    const row = await this.stats.get(userId);
    if (!row) return undefined;
    return omit(row, ['userId']) as Stats;
  }
  async putStats(userId: string, stats: Stats) {
    await this.stats.put({ userId, ...stats });
  }

  async putDecks(decks: Deck[]) {
    await this.decks.bulkPut(decks);
  }
  async getDeck(id: string) {
    const row = await this.decks.get(id);
    return row ? withDeckDefaults(row) : undefined;
  }
  async listDecks() {
    return (await this.decks.toArray()).map(withDeckDefaults);
  }

  async putCards(cards: Card[]) {
    await this.cards.bulkPut(cards.map(toStored));
  }
  async getCard(id: string) {
    const row = await this.cards.get(id);
    return row ? fromStored(row) : undefined;
  }
  async listCardsByState(deckId: string, state: Card['fsrs']['state'], dueBefore?: string) {
    const upper = dueBefore ?? Dexie.maxKey;
    const rows = await this.cards
      .where('[deckId+state+due]')
      .between([deckId, state, Dexie.minKey], [deckId, state, upper], true, true)
      .toArray();
    return rows.map(fromStored);
  }
  async listCardsByNode(deckId: string, nodeIndex: number) {
    return (await this.cards.where('[deckId+nodeIndex]').equals([deckId, nodeIndex]).toArray()).map(
      fromStored,
    );
  }
  async listCards(deckId: string) {
    return (await this.cards.where('deckId').equals(deckId).toArray()).map(fromStored);
  }

  async putNoteTypes(rows: NoteType[]) {
    await this.noteTypes.bulkPut(rows);
  }
  getNoteType(id: string) {
    return this.noteTypes.get(id);
  }
  async listNoteTypes() {
    return (await this.noteTypes.toArray()).filter((n) => !n.deletedAt);
  }

  async putMedia(media: MediaAsset[]) {
    await this.media.bulkPut(media);
  }
  listMedia(cardId: string) {
    return this.media.where('cardId').equals(cardId).toArray();
  }

  async listOutbox(limit?: number) {
    const q = this.outbox.orderBy('id');
    return limit ? q.limit(limit).toArray() : q.toArray();
  }
  async appendOutbox(event: OutboxEvent) {
    // `put`: session events are re-sent with the same id as they progress (upsert by id).
    await this.outbox.put(event);
  }
  async removeOutbox(ids: string[]) {
    await this.outbox.bulkDelete(ids);
  }

  getSession(id: string) {
    return this.sessions.get(id);
  }
  async getActiveSession() {
    return (await this.sessions.toArray())[0];
  }
  async putSession(session: StoredSession) {
    await this.sessions.put(session);
  }
  async deleteSession(id: string) {
    await this.sessions.delete(id);
  }

  async putDailyActivity(rows: DailyActivity[]) {
    await this.dailyActivity.bulkPut(rows);
    const all = (await this.dailyActivity.orderBy('studyDay').keys()) as string[];
    if (all.length > 400) await this.dailyActivity.bulkDelete(all.slice(0, all.length - 400));
  }
  listDailyActivity() {
    return this.dailyActivity.orderBy('studyDay').toArray();
  }

  async gradeTransaction(args: Parameters<LocalStore['gradeTransaction']>[0]) {
    await this.transaction(
      'rw',
      [this.cards, this.outbox, this.sessions, this.dailyActivity],
      async () => {
        // `add` fails on a duplicate id, which aborts the whole transaction.
        await this.outbox.add(args.event);
        await this.cards.put(toStored(args.card));
        if (args.session) await this.sessions.put(args.session);
        if (args.dailyActivity) await this.dailyActivity.put(args.dailyActivity);
      },
    );
  }

  async applyPull(page: PullApplication) {
    await this.transaction(
      'rw',
      [
        this.meta,
        this.settings,
        this.stats,
        this.decks,
        this.cards,
        this.noteTypes,
        this.media,
        this.dailyActivity,
      ],
      async () => {
        const userId = (await this.getMeta('userId')) ?? '';
        if (page.settings) await this.putSettings(userId, page.settings);
        if (page.stats) await this.putStats(userId, page.stats);
        for (const d of page.decks ?? []) {
          if (d.deletedAt) {
            // A deck delete is hard on the server and sends no card tombstones: drop them here.
            const ids = (await this.cards.where('deckId').equals(d.id).primaryKeys()) as string[];
            await this.media.where('cardId').anyOf(ids).delete();
            await this.cards.bulkDelete(ids);
            await this.decks.delete(d.id);
          } else await this.decks.put(d);
        }
        for (const c of page.cards ?? []) {
          if (c.deletedAt) await this.cards.delete(c.id);
          else await this.cards.put(toStored(c));
        }
        for (const n of page.noteTypes ?? []) {
          if (n.deletedAt) await this.noteTypes.delete(n.id);
          else await this.noteTypes.put(n);
        }
        for (const m of page.media ?? []) {
          if (m.deletedAt) await this.media.delete(m.id);
          else await this.media.put(m);
        }
        if (page.dailyActivity?.length) await this.putDailyActivity(page.dailyActivity);
        if (page.cursor !== undefined) await this.setMeta('pullCursor', page.cursor);
      },
    );
  }

  async clearAll() {
    await this.transaction('rw', this.tables, async () => {
      await Promise.all(this.tables.map((t) => t.clear()));
    });
  }
}

const toStored = (c: Card): StoredCard => ({ ...c, state: c.fsrs.state, due: c.fsrs.due });
/** v2 rows predate `ordinal`/`interaction`/`answerText`; they read back as 0 / null / '' (feature 002). */
const fromStored = (row: StoredCard): Card => {
  const c = omit(row, ['state', 'due']) as Partial<Card>;
  return {
    ...c,
    ordinal: c.ordinal ?? 0,
    interaction: c.interaction ?? null,
    answerText: c.answerText ?? '',
  } as Card;
};
const withDeckDefaults = (d: Deck): Deck => ({ ...d, mcPractice: d.mcPractice ?? false });

function omit<T extends object>(obj: T, keys: string[]): object {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}
