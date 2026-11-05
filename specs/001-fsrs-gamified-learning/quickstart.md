# Quickstart & Validation Guide: FSRS Gamified Learning App (MVP)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This guide explains how to run the app locally and how to prove each user story and success
criterion works. It refers to [data-model.md](./data-model.md) and [contracts/](./contracts/)
rather than repeating them.

## Prerequisites

- Node.js 24 LTS and pnpm 9+
- A Postgres database: a Neon dev branch, or a local Postgres 16+. Integration tests use PGlite
  and need no database.
- Media storage: MinIO via `docker compose up -d minio` for fully local work, or a dev R2 bucket
- A Resend API key. Without it, verification and reset emails are printed to the API console.
- Google OAuth client id and secret (optional locally)
- Playwright browsers: `pnpm exec playwright install --with-deps chromium`
- For deployment only:
  - an AWS account with credentials configured (`aws configure` or SSO);
  - a Cloudflare account (free plan) with an API token allowed to edit Workers and R2, exported as
    `CLOUDFLARE_API_TOKEN` along with `CLOUDFLARE_DEFAULT_ACCOUNT_ID`.

## Local setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env  # DATABASE_URL, BETTER_AUTH_SECRET, R2_* or MINIO_*, RESEND_API_KEY, GOOGLE_*
pnpm db:migrate                         # apply apps/api/drizzle migrations
pnpm db:seed                            # demo learner + 3 decks (vi vocabulary, en idioms, media sample)
pnpm dev                                # API on :8787, web on http://localhost:5173 (proxies /api)
```

Seed login: `demo@anki-duo.local` / `demo-password-123`. The seed includes 90 days of review
history so the dashboard and streak have data.

## Deploy (Cloudflare edge + AWS Lambda, free tier)

Infrastructure is in `sst.config.ts` (research R16):
- a Cloudflare Worker (`apps/edge`) serves the web build as static assets and proxies `/api/*`;
- the Hono API runs as a Lambda Function URL in `ap-southeast-1` and accepts only requests that
  carry the Worker's origin secret.

```bash
# one-time per stage: store secrets via SST
pnpm sst secret set DatabaseUrl "postgres://…neon.tech/…" --stage staging
pnpm sst secret set BetterAuthSecret "$(openssl rand -base64 32)" --stage staging
pnpm sst secret set OriginSecret "$(openssl rand -hex 32)" --stage staging
pnpm sst secret set R2AccessKeyId … --stage staging   # also R2SecretAccessKey, R2Bucket, R2Endpoint
pnpm sst secret set ResendApiKey … --stage staging
pnpm sst secret set GoogleClientId … --stage staging   # also GoogleClientSecret

pnpm --filter api db:migrate:remote --stage staging    # migrations against the stage's Neon branch
pnpm sst deploy --stage staging                         # prints the app URL (https://…workers.dev) and the Lambda URL
```

**Expected after deploy**:

- opening the app URL shows the sign-in screen, and reloading a deep link (e.g. `/dashboard`)
  still loads the app (SPA fallback);
- `GET <app-url>/api/v1/sync/pull` without a session returns 401 `application/problem+json`;
- calling the Lambda URL directly (without the origin secret) returns 403;
- the browser's DevTools show no CORS preflight, because everything is same-origin;
- the response headers of a hashed asset show long-lived caching, while `index.html` and `sw.js`
  show `no-cache`.

Production uses `--stage prod`. Remove a stage with `pnpm sst remove --stage <name>`.

**Free-tier watch**:
- AWS Budgets has an alert at $1/month (created by `sst.config.ts`).
- The Cloudflare dashboard shows Worker requests per day against the 100k free limit (only
  `/api/*` counts).
- The Neon storage dashboard shows the database size against the free limit (research R3).

## Quality gate (constitution: Development Workflow & Quality Gates)

```bash
pnpm verify      # typecheck + lint + unit + fixtures + integration + contract + full e2e (mobile + desktop)
```

Individual suites:

| Command | Covers |
|---|---|
| `pnpm test:unit` | `packages/domain` against every case in `packages/fixtures`: scheduler and FSRS vectors, queue builder, XP, streak, path, donut, study-day math, CSV row rules |
| `pnpm test:int` | `apps/api` handlers on PGlite: sync push/pull idempotency, replay on conflict and revoke, import chunks, export/restore round trip, migrations preserving review history. Also `apps/web` Dexie store on fake-indexeddb |
| `pnpm test:contract` | The OpenAPI generated from `packages/contract` equals `specs/001-fsrs-gamified-learning/contracts/openapi.yaml` |
| `pnpm test:e2e` | Playwright against web + API: mobile (320 px) and desktop (1440 px) projects, offline, two-device and axe accessibility checks |
| `pnpm test:i18n` | Every message key exists in both `vi` and `en` (SC-009) |

## Validation scenarios

Each scenario lists its spec trace and the automated test that proves it. Manual steps are for
demoing.

### V1. Scheduling matches FSRS (Story 1, FR-001–FR-003, SC-004)

- **Automated**: `pnpm test:unit -- scheduler`. Every case in
  `packages/fixtures/fsrs-vectors.json` must give identical `due`, `stability`, `difficulty` and
  `state`.
- **Expected**: 100% pass. Any mismatch fails the suite.

### V2. Short review session with instant transitions (Story 1, FR-015–FR-016, SC-001, SC-003)

1. Sign in as the demo learner on a mobile viewport and open deck "Từ vựng N3" → **Review**.
2. Reveal a card. Each of the four buttons shows its interval (e.g. "Good · 3d").
3. Grade with taps (mobile) or keys `Space`, `1`–`4` (desktop).

- **Expected**: the next card appears immediately, and the progress bar animates forward.
- **Automated**: `tests/e2e/session.spec.ts` measures grade → next-card paint with the Performance API.
  95% of grades must be ≤ 100 ms with CPU throttling ×4.
- **Undo**: press `Z` or tap Undo. The previous card returns, and the XP total drops back
  (Story 1 #4).

### V3. Offline review with media, then sync (FR-017, FR-019, SC-005, clarification Q2)

1. Load the app online and open the home screen; the media for today's cards gets prefetched.
2. In DevTools, set the network to **Offline**. Start a session in the "Media sample" deck.

- **Expected**:
  - images render and audio replays;
  - "Add card", "Import" and "Delete" are disabled with a "needs connection" message.
3. Grade 5 cards, close the tab, reopen it (still offline), and resume. The 5 grades are still
   there.
4. Go online. Within 30 s the outbox empties (the sync indicator shows "Saved").

- **Automated**: `tests/e2e/offline.spec.ts` runs 500 grades with random offline toggles and tab
  reloads, then checks that the server holds exactly 500 non-revoked review logs (SC-005).

### V4. Two-device sync and conflict replay (FR-030a, SC-008)

- **Automated**: `tests/e2e/two-devices.spec.ts` uses two browser contexts signed in as the same
  learner:
  - a grade on device A appears on device B within 60 s;
  - grading the same card offline on both devices and then reconnecting gives both logs in
    history, and the card state equals a replay in `(reviewed_at, id)` order.
- **Integration**: `apps/api/tests/integration/sync-replay.test.ts` covers out-of-order pushes,
  duplicate pushes (idempotency) and revoke followed by replay.

### V5. Decks, cards, Markdown, media (Story 2 #1–3, FR-009–FR-012, FR-034)

1. Create deck "Test". Add a card whose front contains a `**bold**` word, a table, and
   `<script>alert(1)</script>`.

- **Expected**:
  - the preview and review render bold text and the table;
  - the script shows as text and never runs.
2. Attach a PNG to the front and an MP3 to the back.
3. Try a 6 MB image.

- **Expected**: rejected with the size limit shown (`media_too_large`).
- **Automated**: `tests/e2e/editor.spec.ts` and `apps/web/tests/markdown-sanitize.test.ts`.

### V6. CSV/TSV import (Story 2 #4–6, FR-013, SC-002, SC-006)

- Use `packages/fixtures/import/` (`basic-200.tsv`, `semicolon-header.csv`, `malformed.csv`,
  `dupes.csv`, `10000-rows.csv`, `latin1.csv`).
- **Expected**, per [contracts/csv-import.md](./contracts/csv-import.md):
  - delimiter and header are auto-detected;
  - malformed rows are reported by line number;
  - duplicate modes behave as documented;
  - `latin1.csv` is rejected before any card is created;
  - `10000-rows.csv` finishes in under 15 s.
- **Timed demo (SC-002)**: from sign-up to the first graded card using `basic-200.tsv` takes
  under 3 minutes.

### V7. Learning path (Story 3, FR-023, FR-023a)

- Import 25 new cards into an empty deck.
- **Expected**:
  - three nodes (10/10/5); node 1 is available and nodes 2–3 are locked;
  - tapping node 2 shows a "finish node 1 first" message.
- Make 25 cards due (`pnpm db:seed --scenario=due25`), then start node 1.
- **Expected**: the session is the 10 most-overdue due cards and no new cards; node 1 shows
  "Review the remaining due cards to unlock new cards"; the Review entry still shows 15.
- Finish the Review entry until no cards are due, then start node 1 again.
- **Expected**: the session is the node's 10 new cards.
- **Automated**: `packages/domain` tests driven by `packages/fixtures/path.json` and `queue.json`.

### V8. XP, daily goal and streak (Story 4, FR-024–FR-026, clarification Q5)

- **Automated**: `packages/domain` tests driven by `packages/fixtures/xp-streak.json` and `study-day.json`, with an injected clock and time zone
  `Asia/Ho_Chi_Minh`. It checks:
  - XP: 2 per due/new review whatever the grade, study ahead 0, session bonus 5;
  - goal met at 20 XP;
  - goal met by `allAvailableDone` with a 3-card deck;
  - streak *at risk* on the next day, reset after a full missed day;
  - `longest_streak` kept;
  - the day boundary at 04:00 local.
- **Manual**: with sound on, finishing the goal plays the celebration and shows the flame
  incrementing. With OS "reduce motion" on, the animations become fades.

### V9. Dashboard (Story 5, FR-027–FR-029, clarification Q4)

- Open **Dashboard** as the seeded learner.
- **Expected**:
  - the 12-month heatmap shows daily review counts on tap or hover;
  - the donut shows New/Learning/Due/Not due/Suspended, and its segments sum to the card count;
  - the centre shows today's workload;
  - the deck filter updates every figure.
- **Automated**: `packages/fixtures/donut.json` cases, plus a property-based test of the invariant.

### V10. Responsive, installable, accessible, bilingual (FR-031–FR-033, SC-007, SC-009)

- **Automated**: `tests/e2e/responsive.spec.ts` at 320/768/1440 px asserts no horizontal scroll on home,
  path, session, editor, import and dashboard. `tests/e2e/a11y.spec.ts` runs axe and must find no
  serious or critical violations.
- **Manual**:
  - Chrome → Install app. It launches standalone with the icon.
  - Switch the language in Settings during a session. The UI switches and the session continues.

### V11. Export and restore round trip (FR-014)

- **Automated**: `apps/api/tests/integration/export-restore.test.ts` exports a seeded deck, restores it as
  a new deck, and checks that every card's FSRS state is equal. A tampered history must fail with
  `export_invalid`.

### V12. Scale (SC-010)

- `pnpm db:seed --scenario=heavy` creates a learner with 20,000 cards and 3 years of history.
- **Expected**: home, path and dashboard each load within 2 s.
- **Automated**: `pnpm test:load --stage staging` runs a k6 script with 100 virtual users doing
  a pull/push mix against the staging app URL (through the Worker). It checks:
  - p95 under 2 s for those pages, including Lambda cold starts;
  - the cold start itself, which must be under 1 s;
  - the Neon storage used per 100k review logs, which is reported so free-tier headroom can be
    projected (research R3).

### V13. Account lifecycle (FR-030)

- **Expected**:
  - sign-up sends a verification email, and an unverified user cannot reach the app;
  - password reset works;
  - Google sign-in works;
  - Settings → Delete account (after re-auth) removes all rows and media objects.
- **Automated**: `apps/api/tests/integration/account-delete.test.ts`.

### V14. Ready for a second (Flutter) client (research R17)

- **Contract**: `pnpm test:contract` passes. The committed
  [contracts/openapi.yaml](./contracts/openapi.yaml) generates a valid Dart client:
  `npx @openapitools/openapi-generator-cli generate -g dart-dio`, as a smoke check only; the
  output is not committed.
- **Bearer auth**: `apps/api/tests/integration/bearer-auth.test.ts`:
  - sign in with `Authorization: Bearer` (no cookie), then pull and push successfully;
  - a revoked token gets 401.
- **Server authority**: `apps/api/tests/integration/sync-replay.test.ts` includes a case where a
  pushed `stateAfter` deliberately differs from the true result. The server stores the replayed
  state, and the next pull returns the corrected card.
- **Fixtures are self-describing**: every file in `packages/fixtures` validates against its JSON
  Schema (`packages/fixtures/schema/*.json`), so a Dart test runner can consume them without
  reading TypeScript.

