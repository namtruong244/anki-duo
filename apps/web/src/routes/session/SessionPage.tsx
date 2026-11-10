import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { motion } from 'motion/react';
import { reviewXp, sessionBonusXp } from '@anki-duo/domain';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { adjustToday, queueDayFlagIfDone, type TodayResult } from '../../client/gamification';
import { notify } from '../../client/notify';
import { sound } from '../../client/sound';
import { useMotionPreference } from '../../lib/motion';
import { newId, syncEngine } from '../../client/runtime';
import {
  SessionMachine,
  type AnswerResult,
  type SessionKind,
} from '../../client/session/session-machine';
import { dexieStore } from '../../client/store';
import type { Deck, Settings } from '../../client/local-store';
import { CardEditor } from '../../components/editor/CardEditor';
import { DEFAULT_CARD_CSS } from '@anki-duo/domain';
import { CardHtml } from '../../components/card/CardHtml';
import { AnswerContext, type AnswerContextValue } from '../../components/answer';
import { CardContent } from '../../components/session/CardContent';
import { useNoteType } from '../../client/use-note-type';
import { Celebration } from '../../components/session/Celebration';
import { GradeBar, useSessionHotkeys } from '../../components/session/GradeBar';
import { GradeFeedback } from '../../components/session/GradeFeedback';
import { ChunkyButton, Dialog, Icon, ProgressBar, SpeakerBtn, TagChip } from '../../components/ui';
import { ReviewedCardsList } from '../../components/session/ReviewedCardsList';
import { EmptyQueue } from './EmptyQueue';

type Phase =
  | { name: 'loading' }
  | { name: 'missing' }
  | { name: 'resume'; target: Target; settings: Settings; machine: SessionMachine }
  | { name: 'running'; machine: SessionMachine };

/** Reserved route value for the combined session over every deck (never a UUID). */
export const ALL_DECKS = 'all';

type Target = { kind: 'deck'; deck: Deck } | { kind: 'all'; decks: Deck[] };

export function SessionPage() {
  const { t } = useTranslation();
  const { deckId = '' } = useParams();
  const [params] = useSearchParams();
  const nodeParam = params.get('node');
  const nodeIndex = nodeParam !== null && /^\d+$/.test(nodeParam) ? Number(nodeParam) : undefined;
  const kind: SessionKind =
    params.get('kind') === 'ahead' ? 'ahead' : nodeIndex !== undefined ? 'node' : 'review';
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const started = useRef(false);

  const deps = useCallback(
    () => ({
      store: dexieStore,
      now: () => new Date(),
      newId,
      onError: () => notify.show(t('session.saveFailed')),
    }),
    [t],
  );

  const begin = useCallback(
    async (target: Target, settings: Settings, k: SessionKind) => {
      const machine = await SessionMachine.start(deps(), {
        ...(target.kind === 'all' ? { decks: target.decks } : { deck: target.deck }),
        kind: k,
        settings,
        ...(nodeIndex !== undefined ? { nodeIndex } : {}),
      });
      setPhase({ name: 'running', machine });
    },
    [deps, nodeIndex],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const userId = (await dexieStore.getMeta('userId')) ?? '';
      const settings = await dexieStore.getSettings(userId);
      let target: Target | null = null;
      if (deckId === ALL_DECKS) {
        const decks = (await dexieStore.listDecks()).filter((d) => !d.deletedAt);
        if (decks.length > 0) target = { kind: 'all', decks };
      } else {
        const deck = await dexieStore.getDeck(deckId);
        if (deck && !deck.deletedAt) target = { kind: 'deck', deck };
      }
      if (!target || !settings) return setPhase({ name: 'missing' });
      const machine = await SessionMachine.resume(deps(), {
        ...(target.kind === 'all' ? { multi: true } : { deck: target.deck }),
        settings,
      });
      if (machine) setPhase({ name: 'resume', target, settings, machine });
      else await begin(target, settings, kind);
    })();
  }, [deckId, kind, deps, begin]);

  if (phase.name === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="flex items-center gap-3 rounded-2xl border-2 border-border bg-[var(--color-card)] px-5 py-4 shadow-[0_4px_0_var(--color-border)]">
          <Icon name="sparkles" size={20} className="animate-spin text-primary" />
          <p role="status" className="font-bold text-text">
            {t('session.loading')}
          </p>
        </div>
      </div>
    );
  }
  if (phase.name === 'missing') {
    return (
      <section className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-border bg-surface text-text-muted">
          <Icon name="layers" size={32} />
        </div>
        <p className="text-lg font-bold text-text">{t('session.missingDeck')}</p>
        <Link
          className="inline-flex min-h-10 items-center justify-center rounded-[var(--radius-button)] bg-primary px-4 py-2 font-extrabold text-on-primary shadow-[0_var(--button-depth)_0_var(--color-primary-depth)] transition-[transform,box-shadow,filter] duration-[var(--duration-fast)] hover:brightness-[1.03] active:translate-y-[var(--button-press-offset)] active:shadow-none"
          to="/"
        >
          {t('session.backToDecks')}
        </Link>
      </section>
    );
  }
  if (phase.name === 'resume') {
    const { target, settings, machine } = phase;
    return (
      <Dialog open title={t('session.resumeTitle')} onClose={() => navigate('/')}>
        <p className="mb-4 font-medium text-text-muted">{t('session.resumeBody')}</p>
        <div className="flex flex-wrap gap-2.5">
          <ChunkyButton onClick={() => setPhase({ name: 'running', machine })}>
            {t('session.resume')}
          </ChunkyButton>
          <ChunkyButton
            variant="neutral"
            onClick={async () => {
              const id = (await dexieStore.getActiveSession())?.id;
              if (id) await dexieStore.deleteSession(id);
              await begin(target, settings, kind);
            }}
          >
            {t('session.discard')}
          </ChunkyButton>
        </div>
      </Dialog>
    );
  }
  return (
    <Running
      machine={phase.machine}
      deckId={deckId}
      kind={kind}
      onStudyAhead={() =>
        navigate(`/session/${deckId}?kind=ahead`, { replace: true }) as unknown as void
      }
    />
  );
}

