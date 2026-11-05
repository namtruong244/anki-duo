// Generates packages/fixtures/fsrs-vectors.json straight from the pinned ts-fsrs, carrying the
// library's own card object between steps (never our wrapper), so the wrapper is tested against
// the reference. Run: node packages/domain/scripts/gen-fsrs-vectors.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { fsrs, createEmptyCard, generatorParameters, State } from 'ts-fsrs';

const version = JSON.parse(
  readFileSync(new URL('../node_modules/ts-fsrs/package.json', import.meta.url)),
).version;
const STATE = ['new', 'learning', 'review', 'relearning'];
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const MIN = 60_000;
const DAY = 86_400_000;

const view = (c) => ({
  state: STATE[c.state],
  due: c.due.toISOString(),
  stability: c.stability,
  difficulty: c.difficulty,
  learningSteps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  lastReview: c.last_review ? c.last_review.toISOString() : null,
});

/** gap: ms to wait after the card's due before reviewing (negative = early). */
function chain(name, grades, { retention = 0.9, maxInterval = 36500, gap = 0 } = {}) {
  const f = fsrs(
    generatorParameters({
      request_retention: retention,
      maximum_interval: maxInterval,
      enable_fuzz: false,
    }),
  );
  let card = createEmptyCard(new Date(T0));
  const initial = view(card);
  let now = T0;
  const steps = [];
  for (const g of grades) {
    if (steps.length > 0) now = Math.max(now, card.due.getTime() + gap);
    const r = f.repeat(card, new Date(now))[g];
    card = r.card;
    steps.push({ at: new Date(now).toISOString(), grade: g, expected: view(card) });
  }
  return { name, desiredRetention: retention, maximumIntervalDays: maxInterval, initial, steps };
}

const cases = [
  chain('first review: Again', [1]),
  chain('first review: Hard', [2]),
  chain('first review: Good', [3]),
  chain('first review: Easy', [4]),
  chain('learning steps: Good, Good, Good graduates', [3, 3, 3]),
  chain('learning steps: Hard then Good', [2, 3, 3]),
  chain('lapse: Easy then Again then Good', [4, 1, 3, 3]),
  chain('lapse: repeated lapses', [3, 3, 3, 3, 1, 1, 3, 3, 3]),
  chain('maximum interval cap 30 days', [4, 4, 4, 4, 4], { maxInterval: 30 }),
  chain('maximum interval cap 1 day', [4, 3, 3], { maxInterval: 1 }),
  chain('desired retention 0.70', [3, 3, 3, 3, 3, 3], { retention: 0.7 }),
  chain('desired retention 0.97', [3, 3, 3, 3, 3, 3], { retention: 0.97 }),
  chain('late reviews (+5 days)', [3, 3, 3, 3, 3], { gap: 5 * DAY }),
  chain('mixed grades', [3, 4, 2, 3, 1, 3, 4, 3, 3], { gap: 1 * DAY }),
];

const out = {
  source: 'ts-fsrs own scheduler output (fsrs().repeat) with enable_fuzz=false',
  version,
  parameters: { ...generatorParameters({ enable_fuzz: false }), w: [...generatorParameters().w] },
  cases,
};
writeFileSync(
  new URL('../../fixtures/fsrs-vectors.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`wrote ${cases.length} cases for ts-fsrs ${version}`);
void State;
void MIN;
