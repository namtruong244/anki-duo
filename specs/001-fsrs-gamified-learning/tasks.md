---

description: "Task list for FSRS Gamified Learning App (MVP)"
---

# Tasks: FSRS Gamified Learning App (MVP)

**Input**: Design documents from `/specs/001-fsrs-gamified-learning/`

**Prerequisites**: [plan.md](./plan.md) (rev. c), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle II (Test-First, non-negotiable) applies:
- every test task MUST be written and seen failing for the right reason before the
  implementation task that follows it;
- tests use an injected clock and no external network;
- domain rules are driven by the language-neutral fixtures in `packages/fixtures` (research R17).

**Organization**: tasks are grouped by user story, so each story can be implemented, tested and
demoed on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task belongs to (US1–US5, see spec.md)
- Paths are relative to the repository root and follow the monorepo layout in plan.md:
  - deployables: `apps/web`, `apps/api`, `apps/edge`;
  - shared packages: `packages/domain`, `packages/contract`, `packages/fixtures`;
  - end-to-end and load tests: `tests/e2e`, `tests/load`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: monorepo, tooling and empty deployables that build and run.

- [ ] T001 Create the monorepo root:
  - `package.json` with scripts `dev`, `build`, `typecheck`, `lint`, `test:unit`, `test:int`,
    `test:contract`, `test:i18n`, `test:e2e`, `test:load`, `verify`, `db:migrate`, `db:seed`,
    `gen:api`, `sst`;
  - `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.nvmrc` (`24`), `.gitignore`,
    `.editorconfig`.
