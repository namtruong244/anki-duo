import type { components } from './api-types';

type S = components['schemas'];
export type Deck = S['Deck'];
export type Card = S['Card'];
export type NoteType = S['NoteType'];
export type MediaAsset = S['Media'];
export type Settings = S['Settings'];
export type Stats = S['Stats'];
export type DailyActivity = S['DailyActivity'];
export type FsrsState = S['FsrsState'];

// openapi-typescript rewrites the `type` discriminator to schema names ('ReviewEvent'); the wire
// values are the lower-case ones in the contract, so they are restored here.
type Wire<T, V extends string> = Omit<T, 'type'> & { type: V };
export type ReviewEvent = Wire<S['ReviewEvent'], 'review'>;
export type RevokeEvent = Wire<S['RevokeEvent'], 'revoke'>;
export type SessionEvent = Wire<S['SessionEvent'], 'session'>;
export type DayFlagEvent = Wire<S['DayFlagEvent'], 'day_flag'>;
export type OutboxEvent = ReviewEvent | RevokeEvent | SessionEvent | DayFlagEvent;

/** A checked answer kept with the session so a reload resumes on the feedback screen (R7). UI state only; never pushed. */
export interface StoredAnswer {
  verdict: 'correct' | 'almost' | 'wrong' | null;
  given?: string;
  choiceIndex?: number;
  suggested: 1 | 2 | 3 | null;
}

/** An in-progress study session with its queue and undo snapshot (FR-019). */
export interface StoredSession {
  id: string;
  deckId: string;
  kind: 'node' | 'review' | 'ahead';
  nodeIndex: number | null;
  startedAt: string;
  queue: string[];
  position: number;
  graded: Record<string, number>;
  undo?: { card: Card; eventId: string } | null;
  /** Set between `submitAnswer` and the grade (feature 002). */
  answer?: StoredAnswer | null;
  [key: string]: unknown;
}

export interface MetaValues {
  deviceId: string;
  pullCursor: string;
  userId: string;
  lastSyncAt: string;
}

/** Everything a pull page writes, applied atomically. Rows with `deletedAt` are tombstones. */
export interface PullApplication {
  settings?: Settings | null;
  stats?: Stats | null;
  decks?: Deck[];
  cards?: Card[];
  noteTypes?: NoteType[];
  media?: MediaAsset[];
  dailyActivity?: DailyActivity[];
  cursor?: string;
}

/**
 * Platform-neutral local storage contract (research R6/R17). The web implements it with Dexie;
 * a Flutter app would implement it with SQLite.
 */
export interface LocalStore {
  getMeta<K extends keyof MetaValues>(key: K): Promise<MetaValues[K] | undefined>;
  setMeta<K extends keyof MetaValues>(key: K, value: MetaValues[K]): Promise<void>;

  getSettings(userId: string): Promise<Settings | undefined>;
  putSettings(userId: string, settings: Settings): Promise<void>;
  getStats(userId: string): Promise<Stats | undefined>;
  putStats(userId: string, stats: Stats): Promise<void>;

  putDecks(decks: Deck[]): Promise<void>;
  getDeck(id: string): Promise<Deck | undefined>;
  listDecks(): Promise<Deck[]>;

  putCards(cards: Card[]): Promise<void>;
  getCard(id: string): Promise<Card | undefined>;
  /** Cards of a deck in a state with `due <= dueBefore` (ISO). Excludes deleted. */
  listCardsByState(
    deckId: string,
    state: Card['fsrs']['state'],
    dueBefore?: string,
  ): Promise<Card[]>;
  listCardsByNode(deckId: string, nodeIndex: number): Promise<Card[]>;
  listCards(deckId: string): Promise<Card[]>;

  putNoteTypes(rows: NoteType[]): Promise<void>;
  getNoteType(id: string): Promise<NoteType | undefined>;
  /** Note types that are not deleted. */
  listNoteTypes(): Promise<NoteType[]>;

  putMedia(media: MediaAsset[]): Promise<void>;
  listMedia(cardId: string): Promise<MediaAsset[]>;

  /** Pending outbox events, oldest first (ids are UUIDv7, so they sort by time). */
  listOutbox(limit?: number): Promise<OutboxEvent[]>;
  appendOutbox(event: OutboxEvent): Promise<void>;
  removeOutbox(ids: string[]): Promise<void>;

  getSession(id: string): Promise<StoredSession | undefined>;
  getActiveSession(): Promise<StoredSession | undefined>;
  putSession(session: StoredSession): Promise<void>;
  deleteSession(id: string): Promise<void>;

  putDailyActivity(rows: DailyActivity[]): Promise<void>;
  listDailyActivity(): Promise<DailyActivity[]>;

  /**
   * Atomic grade: updates the card and appends the outbox event in one transaction, so a crash
   * can never leave one without the other (FR-016, FR-019).
   */
  gradeTransaction(args: {
    card: Card;
    event: OutboxEvent;
    session?: StoredSession;
    dailyActivity?: DailyActivity;
  }): Promise<void>;

  /** Applies a pull page atomically, including tombstones. */
  applyPull(page: PullApplication): Promise<void>;

  /** Empties every store (sign-out, shared-device privacy). */
  clearAll(): Promise<void>;
}
