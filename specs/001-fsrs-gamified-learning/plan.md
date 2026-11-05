# Implementation Plan: FSRS Gamified Learning App (MVP)

**Branch**: `001-fsrs-gamified-learning` | **Date**: 2026-11-05 (rev. c) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-fsrs-gamified-learning/spec.md`

**Revision b (2026-11-05)**: the project owner chose AWS free-tier hosting (Lambda) and a future
Flutter mobile app. The single Next.js app was replaced with a Vite PWA plus a Hono API on Lambda,
in a pnpm monorepo designed for a second, non-TypeScript client. See research R1, R16 and R17.

**Revision c (2026-11-05)**: the web moved from CloudFront + S3 to a Cloudflare Worker with Static
Assets, which also proxies `/api/*` to Lambda. S3 has no always-free tier, so this keeps hosting at
$0. See research R16.

## Summary

Anki Duo is an installable web app (PWA) that schedules flashcard reviews with FSRS and wraps them
in a Duolingo-style experience:

- chunky buttons, sounds and micro-animations;
- a learning path of 10-card nodes;
- XP, a daily XP goal and streaks;
- a heatmap and donut dashboard.

Learners have accounts, sync across devices, and can review fully offline (including media).

**Technical approach**:

- **`apps/web`**: a static Vite + React PWA. Reviews run against IndexedDB with optimistic
  updates and are recorded as append-only review events in an outbox.
- **`apps/api`**: a Hono API on AWS Lambda.
  - It stores events idempotently in Neon Postgres.
  - It rebuilds card state by replaying history when events arrive out of order or are undone.
  - It serves a cursor-based pull.
- **`packages/domain`**: pure TypeScript rules (scheduler wrapping `ts-fsrs`, queue, path, XP,
  streak, study day, stats), shared by web and API.
- **Hosting**:
  - a Cloudflare Worker serves the static site (Workers Static Assets) and proxies `/api/*` to the
    Lambda Function URL, so the browser sees one origin;
  - media lives in Cloudflare R2;
  - SST defines the AWS and Cloudflare resources in one file.
  - Everything sits within always-free tiers (research R16, revision c).
- **Ready for Flutter**: the OpenAPI document is the contract; `packages/fixtures` holds
  language-neutral golden tests every client implementation must pass; the server is
  authoritative for scheduling; bearer-token auth is available.

See [research.md](./research.md) for the reasoning behind each choice.

## Technical Context

**Language/Version**: TypeScript 5.x (`strict`) everywhere. Node.js 24 LTS for local dev and
tooling; Lambda uses its newest supported Node.js LTS runtime (arm64). React 19.

**Primary Dependencies**:

| Area | Dependencies |
|---|---|
| Shared | `ts-fsrs` (pinned exact), Zod |
| API | Hono, `@hono/zod-openapi`, Drizzle ORM + `@neondatabase/serverless`, Better Auth (with `bearer` plugin), AWS SDK v3 S3 client + presigner (for R2), Resend |
| Web | Vite, React Router, Dexie (+ `dexie-react-hooks`), `vite-plugin-pwa` (Workbox), i18next + react-i18next + `i18next-icu`, Tailwind CSS v4, Motion, react-markdown + remark-gfm + rehype-sanitize, Papa Parse, `openapi-fetch` |
| Infrastructure | SST v3 |

**Storage**:

- PostgreSQL (Neon, `aws-ap-southeast-1`) as the system of record;
- Cloudflare R2 for media;
- on the web client, IndexedDB (via the `LocalStore` interface) and Cache Storage for the shell
  and media.

**Testing**:

- Vitest for unit tests (domain, driven by `packages/fixtures`), integration tests (API on PGlite;
  Dexie on fake-indexeddb) and contract tests (generated OpenAPI vs `contracts/openapi.yaml`);
- Playwright for end-to-end tests, with @axe-core/playwright;
- k6 for the scale check.

**Target Platform**:

- **Web**: evergreen browsers. Chrome/Edge/Firefox desktop and Android Chrome at the last 2
  versions, and iOS/macOS Safari 17+. Installable PWA.
- **Edge**: Cloudflare Worker with Static Assets (`*.workers.dev`, custom domain optional).
- **API**: AWS Lambda in `ap-southeast-1`, reachable only through the Worker (origin-secret
  header).
- **Later**: a Flutter app (iOS/Android) against the same API. Not part of this MVP.

**Project Type**: Web application, as a monorepo with a static frontend, a serverless API and
shared packages.

**Performance Goals**:

- next card ≤ 100 ms after a grade at p95 on a mid-range phone, including offline (SC-001). This
  never depends on the network or Lambda cold starts;
- 10,000-row import in < 15 s (SC-006);
- cross-device propagation ≤ 60 s at p95 (SC-008);
- home, path and dashboard ≤ 2 s with 20k cards and 3 years of history (SC-010);
- Lambda cold start target < 1 s, achieved with a small esbuild bundle;
- animations at 60 fps.

**Constraints**:

- **Offline**: review works offline, including media for today's cards. Content edits are
  online-only.
- **Determinism**: the scheduler and every gamification function are pure, with the clock
  injected. The server's replay is authoritative.
- **Accessibility**: WCAG 2.2 AA; usable from 320 px to desktop with no horizontal scroll.
- **Limits**:
  - Lambda request payload ≤ 6 MB, hence chunked import (1,000 rows) and direct-to-R2 upload;
  - media files ≤ 5 MB each, ≤ 500 MB per learner;
  - service-worker media cache ≤ 200 MB;
  - ≤ 20,000 cards per learner.
- **Free-tier budget** (R16):
  - Cloudflare static assets unlimited; Worker 100k `/api` requests/day at 10 ms CPU each;
  - Lambda 1M requests/month;
  - Neon about 0.5 GB, the binding limit (R3);
  - R2 10 GB;
  - Resend about 3k emails/month.

**Scale/Scope**: ≤ 1,000 registered learners, ≤ 100 concurrent users, ≤ 20,000 cards and about
200k review logs per learner. About 12 screens (auth ×4, home, deck list, path, session, card
editor, import, dashboard, settings). Two UI locales (vi, en).

All Technical Context items are resolved. No NEEDS CLARIFICATION remain (see research R1–R18).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution v1.0.0 (`.specify/memory/constitution.md`).

### Principle I — Learning-Science Fidelity

| Rule | How the plan satisfies it | Status |
|---|---|---|
| Published SRS algorithm; deviations documented | FSRS through `ts-fsrs`, the reference TS implementation, with default parameters. No deviation. Fuzz is disabled or seeded so results are deterministic (R2) | ✅ |
| Scheduler isolated and deterministic; no clock, randomness or UI reads | `packages/domain/src/scheduler` takes `now`, the card and the parameters as arguments. A lint rule bans `Date.now`, `new Date()` without arguments and `Math.random` in `packages/domain/**` | ✅ |
| Gamification can't change scheduling or reward harmful behaviour | XP, streak and path are separate domain modules that only read review outcomes. XP never depends on the grade (2 per due/new review), Again gets neutral feedback, study ahead earns 0, and there are no hearts or lives. Locks never touch scheduling (FR-007, FR-023, FR-024) | ✅ |
| Due before new; configurable new-card limit | The queue builder puts due cards first and introduces new cards only when every card due today in the deck is in the session, in review and node sessions alike (FR-006, FR-023a). Per-deck `new_cards_per_day` defaults to 20 | ✅ |
| Lossless review history; state recomputable | ReviewLog is append-only with client UUIDs and idempotent insert. Undo is revocation, not deletion. Card FSRS columns are a cache rebuilt by server replay. Export includes the full history (R6, R7, R13) | ✅ |
| Multiple client implementations (future Flutter) | Server replay with `ts-fsrs` is authoritative. Every client must pass `packages/fixtures`. `scheduler_version` is recorded on each log (R17) | ✅ |

### Principle II — Test-First

| Rule | How the plan satisfies it | Status |
|---|---|---|
| Failing test before each behaviour change | `/speckit-tasks` puts a test task before every implementation task. Domain rule changes start by editing a fixture in `packages/fixtures` | ✅ (process) |
| Scheduler tests for every grade path, first review, lapses, bounds, fuzz/rounding; reference vectors | `packages/fixtures/fsrs-vectors.json` (imported from the FSRS reference) plus targeted cases, run by `packages/domain` tests (V1) | ✅ |
| Regression test for each bug | Required by the workflow. Tracked in the PR template | ✅ (process) |
| Migration tests prove history survives | `apps/api/tests/integration/migrations.test.ts` applies every Drizzle migration to PGlite seeded with review logs, replays every card, and asserts equality | ✅ |
| Deterministic tests | Injected clock, fake timers, PGlite in-process, fake-indexeddb, and no external network in tests | ✅ |

### Platform Constraints

| Rule | Plan | Status |
|---|---|---|
| Installable PWA, mobile-first | `vite-plugin-pwa` manifest and service worker. Mobile-first layout, verified at 320 px | ✅ |
| Reviews usable on intermittent connectivity; no lost or corrupted history | `LocalStore` outbox, idempotent push, server replay on conflict (V3, V4) | ✅ |
| Export in an open, documented format | `anki-duo-export` v1 ([contracts/export-format.md](./contracts/export-format.md)) | ✅ |
| Keyboard and touch; WCAG 2.2 AA contrast | Keyboard shortcuts (FR-018), axe in e2e, contrast-checked tokens | ✅ |
| Stack recorded; new runtime dependencies justified | This plan, plus the Complexity Tracking table below | ✅ |

### Development Workflow & Quality Gates

`pnpm verify` (typecheck, lint, unit, fixtures, integration, contract, full e2e on the `mobile`
and `desktop` projects) must pass before merge. k6 load tests (`tests/load/`) are a release check,
not part of the test suite. Self-review against Principles I and II.

**Gate result (pre-research)**: PASS. No violations.

**Gate result (post-design, rev. b and c)**: PASS. Re-checked against
[data-model.md](./data-model.md) and [contracts/](./contracts/) after the architecture change:

- the server recomputes `stateAfter` and the client value is advisory only, which also covers a
  future Dart scheduler;
- XP is derived, never stored as a mutable counter;
- `all_available_done` affects only the streak, never scheduling;
- splitting into apps and packages adds no principle violation. Every new dependency is listed
  below.

**Note for the future Flutter feature**: when it starts, the constitution's "PWA" platform
constraint will need a MINOR amendment that adds the native app as a supported platform. Not
needed for this MVP.

## Project Structure

### Documentation (this feature)

```text
specs/001-fsrs-gamified-learning/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R18
├── data-model.md        # Phase 1: entities, rules, LocalStore contract
├── quickstart.md        # Phase 1: run, deploy & validation guide (V1–V14)
├── contracts/
│   ├── openapi.yaml     # REST API /api/v1: source of truth for TS and (later) Dart clients
│   ├── csv-import.md    # CSV/TSV import contract
│   └── export-format.md # anki-duo-export v1
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks; not created by /speckit-plan)
```

### Source Code (repository root)

```text
package.json                 # pnpm workspaces; scripts: dev, verify, test:*, deploy
pnpm-workspace.yaml
sst.config.ts                # Cloudflare Worker + assets (edge/web), Lambda Function URL (api), secrets
docker-compose.yml           # local MinIO (optional) for media

packages/
├── domain/                  # PURE: no I/O, no clock, no randomness (lint-enforced)
│   ├── src/scheduler/       # ts-fsrs wrapper, replay(), version stamp, compact state codec
│   ├── src/queue/           # session queue builder (review/node/ahead)
│   ├── src/path/            # node assignment + status
│   ├── src/gamification/    # xp, daily goal, streak
│   ├── src/stats/           # donut classifier, heatmap buckets
│   ├── src/time/            # study-day math (tz + day-start hour)
│   ├── src/import/          # row validation, normalisation, dedupe key
│   ├── src/export/          # export schema + verify
│   └── tests/               # runs every case in packages/fixtures
├── contract/                # Zod request/response schemas → generated OpenAPI + TS types
│   └── tests/               # generated OpenAPI ≡ specs/.../contracts/openapi.yaml
└── fixtures/                # language-neutral golden JSON (TS now, Dart later)
    ├── fsrs-vectors.json
    ├── queue.json  path.json  xp-streak.json  study-day.json  donut.json
    └── import/              # csv/tsv sample files (also used by e2e)

apps/
├── edge/                    # Cloudflare Worker: serves apps/web/dist as static assets,
│   ├── src/index.ts         #   proxies /api/* to Lambda with x-origin-secret
│   ├── public/_headers      # cache rules (hashed assets long, index.html/sw.js no-cache)
│   └── tests/               # proxy behaviour (headers, cookies, streaming, secret stripping)
├── api/                     # Hono
│   ├── src/app.ts           # route tree per contracts/openapi.yaml + /api/auth/* (Better Auth)
│   ├── src/lambda.ts        # hono/aws-lambda handler (production)
│   ├── src/node.ts          # @hono/node-server (local dev, :8787)
│   ├── src/db/              # Drizzle schema, client, change_seq triggers
│   ├── src/auth.ts          # Better Auth config (cookie + bearer, Google, Resend)
│   ├── src/storage.ts       # R2 presign/verify
│   ├── src/sync/            # push (idempotent insert + replay), pull (cursor)
│   ├── src/services/        # decks, cards, import, export/restore, account, activity
│   ├── src/rate-limit.ts
│   ├── src/origin-guard.ts  # rejects requests without the Worker's x-origin-secret (403)
│   ├── src/log.ts           # structured JSON → CloudWatch
│   ├── drizzle/             # generated SQL migrations (committed)
│   └── tests/integration/   # PGlite-backed handler and service tests
└── web/                     # Vite + React PWA (static build → served by apps/edge)
    ├── src/routes/          # sign-in, sign-up, verify, reset, home, decks, path, cards,
    │                        #   import, session, dashboard, settings
    ├── src/client/
    │   ├── local-store.ts   # LocalStore interface (platform-neutral contract)
    │   ├── dexie-store.ts   # web implementation
    │   ├── api.ts           # openapi-fetch client
    │   ├── sync/            # outbox, push/pull loop, connectivity
    │   ├── session/         # session state machine, optimistic grading, undo, resume
    │   ├── media-cache.ts   # SW messaging: prefetch/evict today's media
    │   └── sound.ts         # Web Audio sprites
    ├── src/components/      # ui/ (ChunkyButton, ProgressBar…), path/, session/, charts/
    ├── src/i18n/messages/{vi,en}.json   # ICU JSON (convertible to Flutter ARB)
    ├── src/styles/tokens.css
    ├── src/sw.ts            # Workbox service worker (injectManifest)
    ├── public/icons/  public/sounds/
    └── tests/               # component + Dexie integration tests

tests/
├── e2e/                     # Playwright against web + api: session, offline, two-devices,
│                            #   editor, import, path, dashboard, responsive, a11y, i18n
└── load/                    # k6 script for SC-010 and free-tier storage check
```

**Structure Decision**: a pnpm monorepo with two deployables (`apps/edge`, a Cloudflare Worker
that ships the `apps/web` build as static assets, and `apps/api` on Lambda) and three shared
packages.

- **`packages/domain`** is the boundary Principle I requires. It is the only place scheduling, XP,
  streak and path rules live in TypeScript.
- **`packages/fixtures`** is what makes those rules portable to Flutter.
- **`packages/contract`** keeps the API and its OpenAPI document from drifting apart.
- Only `apps/api` touches Postgres and R2. Only `apps/web/src/client` touches IndexedDB, the
  service worker and audio.

## Complexity Tracking

The constitution requires every new runtime dependency to be justified here. There are no
principle violations.

| Dependency / structure | Why needed | Simpler alternative rejected because |
|---|---|---|
| Monorepo (3 apps + 3 packages) | Edge/static, web source and Lambda API build and deploy separately, and domain/contract/fixtures are shared and made portable for Flutter | A single app can't be hosted free on Lambda + static hosting without an adapter, and can't serve a Flutter client cleanly (R1, R17) |
| Edge proxy Worker (`apps/edge`) | One origin for static files and API at $0: first-party cookie, no CORS | CloudFront + S3 isn't fully free. A cross-origin API needs third-party cookies or CORS everywhere (R16) |
| react, react-dom, vite, react-router | SPA build and routing for the static PWA | Next.js needs a server runtime or an adapter (R1) |
| hono, @hono/zod-openapi | Fetch-native API that runs on Lambda, Node or Workers; OpenAPI generated from Zod | Express/Fastify aren't portable to Workers, and hand-written OpenAPI drifts (R1, R17) |
| zod | One schema for API validation, OpenAPI generation, export format and forms | Manual validation is duplicated and drifts |
| ts-fsrs | Reference FSRS implementation (Principle I) | Hand-written FSRS risks bugs and drift (R2) |
| drizzle-orm, @neondatabase/serverless | Typed SQL; HTTP driver needs no pool on Lambda | Raw `pg` needs pooling on Lambda and has no types. Prisma is heavier for cold starts (R3) |
| better-auth (+ bearer plugin) | Email/password with verification and reset, Google, sessions, rate limits; cookie for web and bearer for Flutter | Auth.js leaves verification and reset to custom code. Cognito is heavy and splits user data (R4) |
| @aws-sdk/client-s3, @aws-sdk/s3-request-presigner | Presigned upload and download URLs for R2 | R2 is S3-compatible, so no lighter official client exists (R5) |
| resend | Verification and reset emails | SMTP/SES setup and deliverability are extra ops work (R4) |
| dexie, dexie-react-hooks | Indexed, transactional IndexedDB behind `LocalStore`; live queries for the UI | Raw IndexedDB is verbose and error-prone (R6) |
| vite-plugin-pwa (Workbox) | Precache, offline shell, media runtime cache | A hand-written SW makes cache versioning error-prone (R8) |
| i18next, react-i18next, i18next-icu | vi/en with ICU plurals; catalogs convertible to Flutter ARB | Hand-rolled dictionaries lack plurals (R10) |
| tailwindcss | Design tokens and responsive utilities for the visual language | CSS modules make tokens and responsive variants slower to build (R9) |
| motion | Springs, layout and orchestrated celebration animations | CSS-only can't do interruptible springs well (R9) |
| react-markdown, remark-gfm, rehype-sanitize | Safe Markdown with tables, no HTML execution (FR-034) | String HTML renderers need `dangerouslySetInnerHTML` (R11) |
| papaparse | RFC 4180 CSV/TSV parsing in a Web Worker | Hand-written CSV parsing mishandles quoting and newlines (R12) |
| openapi-fetch (+ openapi-typescript, dev) | Typed web API client generated from the same contract Flutter will use | A hand-written client drifts from the contract (R17) |
| uuid (v7) | Time-ordered client ids for idempotent, sortable events | `crypto.randomUUID()` is v4 only (R6) |
| sst (dev/infra) | Cloudflare Worker + Lambda + secrets as code in one file, with per-developer stages | Wrangler + CDK/SAM mean two IaC tools and two secret stores (R16) |