function Running({
  machine,
  deckId,
  kind,
  onStudyAhead,
}: {
  machine: SessionMachine;
  deckId: string;
  kind: SessionKind;
  onStudyAhead: () => void;
}) {
  const { t } = useTranslation();
  useSyncExternalStore(
    (cb) => machine.subscribe(cb),
    () => machine.version,
  );
  const s = machine.getState();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [feedback, setFeedback] = useState(0);
  const [celebration, setCelebration] = useState<TodayResult | null>(null);
  const motionPref = useMotionPreference(settings?.motion);
  const navigate = useNavigate();
  const startStreak = useRef<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [undoPressed, setUndoPressed] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const userId = (await dexieStore.getMeta('userId')) ?? '';
      setSettings((await dexieStore.getSettings(userId)) ?? null);
    })();
  }, []);

  const extras = useLiveQuery(async () => {
    const userId = (await dexieStore.getMeta('userId')) ?? '';
    const stats = await dexieStore.getStats(userId);
    return { currentStreak: stats?.currentStreak ?? 0 };
  }, []);

  useEffect(() => {
    if (extras && startStreak.current === null) startStreak.current = extras.currentStreak;
  }, [extras]);

  /** Optimistic XP and streak, written before the server hears about the review. */
  const award = useCallback(
    async (delta: { reviews: number; xp: number }, finished = false) => {
      if (!settings) return;
      const userId = (await dexieStore.getMeta('userId')) ?? '';
      const ctx = { store: dexieStore, userId, settings, now: new Date() };
      const r = await adjustToday(ctx, delta);
      if (finished) await queueDayFlagIfDone(ctx, newId);
      if (r.goalCrossed || r.streakIncreased) {
        setCelebration(r);
        void sound.play('streak');
      }
    },
    [settings],
  );
  const xpOf = useCallback(
    () => reviewXp({ kind: 'review', studyAhead: kind === 'ahead', revokedAt: null }),
    [kind],
  );

  const reveal = useCallback(() => machine.reveal(), [machine]);
  /** Sound, pulse, XP and sync after a grade, whether the learner or auto-grade made it. */
  const afterGrade = useCallback(
    (g: 1 | 2 | 3 | 4) => {
      void sound.playGrade(g);
      setFeedback((n) => n + 1);
      const finished = machine.isFinished;
      const bonus = finished ? sessionBonusXp({ completed: true, kind }) : 0;
      void award({ reviews: 1, xp: xpOf() + bonus }, finished);
      if (finished) {
        void sound.play('complete');
        void machine.settled().then(() => syncEngine.syncAfterSession());
      }
    },
    [machine, award, xpOf, kind],
  );
  const grade = useCallback(
    (g: 1 | 2 | 3 | 4) => {
      machine.grade(g);
      afterGrade(g);
    },
    [machine, afterGrade],
  );
  const submitAnswer = useCallback(
    (r: AnswerResult) => {
      machine.submitAnswer(r);
      const after = machine.getState();
      if (after.continuing && after.suggested) afterGrade(after.suggested);
    },
    [machine, afterGrade],
  );
  const proceed = useCallback(() => machine.continue(), [machine]);
  const undo = useCallback(() => {
    if (!machine.canUndo()) return;
    setUndoPressed(true);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoPressed(false), 140);
    const wasDone = machine.isFinished;
    const bonus = wasDone ? sessionBonusXp({ completed: true, kind }) : 0;
    void machine.undo().then(() => award({ reviews: -1, xp: -(xpOf() + bonus) }));
  }, [machine, award, xpOf, kind]);

  useSessionHotkeys({
    revealed: s.status === 'back',
    onReveal: reveal,
    onGrade: grade,
    onUndo: undo,
    suggested: s.suggested,
    continuing: s.continuing,
    onContinue: proceed,
    enabled: s.status !== 'done' && s.status !== 'empty' && !editing,
  });

  const noteType = useNoteType(s.card?.format === 'html' ? s.card.noteTypeId : null);

  const overlays = (
    <>
      <GradeFeedback token={feedback} motion={motionPref} />
      {celebration && (
        <Celebration
          goalMet={celebration.goalCrossed}
          streak={celebration.streak}
          streakIncreased={celebration.streakIncreased}
          motion={motionPref}
          onDone={() => setCelebration(null)}
        />
      )}
    </>
  );

  if (s.status === 'empty') return <EmptyQueue deckId={deckId} onStudyAhead={onStudyAhead} />;

  if (s.status === 'done' && s.summary && reviewing) {
    return (
      <ReviewedCardsList
        items={machine.getReviewedCards()}
        now={new Date()}
        onBack={() => setReviewing(false)}
      />
    );
  }

  if (s.status === 'done' && s.summary) {
    const m = s.summary;
    const streak = extras?.currentStreak ?? 0;
    const grew = startStreak.current !== null && streak > startStreak.current;
    const stats = [
      {
        key: 'xp',
        label: t('session.xp'),
        value: `+${m.xp}`,
        icon: 'zap' as const,
        box: 'border-gold',
        head: 'bg-gold text-on-gold',
        fg: 'text-gold',
      },
      {
        key: 'accuracy',
        label: t('session.accuracy'),
        value: `${Math.round(m.accuracy * 100)}%`,
        icon: 'target' as const,
        box: 'border-primary',
        head: 'bg-primary text-on-primary',
        fg: 'text-primary',
      },
      {
        key: 'time',
        label: t('session.time'),
        value: formatDuration(m.durationMs),
        icon: 'timer' as const,
        box: 'border-secondary',
        head: 'bg-secondary text-on-secondary',
        fg: 'text-secondary',
      },
      {
        key: 'reviewed',
        label: t('session.reviewed'),
        value: String(m.cardsReviewed),
        icon: 'layers' as const,
        box: 'border-purple',
        head: 'bg-purple text-on-purple',
        fg: 'text-purple',
      },
    ];
    return (
      <div className="relative flex min-h-dvh flex-col overflow-hidden bg-bg">
        {overlays}
        <Confetti motion={motionPref} />
        <section className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-4 py-10 text-center">
          <motion.div
            initial={motionPref === 'reduced' ? false : { scale: 0.5, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={
              motionPref === 'reduced'
                ? { duration: 0.01 }
                : { type: 'spring', stiffness: 320, damping: 20 }
            }
            className="flex h-32 w-32 items-center justify-center rounded-full bg-orange text-on-orange shadow-[0_6px_0_var(--color-orange-depth)]"
          >
            <Icon name="flame" size={72} />
          </motion.div>
          <h1 className="text-3xl font-black uppercase leading-tight tracking-tight text-gold sm:text-4xl">
            {t('ui.session.summaryHeadline')}
          </h1>
          {streak > 0 && (
            <p className="text-base font-bold text-orange">
              {grew
                ? t('ui.session.streakGrew', { n: streak })
                : t('ui.session.streakNow', { n: streak })}
            </p>
          )}
          <dl className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {stats.map((x, i) => (
              <motion.div
                key={x.key}
                initial={motionPref === 'reduced' ? false : { y: 14, scale: 0.95 }}
                animate={{ y: 0, scale: 1 }}
                transition={
                  motionPref === 'reduced'
                    ? { duration: 0.01 }
                    : { duration: 0.25, delay: i * 0.06, ease: 'easeOut' }
                }
                className={`overflow-hidden rounded-2xl border-2 bg-[var(--color-card)] ${x.box}`}
              >
                <dt
                  className={`px-2 py-2 text-xs font-extrabold uppercase tracking-[0.08em] ${x.head}`}
                >
                  {x.label}
                </dt>
                <dd
                  className={`flex items-center justify-center gap-2 px-2 py-5 text-2xl font-black ${x.fg}`}
                >
                  <Icon name={x.icon} size={28} />
                  <span>{x.value}</span>
                </dd>
              </motion.div>
            ))}
          </dl>
        </section>
        <Dock>
          <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
            <ChunkyButton
              size="lg"
              variant="outline"
              className="rounded-2xl"
              onClick={() => setReviewing(true)}
            >
              {t('ui.session.reviewCards')}
            </ChunkyButton>
            <ChunkyButton size="lg" className="rounded-2xl" onClick={() => navigate('/')}>
              {t('session.continue')}
            </ChunkyButton>
          </div>
        </Dock>
      </div>
    );
  }

  const card = s.card;
  const isHtml = card?.format === 'html';
  const cardCss = noteType?.css ?? DEFAULT_CARD_CSS;
  const { text: frontText, audioId } = splitAudio(card?.front ?? '');
  const tags = card?.tags ?? [];
  const answerCtx: AnswerContextValue = {
    status: s.status === 'answering' || s.status === 'back' ? s.status : 'front',
    answer: machine.currentAnswer(),
    result: s.answer,
    suggested: s.suggested,
    submitAnswer,
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {overlays}
      {card && (
        <Dialog
          open={editing}
          size="xl"
          title={t('cards.editTitle')}
          header={<></>}
          onClose={() => setEditing(false)}
        >
          <div className="p-5 sm:p-8">
            <CardEditor
              deckId={card.deckId}
              cardId={card.id}
              onClose={() => setEditing(false)}
              onSaved={(saved) => machine.replaceContent(saved)}
            />
          </div>
        </Dialog>
      )}

      <header className="mx-auto flex w-full max-w-[1100px] items-center gap-3 px-4 pb-3 pt-4 sm:gap-4">
        <Link
          to="/"
          aria-label={t('common.close')}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-text-muted transition-[transform,background-color] duration-[var(--duration-fast)] hover:bg-surface active:scale-95"
        >
          <Icon name="x" size={30} />
        </Link>
        <button
          type="button"
          onClick={undo}
          disabled={!machine.canUndo()}
          data-pressed={undoPressed}
          aria-keyshortcuts="Z"
          aria-label={t('session.undo')}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border-2 border-border bg-[var(--color-card)] px-2.5 text-xs font-extrabold uppercase tracking-[0.06em] text-text-muted shadow-[0_3px_0_var(--color-border)] transition-[transform,box-shadow,background-color] duration-[var(--duration-fast)] enabled:hover:bg-surface enabled:active:translate-y-[2px] enabled:active:shadow-none data-[pressed=true]:translate-y-[2px] data-[pressed=true]:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="undo-2" size={18} />
          <span aria-hidden="true" className="hidden sm:inline">
            {t('session.undo')} · Z
          </span>
        </button>
        <ProgressBar
          className="min-w-0 flex-1"
          value={s.progress.done}
          max={s.progress.total}
          label={t('session.progressLabel')}
        />
        <span className="shrink-0 text-sm font-extrabold tabular-nums text-text-muted">
          {t('session.progress', s.progress)}
        </span>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8 pt-3">
        <article aria-live="polite" className="flex flex-col gap-5">
          <h2 className="sr-only">
            {s.status === 'back' ? t('session.back') : t('session.front')}
          </h2>
          {card && (
            <motion.div
              key={card.id}
              initial={motionPref === 'reduced' ? false : { y: 10, scale: 0.99 }}
              animate={{ y: 0, scale: 1 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="flex flex-col gap-5"
            >
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <TagChip key={tag} label={tag} tabIndex={-1} />
                  ))}
                </div>
              )}

              {isHtml && card ? (
                <AnswerContext.Provider value={answerCtx}>
                  <CardHtml
                    html={s.status === 'back' ? card.back : card.front}
                    css={cardCss}
                    className="min-w-0"
                    interaction={card.interaction ?? null}
                    side={s.status === 'back' ? 'back' : 'front'}
                  />
                </AnswerContext.Provider>
              ) : (
                <>
                  <div className="flex items-start gap-4">
                    {audioId && (
                      <SpeakerBtn
                        label={t('session.play')}
                        onClick={() => {
                          void new Audio(`/api/v1/media/${audioId}`)
                            .play()
                            .catch(() => notify.show(t('media.unavailable')));
                        }}
                      />
                    )}
                    <CardContent
                      variant="word"
                      markdown={frontText}
                      className="min-w-0 flex-1 self-center"
                    />
                  </div>

                  {s.status === 'back' && (
                    <motion.div
                      initial={motionPref === 'reduced' ? false : { y: 8 }}
                      animate={{ y: 0 }}
                      transition={{ duration: 0.16, ease: 'easeOut' }}
                      className="flex flex-col gap-5"
                    >
                      <hr className="border-t-2 border-border" />
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-text-subtle">
                          {t('session.meaning')}
                        </p>
                        <CardContent variant="meaning" markdown={card.back} />
                      </div>
                    </motion.div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </article>
      </main>

      <Dock>
        {s.status === 'front' || s.status === 'answering' ? (
          <div className="flex items-center justify-between gap-3">
            {card && (
              <ChunkyButton
                variant="outline"
                size="lg"
                className="rounded-2xl"
                onClick={() => setEditing(true)}
              >
                {t('ui.session.editCard')}
              </ChunkyButton>
            )}
            {s.status === 'front' && (
              <ChunkyButton
                size="lg"
                onClick={reveal}
                aria-keyshortcuts="Space"
                className="min-w-0 flex-1 rounded-2xl sm:max-w-72 sm:flex-none"
              >
                {t('session.reveal')}
              </ChunkyButton>
            )}
          </div>
        ) : s.continuing ? (
          <div className="flex items-center justify-between gap-3">
            {s.suggested && (
              <p role="status" className="text-sm font-extrabold text-text-muted">
                {t('session.suggested')}:{' '}
                {t(`grade.${(['again', 'hard', 'good'] as const)[s.suggested - 1]}`)}
              </p>
            )}
            <ChunkyButton
              size="lg"
              onClick={proceed}
              aria-keyshortcuts="Space Enter"
              className="min-w-0 flex-1 rounded-2xl sm:max-w-72 sm:flex-none"
            >
              {t('session.continue')}
            </ChunkyButton>
          </div>
        ) : (
          s.previews && (
            <motion.div
              initial={motionPref === 'reduced' ? false : { y: 6, scale: 0.99 }}
              animate={{ y: 0, scale: 1 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
            >
              <GradeBar previews={s.previews} onGrade={grade} suggested={s.suggested} />
              <p className="sr-only">{t('session.shortcuts')}</p>
            </motion.div>
          )
        )}
      </Dock>
    </div>
  );
}

/** Bottom action dock with a top border, shared by the card and summary screens. */
function Dock({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 border-t-2 border-border bg-bg">
      <div className="mx-auto w-full max-w-[1100px] px-4 py-4">{children}</div>
    </div>
  );
}

const AUDIO_TOKEN = /\[\[audio:([0-9a-f-]{36})\]\]/i;

/** The first `[[audio:id]]` on the front drives the speaker button; it is removed from the text. */
function splitAudio(markdown: string): { text: string; audioId: string | null } {
  const m = AUDIO_TOKEN.exec(markdown);
  if (!m) return { text: markdown, audioId: null };
  return { text: markdown.replace(m[0], '').trim(), audioId: m[1]! };
}

const CONFETTI: { x: string; y: string; rot: number; color: string }[] = [
  { x: '11%', y: '11%', rot: 15, color: 'bg-gold' },
  { x: '21%', y: '20%', rot: 30, color: 'bg-secondary' },
  { x: '16%', y: '46%', rot: -40, color: 'bg-danger' },
  { x: '8%', y: '68%', rot: -20, color: 'bg-purple' },
  { x: '30%', y: '78%', rot: 10, color: 'bg-orange' },
  { x: '83%', y: '13%', rot: -35, color: 'bg-purple' },
  { x: '88%', y: '30%', rot: 15, color: 'bg-primary' },
  { x: '79%', y: '44%', rot: 35, color: 'bg-gold' },
  { x: '90%', y: '71%', rot: 10, color: 'bg-danger' },
  { x: '69%', y: '82%', rot: 40, color: 'bg-secondary' },
];

/** Decorative confetti pieces behind the summary; lively spring-pop when motion is full. */
function Confetti({ motion: preference }: { motion?: 'reduced' | 'full' }) {
  const isFull = preference === 'full';
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      {CONFETTI.map((c, i) =>
        isFull ? (
          <motion.span
            key={i}
            initial={{ opacity: 0, scale: 0, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: c.rot }}
            transition={{ type: 'spring', stiffness: 240, damping: 18, delay: i * 0.04 }}
            className={`absolute block h-6 w-3 rounded-sm ${c.color}`}
            style={{ left: c.x, top: c.y }}
          />
        ) : (
          <span
            key={i}
            className={`absolute block h-6 w-3 rounded-sm ${c.color}`}
            style={{ left: c.x, top: c.y, transform: `rotate(${c.rot}deg)` }}
          />
        ),
      )}
    </div>
  );
}

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