- [ ] T002 [P] Create `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, ES2023, bundler module resolution) and per-workspace
  `tsconfig.json` files that extend it.
- [ ] T003 [P] Configure ESLint (flat config) and Prettier:
  - `eslint.config.js` and `.prettierrc`;
  - for `packages/domain/**`, `no-restricted-globals` / `no-restricted-syntax` rules that forbid
    `Date.now`, `new Date()` with no arguments, and `Math.random` (constitution Principle I,
    plan Constitution Check).
- [ ] T004 [P] Create `vitest.workspace.ts` with projects:
  - `unit`: `packages/*`;
  - `int-api`: `apps/api`;
  - `int-web`: `apps/web`, jsdom + fake-indexeddb;
  - `edge`: `apps/edge`, `@cloudflare/vitest-pool-workers`.
  Also add a shared fake-clock helper in `packages/domain/tests/helpers/clock.ts`.
- [ ] T005 [P] Scaffold `packages/domain`: `package.json` with `ts-fsrs` pinned to an exact
  version (no caret), `src/index.ts`, `tests/`.
- [ ] T006 [P] Scaffold `packages/contract`: `package.json` (zod, `@hono/zod-openapi`),
  `src/index.ts`, `tests/`.
- [ ] T007 [P] Scaffold `packages/fixtures`:
  - `package.json`, `schema/`, `import/`;
  - `src/index.ts`, which exports typed loaders for every fixture JSON file.
- [ ] T008 [P] Scaffold `apps/api`:
  - dependencies: hono, `@hono/node-server`, drizzle-orm, drizzle-kit,
    `@neondatabase/serverless`, `@electric-sql/pglite`, better-auth, `@aws-sdk/client-s3`,
    `@aws-sdk/s3-request-presigner`, resend, uuid;
  - files: `src/app.ts` (empty Hono app), `src/node.ts` (serves on `:8787`), `src/lambda.ts`
    (`hono/aws-lambda` handler), `drizzle.config.ts`, `.env.example` listing `DATABASE_URL`,
    `BETTER_AUTH_SECRET`, `ORIGIN_SECRET`, `R2_*`/`MINIO_*`, `RESEND_API_KEY`, `GOOGLE_*`.
- [ ] T009 [P] Scaffold `apps/web`:
  - Vite + React 19 + TypeScript, React Router, Tailwind CSS v4;
  - `vite.config.ts` proxies `/api` to `http://localhost:8787` (research R18);
  - `index.html` and `src/main.tsx`.
- [ ] T010 [P] Scaffold `apps/edge`:
  - `wrangler.jsonc` with `assets.directory = ../web/dist`,
    `assets.not_found_handling = "single-page-application"` and the Worker script running only
    for `/api/*`;
  - placeholder `src/index.ts`.
- [ ] T011 [P] Create `playwright.config.ts` with:
  - projects `mobile` (Pixel 7, viewport width 320) and `desktop` (1440×900);
  - a `webServer` running `pnpm dev`;
  - test directory `tests/e2e/`;
  - `@axe-core/playwright` installed.
- [ ] T012 [P] Create `docker-compose.yml` with MinIO and a one-shot bucket-creation container
  for local media (research R18).
- [ ] T013 Create the `sst.config.ts` skeleton (research R16):
  - providers: AWS (`ap-southeast-1`) and Cloudflare;
  - secrets: `DatabaseUrl`, `BetterAuthSecret`, `OriginSecret`, `R2AccessKeyId`,
    `R2SecretAccessKey`, `R2Bucket`, `R2Endpoint`, `ResendApiKey`, `GoogleClientId`,
    `GoogleClientSecret`;
  - Lambda: `apps/api/src/lambda.ts`, arm64, 512 MB, 15 s timeout, Function URL with auth NONE,
    CloudWatch log retention 14 days;
  - Cloudflare Worker: `apps/edge` with static assets `apps/web/dist`, bindings `LAMBDA_URL` and
    `ORIGIN_SECRET`;
  - an AWS Budgets alert at $1/month.
- [ ] T014 Add `scripts/verify.sh` (typecheck → lint → unit → int → contract → i18n → Playwright,
  all specs on both projects; k6 excluded) wired to `pnpm verify`, `.github/workflows/verify.yml` running it, and
  `.github/pull_request_template.md` with a constitution checklist:
  - Principle I items;
  - "failing test written first";
  - "regression test for bug fixes".

**Checkpoint**: `pnpm install && pnpm typecheck && pnpm lint` succeed. `pnpm dev` starts the API
and web.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the shared domain core, database, auth, API skeleton, edge proxy, pull sync and web
shell that every story needs.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

### Fixtures and pure domain core

- [ ] T015 [P] Write a JSON Schema for each fixture file in `packages/fixtures/schema/`
  (`fsrs-vectors`, `study-day`, `xp`, `queue`, `path-assign`, `path-status`, `streak`,
  `donut`). Write `packages/fixtures/tests/schema.test.ts`, which validates every
  `packages/fixtures/*.json` against its schema. It fails until fixtures exist.
- [ ] T016 [P] Add the FSRS reference vectors in `packages/fixtures/fsrs-vectors.json`, taken from
  the pinned `ts-fsrs` version's own test cases and the FSRS reference. Record `source`, `version`
  and `parameters` in the file header. Cover:
  - first review with each grade;
  - learning steps;
  - lapse → relearning;
  - maximum interval cap;
  - desired retention 0.70 and 0.97.
- [ ] T017 [P] Add `packages/fixtures/study-day.json` cases (research R14):
  - zones `Asia/Ho_Chi_Minh` and `America/New_York` (DST transitions);
  - `day_start_hour` 0, 4 (default) and 23;
  - instants just before and after the boundary.
- [ ] T018 [P] Add `packages/fixtures/xp.json` cases. Rule:
  - `xp = 0 if revoked or study_ahead or kind = reset`;
  - `2 otherwise`, with one case per grade (Again, Hard, Good, Easy) all giving 2 (FR-024);
  - session bonus `5 if completed and kind ≠ ahead`.
- [ ] T019 Write the failing test `packages/domain/tests/study-day.test.ts`, which runs every case
  in `study-day.json`.
- [ ] T020 Implement `studyDay(instant, timeZone, dayStartHour)` and
  `endOfStudyDay(studyDay, timeZone, dayStartHour)` in `packages/domain/src/time/study-day.ts`.
  `T019` must pass.
- [ ] T021 Write the failing test `packages/domain/tests/scheduler.test.ts`:
  - every case in `fsrs-vectors.json` gives identical `due`, `stability`, `difficulty`, `state`,
    `reps`, `lapses` (SC-004);
  - the same inputs give the same output twice;
  - fuzz is off;
  - `previewIntervals` returns 4 intervals ordered Again ≤ Hard ≤ Good ≤ Easy;
  - `desired_retention` outside "0.70–0.97" and `maximum_interval_days` outside "1–36500" are
    rejected.
- [ ] T022 Implement `packages/domain/src/scheduler/index.ts` (research R2):
  - `schedule(card, grade, now, params)` returns `{ card, log }`;
  - `previewIntervals(card, now, params)`;
  - `resetCard(card, now)`;
  - a `SCHEDULER_VERSION` constant (`ts-fsrs@<exact>/fsrs-6`);
  - wraps `ts-fsrs` with `enable_fuzz: false`.
- [ ] T023 [P] Write the failing test `packages/domain/tests/state-codec.test.ts`: round-trip of
  `FsrsState` ↔ `double precision[8]`
  `[stateCode, dueEpochSec, stability, difficulty, learningSteps, reps, lapses, lastReviewEpochSec]`
  (data-model ReviewLog). A null `lastReview` encodes as `NaN`.
- [ ] T024 [P] Implement `encodeState` and `decodeState` in
  `packages/domain/src/scheduler/state-codec.ts`.
- [ ] T025 Write the failing test `packages/domain/tests/replay.test.ts`:
  - replay in `(reviewed_at, id)` order;
  - revoked logs are skipped;
  - `kind = reset` returns the card to `new`;
  - out-of-order input gives the same result as sorted input;
  - the result equals applying `schedule` step by step.
- [ ] T026 Implement `replay(initialCard, logs, params)` in
  `packages/domain/src/scheduler/replay.ts`.
- [ ] T027 [P] Write the failing test `packages/domain/tests/xp.test.ts`, which runs `xp.json`.
- [ ] T028 [P] Implement `reviewXp(log)` and `sessionBonusXp(session)` in
  `packages/domain/src/gamification/xp.ts`.

### Contract package

- [ ] T029 Define the shared Zod schemas in `packages/contract/src/common.ts`:
  - `Problem` with `code` enum exactly: `validation_failed`, `not_found`, `deck_name_taken`,
    `card_limit_reached`, `media_quota_exceeded`, `media_too_large`, `unsupported_media_type`,
    `import_too_large`, `import_bad_encoding`, `export_invalid`, `rate_limited`,
    `reauth_required`;
  - `FsrsState`, `Deck`, `Card`, `Media`, `Settings`, `SettingsPatch`, `Stats`,
    `DailyActivity`, as specified in [contracts/openapi.yaml](./contracts/openapi.yaml);
  - security schemes `sessionCookie` and `bearerSession`.
- [ ] T030 Write `packages/contract/tests/openapi.test.ts`. For every path the generated document
  defines, it MUST deep-equal the same path in
  `specs/001-fsrs-gamified-learning/contracts/openapi.yaml`. A second test (`it.todo` until
  T157) asserts that the set of paths is complete.
- [ ] T031 Add `packages/contract/src/openapi.ts` (builds the document from registered routes) and
  the `gen:api` script, which runs `openapi-typescript` on the contract file and writes
  `apps/web/src/client/api-types.ts`.

### Database

- [ ] T032 Define the identity and learner tables in `apps/api/src/db/schema/learner.ts`:
  - the Better Auth tables;
  - `learner_settings` with defaults and CHECK constraints:
    - `locale` "vi | en";
    - `day_start_hour` "0–23, default 4";
    - `desired_retention` "0.70–0.97, default 0.90";
    - `maximum_interval_days` "1–36500, default 36500";
    - `daily_xp_goal` "One of 10, 20, 30, 50; default 20";
    - `session_size` "5–50, default 20";
    - `sound_enabled` default true;
    - `motion` "system | reduced | full", default `system`;
  - `learner_stats`, including `card_count` "≤ 20,000" and `media_bytes` "≤ 500 MB";
  - `device`.
- [ ] T033 [P] Define the content tables in `apps/api/src/db/schema/content.ts`:
  - `deck`:
    - `name` "1–100 chars after trimming; unique per user, case-insensitive, among non-deleted
      decks" (partial unique index on `lower(name)` where `deleted_at is null`);
    - `new_cards_per_day` "0–999, default 20";
    - `next_position`.
  - `card`:
    - `front` "1–10,000 chars", `back` "0–10,000";
    - `tags` "≤ 20 tags, each 1–50 chars, no whitespace";
    - `front_norm`;
    - FSRS columns: `difficulty` "1–10", `stability` "≥ 0";
    - `suspended`;
    - indexes `(user_id, deck_id, state, due)`, `(deck_id, node_index)`,
      `(deck_id, front_norm)`, `(user_id, change_seq)`.
  - `media_asset`: `bytes` "1 – 5,242,880", `status` "pending | ready".
- [ ] T034 [P] Define the activity tables in `apps/api/src/db/schema/activity.ts`:
  - `review_log`:
    - `id` client UUID primary key;
    - `kind` "review | reset";
    - `grade` 1–4, required when `kind = review`;
    - `duration_ms` "0 – 3,600,000 (clamped)";
    - `state_before` and `state_after` as `double precision[8]`;
    - `scheduler_version`, `revoked_at`;
  - `study_session`;
  - `daily_activity`, with PK `(user_id, study_day)`;
  - `import_job`, with `total_rows` "≤ 10,000" and `duplicate_mode` "skip | update | keep_both";
  - `rate_limit_bucket`.
- [ ] T035 Generate the migrations in `apps/api/drizzle/` and hand-write
  `apps/api/drizzle/0001_change_seq.sql`:
  - one global sequence;
  - triggers that set `change_seq` on insert or update for `learner_settings`, `learner_stats`,
    `deck`, `card`, `media_asset`, `daily_activity`.
- [ ] T036 Implement the DB client in `apps/api/src/db/client.ts`: Neon HTTP driver in production,
  PGlite injectable in tests. Add the test harness `apps/api/tests/helpers/db.ts`: a fresh PGlite
  with all migrations, a fixed clock, and user/deck/card factories.
- [ ] T037 Write the failing test `apps/api/tests/integration/migrations.test.ts`: apply every
  migration to PGlite seeded with review logs, replay every card with `replay()`, and assert the
  card FSRS columns are unchanged (constitution Principle II, migration rule).

### API skeleton, auth and edge

- [ ] T038 Implement the cross-cutting API code:
  - `apps/api/src/log.ts`: structured JSON logs with request id, user id hash, route, duration
    and outcome;
  - `apps/api/src/problem.ts`: `application/problem+json` error handler and Zod validation hook
    mapping to `validation_failed`;
  - `apps/api/src/app.ts`: route tree, request-id middleware.
- [ ] T039 [P] Write the failing test `apps/api/tests/integration/origin-guard.test.ts`:
  - 403 without `x-origin-secret` or with a wrong one;
  - accepts the current secret and, during rotation, the previous one;
  - the comparison is constant-time.
- [ ] T040 [P] Implement `apps/api/src/origin-guard.ts` and mount it first in `app.ts`. Skip it
  when `NODE_ENV=development` (Vite proxy).
- [ ] T041 Write the failing test `apps/api/tests/integration/auth.test.ts` (V13, V14):
  - sign-up sends a verification email (captured by the console sender);
  - an unverified user gets 401 on `/api/v1/*`;
  - after verification a cookie session works;
  - `Authorization: Bearer` works without a cookie;
  - a revoked token gets 401;
  - password reset works.
- [ ] T042 Implement Better Auth in `apps/api/src/auth.ts` (research R4):
  - Drizzle adapter, email/password with `requireEmailVerification`, password reset;
  - Google provider, including `idToken` sign-in;
  - `bearer` plugin;
  - Resend sender with console fallback;
  - built-in rate limit;
  - `trustedOrigins` and `baseURL` set to the app origin;
  - IP taken from `x-forwarded-for`.
  Mount it at `/api/auth/*`, and add `requireUser` middleware (verified users only) in
  `apps/api/src/middleware/require-user.ts`.
- [ ] T043 On user creation, insert `learner_settings` and `learner_stats` with their defaults,
  in `apps/api/src/services/account.ts`. `locale` comes from `Accept-Language` ("`vi` → `vi`,
  otherwise `en`") and `time_zone` from the client-sent IANA zone. Extend `T041` to assert this.
- [ ] T044 [P] Write the failing test `apps/api/tests/integration/rate-limit.test.ts`: the 61st
  request within a minute to `/api/v1/sync/*` or `/api/v1/decks/*/import` gets 429
  `rate_limited` with `Retry-After`; the counter is per user.
- [ ] T045 [P] Implement `apps/api/src/rate-limit.ts` (Postgres `rate_limit_bucket`, 60
  requests/min/user).
- [ ] T046 [P] Write the failing test `apps/edge/tests/proxy.test.ts`:
  - `/api/*` is forwarded to `LAMBDA_URL` with method, path, query, streamed body and `Cookie`;
  - an incoming `x-origin-secret` is stripped and replaced with the bound secret;
  - `x-forwarded-for` comes from `CF-Connecting-IP`;
  - `Set-Cookie` is returned unchanged;
  - the response is not cached;
  - non-`/api` paths never reach the script.
- [ ] T046a [P] Write the failing test `apps/edge/tests/headers.test.ts`, which parses
  `apps/web/public/_headers`:
  - `/assets/*` is `public, max-age=31536000, immutable`;
  - `/index.html` and `/sw.js` are `no-cache`;
  - the CSP has `object-src 'none'` and `script-src 'self'`, and no `unsafe-inline`.
- [ ] T047 [P] Implement the proxy in `apps/edge/src/index.ts` (`T046` must pass). Add
  `apps/web/public/_headers` (`T046a` must pass):
  - `/assets/*` `Cache-Control: public, max-age=31536000, immutable`;
  - `/index.html` and `/sw.js` `no-cache`;
  - a CSP: `default-src 'self'; img-src 'self' https: blob:; media-src 'self' https: blob:;
    script-src 'self'; object-src 'none'`.
- [ ] T048 Write the failing test `apps/api/tests/integration/settings.test.ts`: `PATCH
  /api/v1/me/settings` validates every range in `T032` and returns `Settings`.
- [ ] T049 Implement the `PATCH /api/v1/me/settings` route and service in
  `apps/api/src/routes/me.ts` and `apps/api/src/services/settings.ts`, with its contract schema
  registered in `packages/contract/src/me.ts`.

### Pull sync (read path used by every story)

- [ ] T050 Write the failing test `apps/api/tests/integration/sync-pull.test.ts`:
  - `cursor` and `limit` (1–2000, default 1000) return rows with `change_seq > cursor` in order;
  - `hasMore` paging;
  - tombstones for deleted decks, cards and media (content omitted);
  - only the caller's rows;
  - `Device.last_pull_seq` and `last_seen_at` are updated.
- [ ] T051 Implement `GET /api/v1/sync/pull` in `apps/api/src/sync/pull.ts` and
  `apps/api/src/routes/sync.ts`, with the contract in `packages/contract/src/sync.ts`. FSRS state
  is expanded from the card columns.
- [ ] T052 Implement the seed script `apps/api/scripts/seed.ts` (`pnpm db:seed`):
  - demo learner `demo@anki-duo.local` / `demo-password-123`;
  - decks "Từ vựng N3", "English idioms", "Media sample";
  - 90 days of history;
  - scenarios `--scenario=due25` and `--scenario=heavy` (20,000 cards, 3 years of history).

### Web foundation

- [ ] T053 [P] Write the failing test `apps/web/tests/local-store.test.ts` (fake-indexeddb). For
  every store in the data-model "Client store" table (`meta`, `settings`, `stats`, `decks`,
  `cards`, `media`, `outbox`, `sessions`, `dailyActivity`), test CRUD, the compound indexes
  `[deckId+state+due]` and `[deckId+nodeIndex]`, an atomic `gradeTransaction` (card update +
  outbox append), and that `clearAll()` empties everything.
- [ ] T054 [P] Define the `LocalStore` interface in `apps/web/src/client/local-store.ts`, the
  platform-neutral contract from research R6/R17.
- [ ] T055 Implement `DexieStore` in `apps/web/src/client/dexie-store.ts`. `T053` must pass.
- [ ] T056 [P] Implement the typed API client in `apps/web/src/client/api.ts` (openapi-fetch over
  `api-types.ts`, same-origin credentials, parsing of `application/problem+json` into a typed
  `ApiError` with `code`).
- [ ] T057 Write the failing test `apps/web/tests/sync/pull.test.ts`: the pull loop pages until
  `!hasMore`, applies tombstones, writes everything to `LocalStore`, and persists `pullCursor`.
- [ ] T058 Implement the pull half of the sync engine in `apps/web/src/client/sync/pull.ts` and
  the connectivity tracker `apps/web/src/client/connectivity.ts` (`online`/`offline` events plus
  a failed-request heuristic).
- [ ] T059 [P] Set up i18n in `apps/web/src/i18n/index.ts`:
  - i18next + react-i18next + i18next-icu;
  - initial locale from `navigator.languages` (`vi*` → `vi`, otherwise `en`); settings override
    it;
  - catalogs `apps/web/src/i18n/messages/vi.json` and `en.json`.
  Write the failing parity test `apps/web/tests/i18n.test.ts`: identical key sets and valid ICU
  messages (SC-009).
- [ ] T060 [P] Create the design tokens in `apps/web/src/styles/tokens.css`:
  - bright palette with every text/control pair ≥ 4.5:1 (WCAG 2.2 AA);
  - large radii;
  - chunky-button depth and press offset;
  - motion durations.
  Add `useMotionPreference()` in `apps/web/src/lib/motion.ts` (settings `system | reduced | full`
  + `prefers-reduced-motion`, FR-022).
- [ ] T061 [P] Write the failing test `apps/web/tests/components/ui.test.tsx`: `ChunkyButton` has
  an accessible name, visible focus and a pressed state; `ProgressBar` exposes `role=progressbar`
  with `aria-valuenow`; `Dialog` traps focus.
- [ ] T062 [P] Implement `ChunkyButton`, `ProgressBar`, `Dialog` and `Toast` in
  `apps/web/src/components/ui/`. `T061` must pass.
- [ ] T063 Implement the auth client `apps/web/src/client/auth.ts` (better-auth/react) and the
  auth routes in `apps/web/src/routes/auth/`: `SignInPage.tsx`, `SignUpPage.tsx`,
  `VerifyEmailPage.tsx`, `ResetPasswordPage.tsx`, with Google button.
- [ ] T063a [P] Write the failing test `apps/web/tests/sign-out.test.ts` (fake-indexeddb, a
  `caches` stub): after sign-out every `LocalStore` store is empty, `caches.keys()` holds no
  media or API cache, and a protected route redirects to sign-in.
- [ ] T064 Implement the router and app shell (`T063a` must pass):
  - `apps/web/src/routes/router.tsx` with a verified-session guard;
  - `apps/web/src/components/layout/AppLayout.tsx` (bottom nav on mobile, side nav ≥ 768 px,
    sync/connectivity indicator).
  Sign-out calls `LocalStore.clearAll()` and clears all caches (data-model: "Signing out clears
  every store and the media cache").
- [ ] T064a [P] Write the failing test `tests/e2e/pwa.spec.ts` (FR-032):
  - the manifest is valid: name, 192 px and 512 px icons, `display: standalone`;
  - the service worker is registered and controls the page;
  - offline, reloading `/` still shows the app shell.
- [ ] T065 Configure the PWA (`T064a` must pass):
  - `vite-plugin-pwa` (`injectManifest`) in `apps/web/vite.config.ts`, with the manifest (name,
    icons in `apps/web/public/icons/`, `display: standalone`, theme colours);
  - `apps/web/src/sw.ts`: precache, SPA navigation fallback, and network-first for API GETs.

**Checkpoint**: a learner can sign up, verify, sign in (cookie or bearer), and pull an empty or
seeded account into IndexedDB. Domain core tests pass. The edge proxy and origin guard work.

---

## Phase 3: User Story 1 - Review cards in a short FSRS-scheduled session (Priority: P1) 🎯 MVP

**Goal**: start a session from a deck, reveal and grade cards with Again/Hard/Good/Easy, see the
next card instantly, undo, resume, and work offline. Every grade is persisted losslessly, synced,
and replayed on the server.

**Independent Test**: with `pnpm db:seed`, run a session in "Từ vựng N3" to completion. Every
graded card's due date matches the FSRS reference for its history and grade (V1, V2). Reviews
survive offline and tab closes (V3), and appear on a second device (V4).

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [ ] T066 [P] [US1] Add review-session cases to `packages/fixtures/queue.json`:
  - `review` kind: learning/relearning first, then `due` ascending, up to `session_size`;
  - 5 due + 10 new, `session_size` 20, new limit 10: 5 due then 10 new (Story 1 #1);
  - 25 due + 10 new, `session_size` 20: 20 due and no new card (FR-006);
  - new cards capped by `deck.new_cards_per_day − introduced_today`;
    suspended cards excluded; `due ≤ end of study day`;
  - `ahead` kind: Review cards not yet due, by `due` ascending;
  - re-queue of a card graded Again whose next due falls before the session ends;
  - progress counts each queued card once.
- [ ] T067 [P] [US1] Write the failing test `packages/domain/tests/queue.test.ts`, which runs
  every `queue.json` case for the `review` and `ahead` kinds.
- [ ] T068 [P] [US1] Write the failing test `apps/web/tests/session/session-machine.test.ts`:
  - reveal shows four interval labels (FR-002);
  - grading advances to the next card synchronously, before `gradeTransaction` resolves
    (FR-016);
  - undo restores the previous card snapshot and drops the unsent outbox event, or emits a
    `revoke` when already pushed (FR-008, R7);
  - the Again re-queue (Story 1 #6);
  - resume from `LocalStore.sessions` after reload (FR-019);
  - the summary has cards reviewed, accuracy (grade ≥ 2), time and XP (Story 1 #5);
  - `study_ahead` is set for ahead sessions.
- [ ] T069 [P] [US1] Write the failing test `apps/web/tests/sync/push.test.ts`:
  - the outbox is pushed in batches of ≤ 500;
  - acknowledged (`applied`/`duplicate`) events are removed;
  - `rejected` events are removed and reported to `/api/v1/client-events`;
  - network errors retry with exponential backoff (max 60 s);
  - triggers: app start, `online` event, every 30 s while visible and online, and after a
    session ends;
  - a pull runs after each push.
- [ ] T070 [P] [US1] Write the failing test `apps/api/tests/integration/sync-push.test.ts` (V4,
  V14):
  - the same event id pushed twice gives `duplicate` and no second row;
  - `reviewedAt` more than 5 min in the future gives `future_timestamp`;
  - unknown card gives `card_not_found`;
  - grade outside 1–4 gives `invalid_grade`;
  - an out-of-order review triggers a replay, and the card equals `replay()` of all logs;
  - a client `stateAfter` that differs from the truth is ignored and the server's replayed state
    is stored;
  - a revoke sets `revoked_at` and replays, and a revoke of an unknown review gives
    `review_not_found`;
  - `session` events upsert by id;
  - at most 500 events per request.
- [ ] T071 [P] [US1] Write the failing test `apps/web/tests/components/card-content.test.tsx`:
  - Markdown renders bold, lists, code and GFM tables;
  - raw HTML and `<script>` render as text;
  - `javascript:` links are stripped;
  - non-`https` external images are blocked (FR-010, FR-034).
- [ ] T072 [P] [US1] Write the e2e test `tests/e2e/session.spec.ts` (V2): reveal and grade with
  touch (mobile) and `Space`/`1`–`4`/`Z` (desktop). With CPU throttling ×4, 95% of grade →
  next-card paint times are ≤ 100 ms (SC-001).
- [ ] T073 [P] [US1] Write the e2e test `tests/e2e/offline.spec.ts` (V3, SC-005): 500 grades with
  random offline toggles and tab reloads. After reconnecting, the server holds exactly 500
  non-revoked review logs and the local cards match the server.
- [ ] T074 [P] [US1] Write the e2e test `tests/e2e/two-devices.spec.ts` (V4, SC-008):
  - two browser contexts signed in as the same learner;
  - a grade on A is visible on B within 60 s;
  - grading the same card offline on both devices, then reconnecting, keeps both logs, and the
    card equals a replay in `(reviewed_at, id)` order.

### Implementation for User Story 1

- [ ] T075 [US1] Implement `buildQueue({ kind: 'review' | 'ahead', cards, now, settings,
  studyDayEnd, introducedToday })` and `requeueAfterGrade()` in `packages/domain/src/queue/build-queue.ts`.
  `T067` must pass for these kinds.
- [ ] T076 [US1] Register the push contract schemas `ReviewEvent`, `RevokeEvent`,
  `SessionEvent`, `DayFlagEvent` (discriminator `type`, `events` maxItems 500) in
  `packages/contract/src/sync.ts`.
- [ ] T077 [US1] Implement `POST /api/v1/sync/push` in `apps/api/src/sync/push.ts`:
  - insert with `ON CONFLICT (id) DO NOTHING`;
  - derive `was_new`, `was_due`, `study_ahead` and `xp` (`reviewXp`) on the server;
  - store the compact state via `encodeState`;
  - replay the card when a log is older than `last_review` or a revoke arrives;
  - upsert `study_session`;
  - accept `day_flag` (stored for US4);
  - return per-event results.
  `T070` must pass.
- [ ] T078 [US1] Implement the push half of the sync engine in
  `apps/web/src/client/sync/push.ts` and the scheduler of sync triggers in
  `apps/web/src/client/sync/sync-engine.ts`. `T069` must pass.
- [ ] T079 [US1] Implement the session state machine in
  `apps/web/src/client/session/session-machine.ts`:
  - loads the queue via `buildQueue`;
  - grades with `schedule()` and `LocalStore.gradeTransaction` without awaiting it;
  - keeps an undo snapshot;
  - persists progress to `sessions`;
  - emits `SessionEvent` on start and end.
  `T068` must pass.
- [ ] T080 [P] [US1] Implement `CardContent` in
  `apps/web/src/components/session/CardContent.tsx` (react-markdown + remark-gfm +
  rehype-sanitize strict schema, research R11). `T071` must pass.
- [ ] T081 [P] [US1] Implement `GradeBar` in `apps/web/src/components/session/GradeBar.tsx`:
  - four `ChunkyButton`s labelled with grade name and preview interval (e.g. "Good · 3d"), in
    vi/en;
  - keyboard `1`–`4`; `Space` reveals;
  - stays reachable when content is long (edge case).
- [ ] T082 [US1] Implement `SessionPage` in `apps/web/src/routes/session/SessionPage.tsx`:
  - card area with an internal scroll;
  - reveal, grade bar, undo (`Z` / button), progress bar (FR-015);
  - summary screen;
  - resume prompt on return.
- [ ] T083 [US1] Implement `DeckListPage` in `apps/web/src/routes/decks/DeckListPage.tsx`: decks
  with counts of due and new cards today from `LocalStore`, and a "Review" button that starts a
  `review` session.
- [ ] T084 [US1] Implement the empty state in `apps/web/src/routes/session/EmptyQueue.tsx`. With
  nothing due and no new cards left, it shows the next due time and an optional "Study ahead"
  that starts an `ahead` session (edge case; 0 XP).
- [ ] T085 [US1] Implement the learning section of `SettingsPage` in
  `apps/web/src/routes/settings/SettingsPage.tsx`: desired retention ("70–97%", default 90%),
  maximum interval, session size ("5–50", default 20), day-start hour. Saved through
  `PATCH /me/settings` and applied to future reviews only (FR-004).
- [ ] T086 [US1] Show a toast when a save fails permanently, and a "Saved"/"Offline – will sync"
  indicator in `apps/web/src/components/layout/AppLayout.tsx` (edge case: optimistic save
  failures are never silent).

**Checkpoint**: User Story 1 is fully functional and testable with seeded decks (V1–V4 pass).

---

## Phase 4: User Story 2 - Create decks and cards, including CSV/TSV import (Priority: P1)

**Goal**: deck CRUD; card CRUD with Markdown, images and audio; suspend and reset; CSV/TSV
import with mapping, preview, duplicate handling and a report; export and restore; offline
media for today's cards.

**Independent Test**: import `packages/fixtures/import/basic-200.tsv` into a new deck. The preview
and final count match the file. Then edit one card to add an image and audio, and both render
(V5, V6). Export and restore give identical scheduling state (V11).

### Tests for User Story 2 ⚠️

- [ ] T087 [P] [US2] Add `packages/fixtures/path-assign.json`: creating cards in an empty deck,
  in a deck whose last node has fewer than 10 cards, and in a deck whose last node is full.
  Assignments never change after deletion.
- [ ] T088 [P] [US2] Add the import fixtures in `packages/fixtures/import/`: `basic-200.tsv`,
  `semicolon-header.csv`, `malformed.csv`, `dupes.csv`, `10000-rows.csv`, `latin1.csv`,
  `one-column.csv`, `bom-utf8.csv`, and `expected.json` with the expected detection and per-row
  results.
- [ ] T089 [P] [US2] Write the failing test `packages/domain/tests/path-assign.test.ts`, which
  runs `path-assign.json`.
- [ ] T090 [P] [US2] Write the failing test `packages/domain/tests/import-rows.test.ts`:
  - `normaliseFront` (lower-case, NFC, trimmed, whitespace collapsed);
  - row reason codes `empty_front`, `front_too_long`, `back_too_long`, `too_many_tags`,
    `tag_invalid`, `malformed_row`, `duplicate_skipped`, `card_limit_reached`;
  - tags split on whitespace or `;`.
- [ ] T091 [P] [US2] Write the failing test `apps/api/tests/integration/decks.test.ts`:
  - create, rename, delete;
  - `name` "1–100 chars after trimming; unique per user, case-insensitive, among non-deleted
    decks" gives `deck_name_taken` (409);
  - `newCardsPerDay` "0–999";
  - delete removes cards, media objects and review logs, and leaves a tombstone visible in pull.
- [ ] T092 [P] [US2] Write the failing test `apps/api/tests/integration/cards.test.ts`:
  - `front` "1–10,000 chars", `back` "0–10,000";
  - `tags` "≤ 20 tags, each 1–50 chars, no whitespace";
  - `position` and `node_index` assignment;
  - `card_limit_reached` at 20,000 cards per learner;
  - editing content never changes the FSRS columns;
  - suspend excludes the card from pulls' due counts;
  - `POST /cards/{id}/reset` writes a `ReviewLog` with `kind=reset` and the card becomes `new`
    (FR-012).
- [ ] T093 [P] [US2] Write the failing test `apps/api/tests/integration/import.test.ts`
  (contracts/csv-import.md):
  - chunks of ≤ 1,000 rows with the same `jobId`;
  - re-sending a `chunkIndex` is idempotent;
  - duplicate modes `skip` / `update` (Back and Tags replaced, scheduling unchanged) /
    `keep_both`;
  - duplicates within the same file;
  - cumulative totals;
  - `isLast` sets `completed_at`;
  - `totalRows` > 10,000 gives `import_too_large`;
  - cards get `position` and `node_index` in file order.
- [ ] T094 [P] [US2] Write the failing test `apps/web/tests/import/parse.test.ts`, which runs
  `expected.json` for every fixture file:
  - delimiter detection among `,` `;` `\t` `|`;
  - header detection with names `front`, `back`, `tags`, `question`, `answer`, `mặt trước`,
    `mặt sau`, `thẻ`;
  - RFC 4180 quoting;
  - UTF-8 with or without BOM; `latin1.csv` rejected with `import_bad_encoding` before any API
    call;
  - more than 10 MB or 10,000 rows rejected with `import_too_large`;
  - a 1-column file gives `single_column`.
- [ ] T095 [P] [US2] Write the failing test `apps/api/tests/integration/media.test.ts`:
  - `upload-url` accepts only `image/png`, `image/jpeg`, `image/webp`, `image/gif`,
    `image/svg+xml`, `audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/ogg`, `audio/wav`, and
    `bytes` "1 – 5,242,880";
  - more bytes gives `media_too_large` (413); another MIME gives `unsupported_media_type` (415);
  - more than 500 MB per learner gives `media_quota_exceeded`;
  - `complete` verifies the object's size and type (MinIO);
  - `pending` rows older than 24 h are purged;
  - `GET /media/{id}` returns 302 for the owner and 404 for others;
  - `DELETE` removes the object and the row.
- [ ] T096 [P] [US2] Write the failing test `apps/api/tests/integration/export-restore.test.ts`
  (V11, contracts/export-format.md):
  - export contains `format`, `version: 1`, scheduler parameters, cards, full review history
    (including revoked) and a media manifest with `sha256`;
  - restore creates a new deck with new ids and identical FSRS state for every card;
  - a tampered history fails with `export_invalid` and creates nothing;
  - restore applies the 20,000-card limit.
- [ ] T097 [P] [US2] Write the failing test `apps/web/tests/media/media-selection.test.ts`:
  `mediaForToday(queueCards, mediaRows)` returns exactly the media of today's due and new cards;
  `evictionPlan` keeps the cache ≤ 200 MB and never evicts media for today's queue.
- [ ] T098 [P] [US2] Write the e2e test `tests/e2e/editor.spec.ts` (V5):
  - deck CRUD with delete confirmation;
  - card with `**bold**`, a table and `<script>alert(1)</script>` (no dialog fires);
  - PNG on the front, MP3 on the back with a replay button in review;
  - a 6 MB image is rejected with the limit shown;
  - with the network offline, create/edit/delete/import are disabled with a "needs connection"
    message and review still works with images and audio (FR-017).
- [ ] T099 [P] [US2] Write the e2e test `tests/e2e/import.spec.ts` (V6): `basic-200.tsv` from
  sign-up to the first graded card in < 3 min (SC-002); `10000-rows.csv` finishes in < 15 s with
  accurate counts (SC-006); the skipped-rows report can be downloaded as CSV.

### Implementation for User Story 2

- [ ] T100 [P] [US2] Implement `assignNodeIndex(lastNodeIndex, lastNodeCount)` in
  `packages/domain/src/path/assign.ts`: "if the deck's last node has fewer than 10 cards, use
  that node; otherwise use last + 1". `T089` must pass.
- [ ] T101 [P] [US2] Implement `normaliseFront`, `validateRow` and `splitTags` in
  `packages/domain/src/import/rows.ts`. `T090` must pass.
- [ ] T102 [US2] Register the contract schemas for decks, cards (create and patch), reset, import,
  export/restore and media in `packages/contract/src/decks.ts`, `cards.ts`, `import.ts`,
  `export.ts` and `media.ts`, exactly as in contracts/openapi.yaml.
- [ ] T103 [US2] Implement the deck service and routes (`POST /decks`, `PATCH /decks/{id}`,
  `DELETE /decks/{id}`) in `apps/api/src/services/decks.ts` and `apps/api/src/routes/decks.ts`.
  `T091` must pass.
- [ ] T104 [US2] Implement the card service and routes (`POST /decks/{id}/cards`,
  `PATCH /cards/{id}`, `DELETE /cards/{id}`, `POST /cards/{id}/reset`) in
  `apps/api/src/services/cards.ts` and `apps/api/src/routes/cards.ts`:
  - `position` comes from `deck.next_position` and `node_index` from `assignNodeIndex`;
  - `front_norm` is stored;
  - `learner_stats.card_count` is updated.
  `T092` must pass.
- [ ] T105 [US2] Implement the import service and route (`POST /decks/{id}/import`) in
  `apps/api/src/services/import.ts` and `apps/api/src/routes/import.ts`. `T093` must pass.
- [ ] T106 [US2] Implement `apps/api/src/storage.ts` (R2/MinIO presign PUT and GET, `HeadObject`
  verify, delete), the media service and routes in `apps/api/src/services/media.ts` and
  `apps/api/src/routes/media.ts`, and the pending purge job (run opportunistically on
  `upload-url`). `T095` must pass.
- [ ] T107 [US2] Implement the export schema and verifier in
  `packages/domain/src/export/schema.ts`, and the export/restore service and routes
  (`GET /decks/{id}/export`, `POST /decks/restore`) in `apps/api/src/services/export.ts` and
  `apps/api/src/routes/export.ts`. Restore replays the history and verifies equality. `T096` must
  pass.
- [ ] T108 [P] [US2] Implement the import parser Web Worker in
  `apps/web/src/client/import/parse.worker.ts` (Papa Parse, encoding check, limits, header
  heuristic). `T094` must pass.
- [ ] T109 [US2] Implement `useOnlineOnly()` in `apps/web/src/client/online-only.ts`. It disables
  wrapped actions while offline and shows a "needs connection" message (FR-017).
- [ ] T110 [US2] Extend `DeckListPage` (`apps/web/src/routes/decks/DeckListPage.tsx`) and add
  `apps/web/src/routes/decks/DeckSettingsDialog.tsx`: create, rename, "new cards per day", and
  delete with a confirmation `Dialog` that names the deck and its card count.
- [ ] T111 [US2] Implement `CardListPage` in `apps/web/src/routes/cards/CardListPage.tsx`: search
  over front and back, tag filter, suspend/unsuspend, reset to New with confirmation, delete
  (FR-009, FR-012).
- [ ] T112 [US2] Implement `CardEditorPage` in `apps/web/src/routes/cards/CardEditorPage.tsx`:
  front and back Markdown editors with a live preview using `CardContent`, a tags input, and
  validation messages for the limits in `T092`.
- [ ] T113 [US2] Implement `MediaPicker` in `apps/web/src/components/editor/MediaPicker.tsx`
  (upload-url → direct PUT → complete, with progress and limit errors). Extend `CardContent` to
  render `![alt](media:{id})` and `[[audio:{id}]]` with an audio replay control (Story 2 #3).
- [ ] T114 [US2] Implement the offline media cache:
  - `apps/web/src/client/media-cache.ts`: `mediaForToday` and `evictionPlan`, which ask the
    service worker to prefetch and evict after each pull;
  - a `/api/v1/media/*` cache-first route and message handler in `apps/web/src/sw.ts`;
  - a placeholder for media that wasn't downloaded (edge case).
  `T097` must pass.
- [ ] T115 [US2] Implement `ImportPage` in `apps/web/src/routes/import/ImportPage.tsx`:
  - file pick;
  - delimiter and header overrides;
  - column mapping (Front required, Back and Tags optional);
  - preview of the first 10 rows as cards, with total, invalid and estimated duplicate counts;
  - duplicate-mode choice;
  - chunked upload with a progress bar;
  - final report table with downloadable CSV.
- [ ] T116 [US2] Add export and restore actions to `DeckSettingsDialog` and `DeckListPage`:
  download `{deck-name}.anki-duo.json`, and restore from a file with an error message for
  `export_invalid`.

**Checkpoint**: User Stories 1 and 2 both work on their own (V5, V6, V11 pass).

---

## Phase 5: User Story 3 - Duolingo-style learning path (skill tree) (Priority: P2)

**Goal**: each deck is shown as a winding path of 10-card nodes with locked, available, in
progress and completed states and a mastery level. Node sessions contain due cards first, then
the node's new cards. The Review entry point is never locked.

**Independent Test**: import 25 new cards into an empty deck. The path shows 10/10/5 nodes,
node 1 available and nodes 2–3 locked. Finishing node 1 unlocks node 2 with an animation. With
`--scenario=due25`, a node session holds only the 10 most overdue cards and no new card; once no
card is due, it holds the node's 10 new cards (V7).

### Tests for User Story 3 ⚠️

- [ ] T117 [P] [US3] Add `packages/fixtures/path-status.json` (data-model "Path" rules):
  - `completed` when `studied_count = card count` or no non-suspended new cards remain;
  - `available` for node 0, or when the previous node is completed and `studied_count = 0`;
  - `in_progress` when available and `0 < studied_count < card count`;
  - `locked` otherwise;
  - mastery = cards in `review` ÷ cards in the node.
- [ ] T118 [P] [US3] Add `node` session cases to `packages/fixtures/queue.json` (FR-023a):
  - up to 10 due cards, most overdue first;
  - 6 due: the 6 due cards, then the node's `new` cards by `position`, up to 10, capped by
    `deck.new_cards_per_day − introduced_today`;
  - 11 or 25 due: the 10 most overdue due cards and no new card (FR-006);
  - remaining due cards are not included.
- [ ] T119 [P] [US3] Write the failing test `packages/domain/tests/path-status.test.ts`, which runs
  `path-status.json`, and extend `packages/domain/tests/queue.test.ts` to the `node` kind.
- [ ] T120 [P] [US3] Write the e2e test `tests/e2e/path.spec.ts` (V7):
  - node layout and states;
  - a locked tap shows "finish node N first" and starts no session;
  - the Review entry is visible and enabled with due cards;
  - the node session composition with `due25` (due only, with the "review the remaining due
    cards" message) and after clearing the Review entry (10 new cards);
  - completion unlocks the next node;
  - with reduced motion, the unlock uses a fade.

### Implementation for User Story 3

- [ ] T121 [P] [US3] Implement `pathNodes(cards)` (status, studied count, mastery) in
  `packages/domain/src/path/status.ts`. `T119` (path part) must pass.
- [ ] T122 [P] [US3] Extend `buildQueue` with the `node` kind in
  `packages/domain/src/queue/build-queue.ts`. `T119` (queue part) must pass.
- [ ] T123 [US3] Implement the path components:
  - `PathMap` in `apps/web/src/components/path/PathMap.tsx`: a winding layout of round nodes that
    works from 320 px to desktop, and auto-scrolls to the current node;
  - `PathNode` in `apps/web/src/components/path/PathNode.tsx`: states with icon, text label and
    colour (not colour alone); a gentle bounce on the current node; a mastery ring; an unlock
    animation via Motion with a reduced-motion fallback.
- [ ] T124 [US3] Implement `PathPage` in `apps/web/src/routes/path/PathPage.tsx`:
  - a pinned "Review (N)" entry that is never locked;
  - a locked-node message;
  - tapping an available or in-progress node starts a `node` session;
  - returning from a session animates the progress change.
  Make the deck list open the path by default.

**Checkpoint**: User Stories 1–3 work on their own (V7 passes).

---

## Phase 6: User Story 4 - Streak, XP and in-session feedback (Priority: P2)

**Goal**: XP per review and per completed session, a daily XP goal (10/20/30/50), streaks
(current, longest, at risk), playful sounds and animations, and a home screen with streak,
today's XP/goal and the number of cards due.

**Independent Test**: with a simulated clock, complete a session on day 1 and day 2. XP totals
are correct and the streak shows 2. Skipping day 3 resets it to 0 on day 4 while keeping the
longest. Finishing every available card in a 3-card deck meets the goal (V8).

### Tests for User Story 4 ⚠️

- [ ] T125 [P] [US4] Add `packages/fixtures/streak.json`:
  - goal options "10, 20, 30, 50";
  - `goal_met = xp ≥ goal_xp OR all_available_done`;
  - consecutive met days ending yesterday, plus today if met;
  - "today unmet but yesterday met" is *at risk*;
  - reset after a full missed day;
  - `longest_streak` never decreases;
  - day boundaries at 04:00 local in `Asia/Ho_Chi_Minh`.
- [ ] T126 [P] [US4] Write the failing test `packages/domain/tests/streak.test.ts`, which runs
  `streak.json`.
- [ ] T127 [P] [US4] Write the failing test `apps/api/tests/integration/activity.test.ts`:
  - `daily_activity` is recomputed for the affected study days on push and on revoke;
  - `reviews` counts non-revoked `kind=review` logs;
  - `xp` is review XP plus session bonuses;
  - `goal_xp` is a snapshot of the setting;
  - a `day_flag` sets `all_available_done`;
  - `learner_stats.total_xp`, `current_streak` and `longest_streak` are correct;
  - a revoke reverses XP (Story 1 #4).
- [ ] T128 [P] [US4] Write the failing test `apps/web/tests/gamification/day-flag.test.ts`: after
  a session, if no due card remains and the new-card allowance is used up for every deck, a
  `DayFlagEvent` is queued once per study day. Optimistic stats update immediately.
- [ ] T129 [P] [US4] Write the failing test `apps/web/tests/components/home.test.tsx`:
  - the streak flame with its count;
  - the at-risk styling and text;
  - today's XP vs goal progress;
  - the cards-due count (FR-026);
  - the celebration shows when the goal is crossed during a session (Story 4 #2).

### Implementation for User Story 4

- [ ] T130 [US4] Implement `goalMet`, `currentStreak`, `longestStreak` and `streakStatus`
  (`met | at_risk | broken`) in `packages/domain/src/gamification/streak.ts`. `T126` must pass.
- [ ] T131 [US4] Implement the activity recompute in `apps/api/src/services/activity.ts`, called
  in the same transaction from `apps/api/src/sync/push.ts` (reviews, revokes, sessions, day
  flags). `T127` must pass.
- [ ] T132 [US4] Implement the client gamification in `apps/web/src/client/gamification.ts`:
  optimistic XP and streak in `LocalStore.stats` and `dailyActivity`, plus the day-flag
  emission. `T128` must pass.
- [ ] T132a [P] [US4] Write the failing test `apps/web/tests/sound.test.ts` with a fake
  `AudioContext`: nothing plays before the first user gesture; nothing plays when
  `sound_enabled` is false; all four grades play the same `graded` sound (FR-021, FR-024).
- [ ] T133 [P] [US4] Implement `apps/web/src/client/sound.ts` (Web Audio, preloaded sprites from
  `apps/web/public/sounds/` for graded, complete and streak in OGG + MP3). It only plays
  after the first user gesture and when `sound_enabled` is true (FR-021). `T132a` must pass.
- [ ] T134 [P] [US4] Implement the in-session feedback:
  - a spring for the progress bar in `ProgressBar`;
  - one grade-neutral micro-animation in `apps/web/src/components/session/GradeFeedback.tsx`
    (after Again it is neutral or encouraging, never a "mistake" cue; FR-021);
  - `Celebration.tsx` (goal met, streak +1) in `apps/web/src/components/session/`;
  - every animation goes through `useMotionPreference()` (FR-022).
- [ ] T135 [US4] Implement `HomePage` in `apps/web/src/routes/home/HomePage.tsx` and make it the
  index route. It has the streak flame (met / at risk), today's XP vs goal ring, a cards-due
  count with "Start" (opens the first deck with due cards), and the per-deck list. `T129` must
  pass.
- [ ] T136 [US4] Add the gamification section to `apps/web/src/routes/settings/SettingsPage.tsx`:
  a daily XP goal selector "10 / 20 / 30 / 50 (default 20)", a sound on/off toggle, and motion
  "system / reduced / full".

**Checkpoint**: User Stories 1–4 work on their own (V8 passes).

---

## Phase 7: User Story 5 - Progress dashboard (Priority: P3)

**Goal**: a 12-month review heatmap; a donut of New/Learning/Due/Not due/Suspended whose
segments sum to the card count, with today's workload in the centre; current and longest streak
and total XP; a deck filter.

**Independent Test**: with 90 days of seeded history, heatmap intensities match daily review
counts and donut segments match card counts per state. Filtering by deck updates every figure
(V9).

### Tests for User Story 5 ⚠️

- [ ] T137 [P] [US5] Add `packages/fixtures/donut.json` (data-model "Dashboard donut segments",
  checked in order: Suspended → New → Learning → Due (`review` and `due ≤ end of current study
  day`) → Not due), including the expected centre value: "Due + Learning that are due today + New
  still allowed today".
- [ ] T138 [P] [US5] Write the failing test `packages/domain/tests/stats.test.ts`:
  - runs `donut.json`;
  - a property-based test (fast-check) that the sum of segments equals the card count for random
    card sets;
  - heatmap bucketing into 5 intensity levels over the last 12 months from `dailyActivity`.
- [ ] T139 [P] [US5] Write the failing test `apps/web/tests/components/charts.test.tsx`:
  - `DonutRing` renders 5 labelled segments with numbers, readable without colour;
  - `Heatmap` cells have accessible names ("{date}: {n} reviews") and a tooltip on hover and on
    tap/focus.
- [ ] T140 [P] [US5] Write the e2e test `tests/e2e/dashboard.spec.ts` (V9): seeded learner values,
  deck filter, keyboard navigation of heatmap cells.

### Implementation for User Story 5

- [ ] T141 [P] [US5] Implement `classifyCard`, `donutCounts` and `todayWorkload` in
  `packages/domain/src/stats/donut.ts`, and `heatmapBuckets` in
  `packages/domain/src/stats/heatmap.ts`. `T138` must pass.
- [ ] T142 [P] [US5] Implement `DonutRing` in `apps/web/src/components/charts/DonutRing.tsx` and
  `Heatmap` in `apps/web/src/components/charts/Heatmap.tsx` as hand-built SVG, scrolling
  horizontally inside its own container on narrow screens (research R9). `T139` must pass.
- [ ] T143 [US5] Implement `DashboardPage` in `apps/web/src/routes/dashboard/DashboardPage.tsx`:
  heatmap, donut with centre workload, current and longest streak, total XP, and a deck filter
  (all figures computed from `LocalStore`, so they work offline).

**Checkpoint**: all five user stories work on their own.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: account lifecycle, language switch, observability, accessibility, responsiveness,
scale, security, deployment and final validation.

- [ ] T144 Write the failing test `apps/api/tests/integration/account-delete.test.ts` (V13): `DELETE
  /api/v1/me` requires a session signed in within the last 10 minutes, otherwise 403
  `reauth_required`. It removes every row for the user and every R2 object under
  `u/{user_id}/`.
- [ ] T145 Implement `DELETE /api/v1/me` in `apps/api/src/services/account.ts` and
  `apps/api/src/routes/me.ts`. Add the "Delete account" danger zone (re-auth, then confirm) and
  "Sign out" to `SettingsPage` (FR-030).
- [ ] T146 [P] Add the language switch (vi/en) to `SettingsPage`. It saves to the account, takes
  effect immediately without losing the current screen or an in-progress session (FR-031,
  SC-009), and is covered by a new case in `tests/e2e/session.spec.ts`.
- [ ] T147 [P] Implement `POST /api/v1/client-events` in `apps/api/src/routes/client-events.ts`
  (max message 2000 chars, logged via `log.ts`) and the client reporter
  `apps/web/src/client/report.ts` (uncaught errors plus sync failures, de-duplicated, rate-limited
  on the client).
- [ ] T148 [P] Write `tests/e2e/responsive.spec.ts` (V10, SC-007): no horizontal scroll on home,
  path, session, editor, import and dashboard at 320, 768 and 1440 px. Fix any overflow it finds.
- [ ] T149 [P] Write `tests/e2e/a11y.spec.ts` (V10, FR-033): axe on every primary screen finds
  zero serious or critical violations. Every review action works with the keyboard alone. Fix
  what it finds.
- [ ] T150 [P] Complete the vi and en translations for every screen, the API `Problem.code`
  values and the import reason codes in `apps/web/src/i18n/messages/`. `pnpm test:i18n` passes.
- [ ] T151 Write the k6 load script `tests/load/sync-mix.js` (V12, SC-010): 100 VUs doing a
  pull/push mix against the staging app URL. Report p95 and cold-start latency, and Neon
  storage per 100k review logs. Run it against `pnpm db:seed --scenario=heavy`.
- [ ] T152 Tune performance from `T151` and SC-001:
  - query plans for the pull and queue indexes in `apps/api/src/sync/pull.ts` and
    `apps/api/drizzle/`;
  - Lambda bundle size (esbuild minify, tree-shaken AWS SDK) in `sst.config.ts`;
  - IndexedDB queries for 20,000 cards in `apps/web/src/client/dexie-store.ts`;
  - lazy-loaded routes in `apps/web/src/routes/router.tsx`;
  - an initial JS bundle ≤ 200 KB gzip for the session route.
- [ ] T153 [P] Security hardening:
  - cookie flags (`httpOnly`, `Secure`, `SameSite=Lax`);
  - CSP verification in `apps/web/public/_headers`;
  - SVG media served only via `<img>`;
  - every `/api/v1` route rejects other users' ids (an integration test sweep in
    `apps/api/tests/integration/authorization.test.ts`).
- [ ] T154 [P] Write `README.md`: an overview, the local setup and deploy steps from
  `quickstart.md`, the architecture diagram (edge → Lambda → Neon/R2), and "how to add a domain
  rule" (fixture first).
- [ ] T155 Deploy the `staging` stage with `pnpm sst deploy --stage staging` and run the
  quickstart post-deploy checks:
  - sign-in screen;
  - 401 problem from `/api/v1/sync/pull`;
  - 403 when calling the Lambda URL directly;
  - SPA deep-link reload;
  - no CORS preflight;
  - cache headers.
- [ ] T156 Run the whole `quickstart.md` validation (V1–V14) against `staging` and record the
  results in `specs/001-fsrs-gamified-learning/checklists/validation.md`.
- [ ] T157 Change the contract completeness test from `it.todo` to an active test in
  `packages/contract/tests/openapi.test.ts`: the generated document's paths equal those in
  `contracts/openapi.yaml`. Smoke-generate a Dart client with
  `openapi-generator-cli generate -g dart-dio` (V14; not committed).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup and BLOCKS every user story.
- **US1 (Phase 3)** and **US2 (Phase 4)**: both depend only on Foundational. They can run in
  parallel.
- **US3 (Phase 5)**: depends on Foundational. It uses `node_index` from US2 (`T100`/`T104`) to
  have real nodes, and the session machine from US1 (`T079`, `T082`) to run node sessions.
  Its domain tasks (`T117`–`T122`) can start right after Foundational.
- **US4 (Phase 6)**: depends on Foundational and on US1's push (`T077`) and session machine
  (`T079`), which it hooks into.
- **US5 (Phase 7)**: depends on Foundational and on `dailyActivity` from US4 (`T131`) for the
  heatmap. The donut part only needs Foundational.
- **Polish (Phase 8)**: depends on every story you intend to ship.

### User Story Dependency Graph

```text
Setup ─▶ Foundational ─┬─▶ US1 (P1) ─┬────────────────▶ US4 (P2) ─▶ US5 (P3) ─┐
                       │             │                                       ├─▶ Polish
                       └─▶ US2 (P1) ─┴─▶ US3 (P2) (needs US1 + US2) ─────────┘
```

- US3 needs US1 (sessions) and US2 (`node_index`).
- US4 needs US1 (push, session machine).
- US5's heatmap needs US4 (`daily_activity`).

### Within Each User Story

- Fixtures, then failing tests, then implementation (Principle II). Never implement before the
  test is red.
- Domain (`packages/domain`), then contract (`packages/contract`), then API (`apps/api`), then
  web client logic (`apps/web/src/client`), then UI (`apps/web/src/routes`, `components`).
- Finish the story and pass its checkpoint before starting the next priority, if working alone.

### Parallel Opportunities

- **Setup**: T002–T012 are all [P].
- **Foundational**:
  - fixtures T015–T018 in parallel;
  - the codec (T023/T024) and XP (T027/T028) in parallel with the scheduler chain T021→T022;
  - schema files T033/T034 in parallel after T032;
  - origin guard (T039/T040), rate limit (T044/T045) and edge proxy and headers (T046/T046a → T047) in parallel;
  - web tasks T053/T054, T056, T059, T060, T061/T062, and the tests T063a/T064a, in parallel.
- **US1**: all tests T066–T074 in parallel. Then T080 and T081 in parallel with T077/T078.
- **US2**: all tests T087–T099 in parallel. Then T100, T101 and T108 in parallel; API services
  T103–T107 are sequential through the shared contract task T102.
- **US3–US5**: fixtures and tests in parallel per story. The domain implementations of US3 and US5
  are independent of each other.
- **Across stories** (with more than one person): after Foundational, US1 and US2 in parallel;
  then US3 and US4 in parallel.

---

## Parallel Example: User Story 1

```bash
# All US1 tests together (they must all fail first):
Task: "T066 queue fixtures (review/ahead) in packages/fixtures/queue.json"
Task: "T067 domain queue test in packages/domain/tests/queue.test.ts"
Task: "T068 session machine test in apps/web/tests/session/session-machine.test.ts"
Task: "T069 push engine test in apps/web/tests/sync/push.test.ts"
Task: "T070 sync push API test in apps/api/tests/integration/sync-push.test.ts"
Task: "T071 CardContent sanitize test in apps/web/tests/components/card-content.test.tsx"
Task: "T072 e2e session in tests/e2e/session.spec.ts"
Task: "T073 e2e offline in tests/e2e/offline.spec.ts"
Task: "T074 e2e two devices in tests/e2e/two-devices.spec.ts"

# Then independent implementation files together:
Task: "T080 CardContent in apps/web/src/components/session/CardContent.tsx"
Task: "T081 GradeBar in apps/web/src/components/session/GradeBar.tsx"
```

## Parallel Example: User Story 2

```bash
Task: "T100 assignNodeIndex in packages/domain/src/path/assign.ts"
Task: "T101 import row rules in packages/domain/src/import/rows.ts"
Task: "T108 parse worker in apps/web/src/client/import/parse.worker.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1, with seeded content)

1. Phase 1 Setup, then Phase 2 Foundational.
2. Phase 3 (US1): review sessions with FSRS, offline, sync and undo, using `pnpm db:seed` decks.
3. **STOP and VALIDATE**: V1–V4 from quickstart.md. Deploy `staging` (T155 steps) and demo.

The smallest product a real learner can use with their own content is **US1 + US2** (both P1).
Ship them together as the first public release.

### Incremental Delivery

1. Foundation, then US1, then demo internally.
2. Add US2 (own decks, import, media, export). First public release.
3. Add US3 (learning path). Release.
4. Add US4 (XP, streak, sound, home). Release.
5. Add US5 (dashboard). Release.
6. Polish (account deletion, a11y and responsive sweeps, load test, security). Production.

Each step keeps every earlier story's tests green (`pnpm verify`).

---

## Notes

- [P] tasks touch different files and depend on no unfinished task.
- Every domain rule change starts with a fixture change in `packages/fixtures`. The future
  Flutter client must pass the same files (research R17).
- Constraint text in quotes comes verbatim from data-model.md or the contracts. Don't loosen it
  during implementation.
- Commit after each task or logical group. The repository is not a git repo yet: run `git init`
  before T001 if you want history.
- Stop at any checkpoint to validate a story on its own.
