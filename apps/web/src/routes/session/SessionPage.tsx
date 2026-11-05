import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { reviewXp, sessionBonusXp } from '@anki-duo/domain';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { adjustToday, queueDayFlagIfDone, type TodayResult } from '../../client/gamification';
import { notify } from '../../client/notify';
import { sound } from '../../client/sound';
import { useMotionPreference } from '../../lib/motion';
import { newId, syncEngine } from '../../client/runtime';
import { SessionMachine, type SessionKind } from '../../client/session/session-machine';
import { dexieStore } from '../../client/store';
import type { Deck, Settings } from '../../client/local-store';
import { CardContent } from '../../components/session/CardContent';
import { Celebration } from '../../components/session/Celebration';
import { GradeBar, useSessionHotkeys } from '../../components/session/GradeBar';
import { GradeFeedback } from '../../components/session/GradeFeedback';
import { ChunkyButton, Dialog, ProgressBar } from '../../components/ui';
import { EmptyQueue } from './EmptyQueue';

type Phase =
  | { name: 'loading' }
  | { name: 'missing' }
  | { name: 'resume'; deck: Deck; settings: Settings; machine: SessionMachine }
  | { name: 'running'; machine: SessionMachine };

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
    async (deck: Deck, settings: Settings, k: SessionKind) => {
      const machine = await SessionMachine.start(deps(), {
        deck,
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
      const [deck, settings] = await Promise.all([
        dexieStore.getDeck(deckId),
        dexieStore.getSettings(userId),
      ]);
      if (!deck || deck.deletedAt || !settings) return setPhase({ name: 'missing' });
      const machine = await SessionMachine.resume(deps(), { deck, settings });
      if (machine) setPhase({ name: 'resume', deck, settings, machine });
      else await begin(deck, settings, kind);
    })();
  }, [deckId, kind, deps, begin]);

  if (phase.name === 'loading') {
    return (
      <p role="status" className="p-6">
        {t('session.loading')}
      </p>
    );
  }
  if (phase.name === 'missing') {
    return (
      <section className="p-6">
        <p>{t('session.missingDeck')}</p>
        <Link className="underline" to="/decks">
          {t('session.backToDecks')}
        </Link>
      </section>
    );
  }
  if (phase.name === 'resume') {
    const { deck, settings, machine } = phase;
    return (
      <Dialog open title={t('session.resumeTitle')} onClose={() => navigate('/decks')}>
        <p className="mb-4">{t('session.resumeBody')}</p>
        <div className="flex gap-2">
          <ChunkyButton onClick={() => setPhase({ name: 'running', machine })}>
            {t('session.resume')}
          </ChunkyButton>
          <ChunkyButton
            variant="neutral"
            onClick={async () => {
              const id = (await dexieStore.getActiveSession())?.id;
              if (id) await dexieStore.deleteSession(id);
              await begin(deck, settings, kind);
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
  const motion = useMotionPreference(settings?.motion);

  useEffect(() => {
    void (async () => {
      const userId = (await dexieStore.getMeta('userId')) ?? '';
      setSettings((await dexieStore.getSettings(userId)) ?? null);
    })();
  }, []);

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
  const grade = useCallback(
    (g: 1 | 2 | 3 | 4) => {
      machine.grade(g);
      void sound.playGrade(g);
      setFeedback((n) => n + 1);
      const finished = machine.getState().status === 'done';
      const bonus = finished ? sessionBonusXp({ completed: true, kind }) : 0;
      void award({ reviews: 1, xp: xpOf() + bonus }, finished);
      if (finished) {
        void sound.play('complete');
        void machine.settled().then(() => syncEngine.syncAfterSession());
      }
    },
    [machine, award, xpOf, kind],
  );
  const undo = useCallback(() => {
    const wasDone = machine.getState().status === 'done';
    const bonus = wasDone ? sessionBonusXp({ completed: true, kind }) : 0;
    void machine.undo().then(() => award({ reviews: -1, xp: -(xpOf() + bonus) }));
  }, [machine, award, xpOf, kind]);
  useSessionHotkeys({
    revealed: s.status === 'back',
    onReveal: reveal,
    onGrade: grade,
    onUndo: undo,
    enabled: s.status !== 'done' && s.status !== 'empty',
  });

  const overlays = (
    <>
      <GradeFeedback token={feedback} motion={motion} />
      {celebration && (
        <Celebration
          goalMet={celebration.goalCrossed}
          streak={celebration.streak}
          streakIncreased={celebration.streakIncreased}
          motion={motion}
          onDone={() => setCelebration(null)}
        />
      )}
    </>
  );

  if (s.status === 'empty') return <EmptyQueue deckId={deckId} onStudyAhead={onStudyAhead} />;

  if (s.status === 'done' && s.summary) {
    const m = s.summary;
    return (
      <section className="flex flex-col gap-4 py-6">
        {overlays}
        <h1 className="text-2xl font-bold">{t('session.summaryTitle')}</h1>
        <dl className="grid grid-cols-2 gap-3">
          <Stat label={t('session.reviewed')} value={String(m.cardsReviewed)} />
          <Stat label={t('session.accuracy')} value={`${Math.round(m.accuracy * 100)}%`} />
          <Stat label={t('session.time')} value={formatDuration(m.durationMs)} />
          <Stat label={t('session.xp')} value={`+${m.xp}`} />
        </dl>
        <div className="flex flex-wrap gap-2">
          <ChunkyButton variant="neutral" onClick={undo} aria-keyshortcuts="Z">
            {t('session.undo')}
          </ChunkyButton>
          <Link className="inline-flex min-h-11 items-center underline" to="/decks">
            {t('session.backToDecks')}
          </Link>
        </div>
      </section>
    );
  }

  const card = s.card;
  return (
    <section className="flex h-[calc(100dvh-8rem)] flex-col gap-3 py-2">
      {overlays}
      <div className="flex items-center gap-3">
        <ProgressBar
          className="flex-1"
          value={s.progress.done}
          max={s.progress.total}
          label={t('session.progressLabel')}
        />
        <span className="text-sm tabular-nums">{t('session.progress', s.progress)}</span>
        <ChunkyButton
          variant="neutral"
          onClick={undo}
          disabled={!machine.canUndo()}
          aria-keyshortcuts="Z"
        >
          {t('session.undo')}
        </ChunkyButton>
      </div>
      <article
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface p-4"
      >
        {card && (
          <>
            <h2 className="sr-only">
              {s.status === 'back' ? t('session.back') : t('session.front')}
            </h2>
            <CardContent markdown={card.front} className="min-h-0 text-xl" />
            {s.status === 'back' && (
              <>
                <hr className="border-border" />
                <CardContent markdown={card.back} className="min-h-0 text-lg" />
              </>
            )}
          </>
        )}
      </article>
      {s.status === 'front' ? (
        <ChunkyButton onClick={reveal} aria-keyshortcuts="Space" className="w-full">
          {t('session.reveal')}
        </ChunkyButton>
      ) : (
        s.previews && <GradeBar previews={s.previews} onGrade={grade} />
      )}
    </section>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-[var(--radius-card)] bg-surface p-3">
    <dt className="text-sm text-text-muted">{label}</dt>
    <dd className="text-xl font-bold">{value}</dd>
  </div>
);

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
