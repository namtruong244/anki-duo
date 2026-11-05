import {
  endOfStudyDay,
  previewIntervals,
  buildQueue,
  requeueAfterGrade,
  reviewXp,
  schedule,
  sessionBonusXp,
  studyDay,
  SCHEDULER_VERSION,
  type FsrsState as DomainState,
  type Grade,
} from '@anki-duo/domain';
import type {
  Card,
  Deck,
  FsrsState,
  LocalStore,
  ReviewEvent,
  RevokeEvent,
  SessionEvent,
  Settings,
  StoredSession,
} from '../local-store';

export interface SessionDeps {
  store: LocalStore;
  now: () => Date;
  /** UUIDv7 generator for events and sessions. */
  newId: () => string;
  /** Called when a save fails; the UI turns it into a toast (never silent, edge case). */
  onError?: (e: unknown) => void;
}

export type SessionKind = 'review' | 'ahead';

export interface Previews {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface Summary {
  cardsReviewed: number;
  reviews: number;
  /** Share of reviews graded Hard or better. */
  accuracy: number;
  durationMs: number;
  xp: number;
}

export interface SessionState {
  status: 'front' | 'back' | 'done' | 'empty';
  card: Card | null;
  previews: Previews | null;
  /** `total` counts each queued card once, however often it comes back. */
  progress: { done: number; total: number };
  summary: Summary | null;
}

interface ReviewRecord {
  eventId: string;
  cardId: string;
  grade: Grade;
  durationMs: number;
  studyAhead: boolean;
}

/** What is persisted in `LocalStore.sessions` (FR-019). */
interface Persisted extends StoredSession {
  planned: string[];
  reviews: ReviewRecord[];
  startedAtMs: number;
  shownAtMs: number;
  undoState: UndoSnapshot | null;
}

interface UndoSnapshot {
  card: Card;
  eventId: string;
  queue: string[];
  position: number;
  reviewCount: number;
  shownAtMs: number;
}

const toDomain = (s: FsrsState): DomainState => ({
  ...s,
  due: new Date(s.due),
  lastReview: s.lastReview ? new Date(s.lastReview) : null,
});
const fromDomain = (s: DomainState): FsrsState => ({
  ...s,
  due: s.due.toISOString(),
  lastReview: s.lastReview ? s.lastReview.toISOString() : null,
});

const schedulerParams = (s: Settings) => ({
  desiredRetention: s.desiredRetention,
  maximumIntervalDays: s.maximumIntervalDays,
});

/**
 * One study session. All state is in memory and updated synchronously, so grading never waits for
 * IndexedDB or the network (FR-016); the write is started and tracked, and a failure is reported.
 */
export class SessionMachine {
  private listeners = new Set<() => void>();
  private pending: Promise<unknown> = Promise.resolve();
  private revealed = false;
  private previews: Previews | null = null;
  private finished = false;
  private cards = new Map<string, Card>();
  private rev = 0;

  private constructor(
    private deps: SessionDeps,
    private deck: Deck,
    private settings: Settings,
    private p: Persisted,
    cards: Card[],
  ) {
    for (const c of cards) this.cards.set(c.id, c);
  }

  /** Builds the queue and records the start. An empty queue gives the `empty` state. */
  static async start(
    deps: SessionDeps,
    args: { deck: Deck; kind: SessionKind; settings: Settings },
  ): Promise<SessionMachine> {
    const { deck, kind, settings } = args;
    const now = deps.now();
    const cards = (await deps.store.listCards(deck.id)).filter((c) => !c.deletedAt);
    const { end, day } = studyWindow(now, settings);
    const queue = buildQueue({
      kind,
      cards: cards.map((c) => ({
        id: c.id,
        state: c.fsrs.state,
        due: new Date(c.fsrs.due),
        position: c.position,
        suspended: c.suspended,
        nodeIndex: c.nodeIndex,
      })),
      now,
      settings: { sessionSize: settings.sessionSize, newCardsPerDay: deck.newCardsPerDay },
      studyDayEnd: end,
      introducedToday: introducedToday(cards, day, settings),
    });
    const p: Persisted = {
      id: deps.newId(),
      deckId: deck.id,
      kind,
      nodeIndex: null,
      startedAt: now.toISOString(),
      queue,
      position: 0,
      graded: {},
      undo: null,
      planned: [...queue],
      reviews: [],
      startedAtMs: now.getTime(),
      shownAtMs: now.getTime(),
      undoState: null,
    };
    const m = new SessionMachine(deps, deck, settings, p, cards);
    if (queue.length > 0) {
      await deps.store.putSession(p);
      await deps.store.appendOutbox(m.sessionEvent(false));
    }
    return m;
  }

