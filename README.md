# Anki Duo

An installable web app (PWA) that schedules flashcard reviews with [FSRS](https://github.com/open-spaced-repetition/ts-fsrs)
and wraps them in a Duolingo-style experience: short sessions, a learning path, XP, streaks and a
progress dashboard. It works offline and syncs across devices.

Design documents live in [`specs/001-fsrs-gamified-learning/`](specs/001-fsrs-gamified-learning/):
[spec](specs/001-fsrs-gamified-learning/spec.md), [plan](specs/001-fsrs-gamified-learning/plan.md),
[research](specs/001-fsrs-gamified-learning/research.md), [data model](specs/001-fsrs-gamified-learning/data-model.md),
[contracts](specs/001-fsrs-gamified-learning/contracts/) and the
[quickstart](specs/001-fsrs-gamified-learning/quickstart.md). Project rules are in
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## Architecture

```text
Browser (PWA, IndexedDB, service worker)
   │  same origin
   ▼
Cloudflare Worker  ── static assets (apps/web build)
   │  /api/*  + x-origin-secret
   ▼
AWS Lambda (Hono API) ──▶ Neon Postgres   (system of record)
                      └─▶ Cloudflare R2   (media, presigned URLs)
```

| Path                      | What                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`         | Pure rules: FSRS scheduler wrapper, replay, queue, path, XP, streak, stats, import rules. No I/O, no clock, no randomness (lint-enforced) |
| `packages/contract`       | Zod schemas → OpenAPI. Must match `specs/.../contracts/openapi.yaml` (contract test)                                                      |
| `packages/fixtures`       | Language-neutral golden JSON that every client implementation (TypeScript now, Dart later) must pass                                      |
| `apps/api`                | Hono API (Lambda in production, Node locally), Drizzle schema + migrations, Better Auth                                                   |
| `apps/web`                | Vite + React PWA: Dexie local store, outbox sync, session machine, UI                                                                     |
| `apps/edge`               | Cloudflare Worker: serves the web build and proxies `/api/*` to the Lambda                                                                |
| `tests/e2e`, `tests/load` | Playwright end-to-end tests; k6 load test                                                                                                 |

The server is authoritative for scheduling: clients schedule optimistically for instant feedback,
the server replays each card's review history and its result wins. Review history is append-only.

## Local setup

Requirements: Node.js 24, pnpm 9, and either a local Postgres 16+ or a Neon branch. Docker is
optional (MinIO for media).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL and BETTER_AUTH_SECRET at least
docker compose up -d                     # optional: MinIO for media uploads
pnpm db:migrate
pnpm db:seed                             # demo@anki-duo.local / demo-password-123
pnpm dev                                 # API :8787, web http://localhost:5173
```

Without `RESEND_API_KEY`, verification and reset emails are printed to the API console. Seed
scenarios: `pnpm db:seed -- --scenario=due25` (25 cards due now) and `--scenario=heavy` (20,000
cards, 3 years of history).

## Quality gate

```bash
pnpm verify   # typecheck, lint, unit, integration, contract, i18n, e2e (mobile + desktop)
```

| Command          | Covers                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| `pnpm test:unit` | `packages/domain` against every fixture, fixture schemas, contract tests |
| `pnpm test:int`  | API handlers on PGlite, web store/sync/components, edge Worker           |
| `pnpm test:e2e`  | Playwright (set `E2E_BASE_URL` to run against a running stack)           |
| `pnpm test:load` | k6 scale check, run against a deployed stage                             |

## Deploy

Infrastructure is defined in [`sst.config.ts`](sst.config.ts). See the
[quickstart](specs/001-fsrs-gamified-learning/quickstart.md#deploy-cloudflare-edge--aws-lambda-free-tier)
for secrets and the post-deploy checks.

```bash
pnpm sst deploy --stage staging
DATABASE_URL=<neon url> pnpm db:migrate     # apply migrations to the stage's database
```

## How to add a domain rule

Every scheduling, queue, path, XP, streak or stats rule is specified by a fixture first.

1. Add or edit cases in `packages/fixtures/<rule>.json` (and its schema in `packages/fixtures/schema/`).
   Derive expected values by hand or from an independent source, never from the implementation.
2. Run `pnpm test:unit` and watch the new cases fail for the right reason.
3. Implement the rule in `packages/domain/src/` until they pass.
4. If the API shape changes, update `specs/.../contracts/openapi.yaml` and the Zod routes in
   `packages/contract`; the contract test keeps them in step. Run `pnpm gen:api` to refresh the
   web client types.

A bug fix starts the same way: a failing regression test first.