  /** Picks up the session left in `LocalStore.sessions`, or returns null. */
  static async resume(
    deps: SessionDeps,
    args: { deck: Deck; settings: Settings },
  ): Promise<SessionMachine | null> {
    const stored = (await deps.store.getActiveSession()) as Persisted | undefined;
    if (!stored || stored.deckId !== args.deck.id) return null;
    const cards = await deps.store.listCards(stored.deckId);
    return new SessionMachine(deps, args.deck, args.settings, stored, cards);
  }

  // --- reading -----------------------------------------------------------------------------

  getState(): SessionState {
    const p = this.p;
    if (p.planned.length === 0) return state('empty', null, null, 0, 0, null);
    const total = p.planned.length;
    const open = new Set(p.queue.slice(p.position));
    const done = total - p.planned.filter((id) => open.has(id)).length;
    if (this.finished) return state('done', null, null, done, total, this.summary());
    const card = this.cards.get(p.queue[p.position]!) ?? null;
    return state(this.revealed ? 'back' : 'front', card, this.previews, done, total, null);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  canUndo() {
    return this.p.undoState !== null;
  }

  /** Resolves when every started write has finished. */
  async settled() {
    await this.pending;
  }

  // --- actions -----------------------------------------------------------------------------

  reveal() {
    const card = this.current();
    if (!card || this.revealed) return;
    this.revealed = true;
    this.previews = previewIntervals(
      toDomain(card.fsrs),
      this.deps.now(),
      schedulerParams(this.settings),
    );
    this.emit();
  }

  grade(grade: Grade) {
    const card = this.current();
    if (!card || this.finished) return;
    const now = this.deps.now();
    const p = this.p;
    const before = card.fsrs;
    const result = schedule(toDomain(before), grade, now, schedulerParams(this.settings));
    const after = fromDomain(result.card);
    const updated: Card = { ...card, fsrs: after };
    const durationMs = Math.min(3_600_000, Math.max(0, now.getTime() - p.shownAtMs));
    const studyAhead = p.kind === 'ahead';
    const event: ReviewEvent = {
      type: 'review',
      id: this.deps.newId(),
      cardId: card.id,
      sessionId: p.id,
      grade,
      reviewedAt: now.toISOString(),
      durationMs,
      studyAhead,
      schedulerVersion: SCHEDULER_VERSION,
      stateBefore: before,
      stateAfter: after,
    };

    p.undoState = {
      card,
      eventId: event.id,
      queue: [...p.queue],
      position: p.position,
      reviewCount: p.reviews.length,
      shownAtMs: p.shownAtMs,
    };
    p.undo = { card, eventId: event.id };
    p.reviews = [
      ...p.reviews,
      { eventId: event.id, cardId: card.id, grade, durationMs, studyAhead },
    ];
    p.graded = { ...p.graded, [card.id]: grade };

    this.cards.set(card.id, updated);
    const { end } = studyWindow(now, this.settings);
    const remaining = requeueAfterGrade({
      remaining: p.queue.slice(p.position + 1),
      cardId: card.id,
      stateAfter: result.card.state,
      nextDue: result.card.due,
      studyDayEnd: end,
    });
    p.queue = [...p.queue.slice(0, p.position + 1), ...remaining];
    p.position += 1;
    p.shownAtMs = now.getTime();
    this.revealed = false;
    this.previews = null;

    let session: StoredSession | undefined = { ...p };
    const finishedNow = p.position >= p.queue.length;
    if (finishedNow) {
      this.finished = true;
      session = undefined;
    }
    // Not awaited: the UI has already moved on. The write is tracked and failures are reported.
    this.track(
      this.deps.store
        .gradeTransaction({ card: updated, event, ...(session ? { session } : {}) })
        .then(async () => {
          if (finishedNow) {
            await this.deps.store.appendOutbox(this.sessionEvent(true, now));
            await this.deps.store.deleteSession(p.id);
          }
        }),
    );
    this.emit();
  }

  /** Undoes the last grade: restores the card and drops the unsent event, or revokes a sent one. */
  async undo() {
    const snap = this.p.undoState;
    if (!snap) return;
    const p = this.p;
    await this.pending;
    const store = this.deps.store;
    const queued = (await store.listOutbox()).some((e) => e.id === snap.eventId);

    this.cards.set(snap.card.id, snap.card);
    p.queue = snap.queue;
    p.position = snap.position;
    p.reviews = p.reviews.slice(0, snap.reviewCount);
    delete p.graded[snap.card.id];
    p.shownAtMs = snap.shownAtMs;
    p.undoState = null;
    p.undo = null;
    const wasFinished = this.finished;
    this.finished = false;
    this.revealed = false;
    this.previews = null;
    this.emit();

    await store.putCards([snap.card]);
    if (queued) {
      await store.removeOutbox([snap.eventId]);
    } else {
      const revoke: RevokeEvent = {
        type: 'revoke',
        id: this.deps.newId(),
        reviewId: snap.eventId,
        revokedAt: this.deps.now().toISOString(),
      };
      await store.appendOutbox(revoke);
    }
    // Keep the session event's counts honest, and bring a finished session back to life.
    await store.putSession({ ...p });
    await store.appendOutbox(this.sessionEvent(false));
    void wasFinished;
  }

  // --- helpers -----------------------------------------------------------------------------

  private current(): Card | null {
    if (this.finished || this.p.planned.length === 0) return null;
    return this.cards.get(this.p.queue[this.p.position]!) ?? null;
  }

  private summary(): Summary {
    const r = this.p.reviews;
    const ahead = this.p.kind === 'ahead';
    const reviewXpTotal = r.reduce(
      (n, x) => n + reviewXp({ kind: 'review', studyAhead: x.studyAhead, revokedAt: null }),
      0,
    );
    return {
      cardsReviewed: new Set(r.map((x) => x.cardId)).size,
      reviews: r.length,
      accuracy: r.length ? r.filter((x) => x.grade >= 2).length / r.length : 0,
      durationMs: r.reduce((n, x) => n + x.durationMs, 0),
      xp:
        reviewXpTotal +
        sessionBonusXp({ completed: true, kind: ahead ? 'ahead' : (this.p.kind as 'review') }),
    };
  }

  private sessionEvent(completed: boolean, endedAt?: Date): SessionEvent {
    const p = this.p;
    const distinct = new Set(p.reviews.map((x) => x.cardId));
    return {
      type: 'session',
      id: p.id,
      deckId: p.deckId,
      kind: p.kind,
      nodeIndex: p.nodeIndex,
      startedAt: p.startedAt,
      endedAt: completed ? (endedAt ?? this.deps.now()).toISOString() : null,
      plannedCount: p.planned.length,
      cardsReviewed: distinct.size,
      correctCount: p.reviews.filter((x) => x.grade >= 2).length,
      completed,
    };
  }

  private track(promise: Promise<unknown>) {
    this.pending = this.pending.then(() => promise).catch((e) => this.deps.onError?.(e));
  }

  /** Increases on every change; a cheap snapshot for `useSyncExternalStore`. */
  get version() {
    return this.rev;
  }

  private emit() {
    this.rev++;
    this.listeners.forEach((l) => l());
  }
}

const state = (
  status: SessionState['status'],
  card: Card | null,
  previews: Previews | null,
  done: number,
  total: number,
  summary: Summary | null,
): SessionState => ({ status, card, previews, progress: { done, total }, summary });

export function studyWindow(now: Date, settings: Pick<Settings, 'timeZone' | 'dayStartHour'>) {
  const day = studyDay(now, settings.timeZone, settings.dayStartHour);
  return { day, end: endOfStudyDay(day, settings.timeZone, settings.dayStartHour) };
}

/**
 * New cards introduced today: cards whose single review so far happened in today's study day.
 * The client has no review history, so this is a lower bound (a card reviewed again the same day
 * is no longer counted); the server's daily limit stays authoritative.
 */
export function introducedToday(
  cards: Card[],
  day: string,
  settings: Pick<Settings, 'timeZone' | 'dayStartHour'>,
): number {
  return cards.filter(
    (c) =>
      c.fsrs.reps === 1 &&
      c.fsrs.lastReview !== null &&
      studyDay(new Date(c.fsrs.lastReview), settings.timeZone, settings.dayStartHour) === day,
  ).length;
}
