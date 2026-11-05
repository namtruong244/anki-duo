# Data Model: FSRS Gamified Learning App (MVP)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Server storage is PostgreSQL (Drizzle schema in `apps/api/src/db/schema.ts`). The web client keeps a
subset in IndexedDB (Dexie, `apps/web/src/client/db.ts`), described in the "Client store" section.
A future Flutter client stores the same subset in SQLite (research R17).

## Conventions

- **Ids**: UUIDv7. Ids of client-created records (review events, sessions) are generated on the
  device so pushes are idempotent.
- **Times**: UTC instants are stored as `timestamptz`. A **study day** is a calendar `date` in the
  learner's time zone, where the day starts at `day_start_hour` (R14).
- **`change_seq`**: a `bigint` taken from one global sequence and set by a trigger on every insert
  or update of a synced table. Pull uses it as the cursor (R6).
- **Soft delete**: synced rows have `deleted_at`. On deletion, content columns are cleared
  immediately; the tombstone row stays so other devices learn about the deletion.
- **Ownership**: every row carries `user_id`. Every query is scoped by the session's user id.

---

## Entities

### User, Session, Account, Verification *(managed by Better Auth)*

These are the standard Better Auth tables. `user` has `id`, `email` (unique), `emailVerified`,
`name`, `image` and `createdAt`. Deleting a user cascades to every table below (FR-030).

### LearnerSettings *(spec: Learner)*

| Field | Type | Rules / default |
|---|---|---|
| user_id | uuid PK → user | |
| locale | enum `vi` \| `en` | From `Accept-Language` at sign-up (`vi` → `vi`, otherwise `en`) |
| time_zone | text (IANA) | Auto-detected; must be a valid IANA zone |
| day_start_hour | smallint | 0–23, default 4 |
| desired_retention | numeric(3,2) | 0.70–0.97, default 0.90 (FR-004) |
| maximum_interval_days | integer | 1–36500, default 36500 (FR-004) |
| daily_xp_goal | smallint | One of 10, 20, 30, 50; default 20 (FR-025) |
| session_size | smallint | 5–50, default 20 (FR-015) |
| sound_enabled | boolean | default true (FR-021) |
| motion | enum `system` \| `reduced` \| `full` | default `system` (FR-022) |
| updated_at, change_seq | | |

Changing `desired_retention` or `maximum_interval_days` affects only future reviews; stored card
states are not rewritten (FR-004).

### LearnerStats *(derived cache; spec: Learner)*

| Field | Type | Rules |
|---|---|---|
| user_id | uuid PK | |
| total_xp | integer | Sum of non-revoked `review_log.xp` plus session bonuses |
| current_streak | integer | Derived from DailyActivity (see Streak rules) |
| longest_streak | integer | Never decreases |
| last_goal_day | date null | |
| card_count | integer | Non-deleted cards. Must stay ≤ 20,000 (Assumptions) |
| media_bytes | bigint | Must stay ≤ 500 MB (Assumptions) |
| change_seq | | |

Recomputed in the same transaction whenever review logs, sessions or cards change.

### Deck

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| user_id | uuid → user | |
| name | text | 1–100 chars after trimming; unique per user, case-insensitive, among non-deleted decks |
| new_cards_per_day | smallint | 0–999, default 20 (FR-006) |
| next_position | integer | Next card ordinal; only increases |
| created_at, updated_at, deleted_at, change_seq | | |

Deleting a deck hard-deletes its cards, media objects and review logs, then leaves the tombstone
row (FR-009, deletion edge case).

### Card

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| user_id, deck_id | uuid | |
| position | integer | Ordinal in the deck, assigned from `deck.next_position`; immutable |
| node_index | integer | Learning-path node, assigned at creation (see Path rules); immutable |
| front, back | text | Markdown, 1–10,000 chars for front, 0–10,000 for back |
| front_norm | text | Lower-cased, trimmed, whitespace-collapsed, NFC front. Used for duplicate detection (FR-013) |
| tags | text[] | ≤ 20 tags, each 1–50 chars, no whitespace |
| state | enum `new` \| `learning` \| `review` \| `relearning` | FSRS state (FR-001) |
| due | timestamptz | When the card is next due. For `new` cards: creation time |
| stability | double | ≥ 0. Days for retrievability to fall to 90% |
| difficulty | double | 1–10 |
| learning_steps | smallint | Current step in (re)learning |
| reps | integer | ≥ 0 |
| lapses | integer | ≥ 0 |
| last_review | timestamptz null | |
| suspended | boolean | default false (FR-012) |
| created_at, updated_at, deleted_at, change_seq | | |

**Retrievability** is not stored. It is computed when needed from `stability` and the time since
`last_review` with the FSRS forgetting curve (FR-001).

The FSRS columns are a cache. The source of truth is the card's non-revoked review logs, and
replaying them through the scheduler MUST reproduce these columns exactly (R6, Principle I).

Indexes:
- `(user_id, deck_id, state, due)` for queue building;
- `(deck_id, node_index)` for the path;
- `(deck_id, front_norm)` for duplicate detection;
- `(user_id, change_seq)` for pull.

### MediaAsset

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| user_id, card_id | uuid | |
| side | enum `front` \| `back` | |
| kind | enum `image` \| `audio` | |
| mime | text | image: png, jpeg, webp, gif, svg+xml; audio: mpeg, mp4/aac, ogg, wav (FR-011) |
| bytes | integer | 1 – 5,242,880 (FR-011) |
| storage_key | text | Object key in R2: `u/{user_id}/{id}` |
| status | enum `pending` \| `ready` | `pending` until the upload is confirmed. Pending rows older than 24 h are deleted |
| sort | smallint | Display order on that side |
| created_at, deleted_at, change_seq | | |

Markdown refers to an asset with the token `![alt](media:{id})` for images or `[[audio:{id}]]` for
audio.

### ReviewLog *(spec: Review Log; append-only)*

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | Client-generated; inserted with `ON CONFLICT DO NOTHING` |
| user_id, card_id, deck_id | uuid | |
| session_id | uuid null | |
| kind | enum `review` \| `reset` | `reset` = learner reset the card to New (FR-012) |
| grade | smallint null | 1 Again, 2 Hard, 3 Good, 4 Easy. Required when `kind = review` |
| reviewed_at | timestamptz | Device time of the grade. Rejected if more than 5 min in the future relative to the server |
| duration_ms | integer | 0 – 3,600,000 (clamped) |
| was_new | boolean | Card state was `new` before the review |
| was_due | boolean | `due ≤ reviewed_at` before the review, or the card was `learning`/`relearning` |
| study_ahead | boolean | Reviewed before due, outside learning steps. Earns 0 XP |
| xp | smallint | Derived: see XP rules |
| state_before, state_after | double precision[8] | Compact snapshot of the FSRS columns, for audit and export: `[stateCode, dueEpochSec, stability, difficulty, learningSteps, reps, lapses, lastReviewEpochSec]`. The API and export expand it to the `FsrsState` object (research R3) |
| scheduler_version | text | e.g. `ts-fsrs@<exact>/fsrs-6`. Pinned (R2) |
| device_id | uuid | |
| revoked_at | timestamptz null | Set by undo (FR-008, R7) |
| received_at, change_seq | | |

Replay order is `(reviewed_at, id)`. Revoked logs are skipped during replay and count 0 XP. Rows
are never updated, except to set `revoked_at` once.

### StudySession

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | Client-generated |
| user_id, deck_id | uuid | |
| kind | enum `node` \| `review` \| `ahead` | |
| node_index | integer null | Required when `kind = node` |
| started_at, ended_at | timestamptz | `ended_at` is null while in progress |
| planned_count | smallint | Number of cards queued at start |
| cards_reviewed, correct_count | smallint | Correct = grade ≥ 2 |
| completed | boolean | All queued cards graded |
| bonus_xp | smallint | 5 when completed, else 0 (FR-024) |
| study_day | date | |

### DailyActivity

| Field | Type | Rules |
|---|---|---|
| user_id, study_day | PK | |
| reviews | integer | Non-revoked `kind = review` logs that day |
| xp | integer | Review XP + session bonuses that day |
| goal_xp | smallint | The learner's `daily_xp_goal` at the time (snapshot) |
| all_available_done | boolean | Reported by the client when the day's queue is empty after studying (R14) |
| goal_met | boolean | `xp ≥ goal_xp OR all_available_done` |
| change_seq | | |

Drives the heatmap (FR-027) and streaks (FR-025). It is recomputed for the affected study days
whenever logs are inserted or revoked.

### ImportJob

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | Client-generated before the first chunk |
| user_id, deck_id | uuid | |
| file_name | text | |
| total_rows | integer | ≤ 10,000 (FR-013) |
| mapping | jsonb | `{ front: colIndex, back: colIndex, tags?: colIndex }` |
| duplicate_mode | enum `skip` \| `update` \| `keep_both` | |
| imported, updated, skipped | integer | |
| errors | jsonb | `[{ row, reason }]`. `reason` is a code from [contracts/csv-import.md](./contracts/csv-import.md) |
| created_at, completed_at | timestamptz | |

### Device

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | Generated on first launch and kept in IndexedDB |
| user_id | uuid | |
| label | text | Derived from the user agent |
| last_pull_seq | bigint | |
| last_seen_at | timestamptz | |

### PathNode *(derived view, not stored)*

Computed from a deck's non-deleted cards grouped by `node_index`:

| Field | Derivation |
|---|---|
| deck_id, index | |
| card_ids | Cards with this `node_index`, ordered by `position` |
| studied_count | Cards in the node whose state ≠ `new` |
| mastery | Cards in the node in state `review` ÷ cards in the node (FR-023, Story 3 #8) |
| status | See Path rules |

---

## Rules and state transitions

### Card FSRS state (FR-001)

| From | Again | Hard | Good | Easy |
|---|---|---|---|---|
| new | learning | learning | learning (review if no steps remain) | review |
| learning | learning | learning | next step, or review after the last step | review |
| review | relearning | review | review | review |
| relearning | relearning | relearning | review after the last step | review |

- From any state, **reset** (a ReviewLog with `kind = reset`) returns the card to `new`.
- **suspended** is a separate flag: a suspended card keeps its state and is left out of every
  queue.

The exact transitions and intervals are the scheduler's (ts-fsrs). This diagram is a guide, and
the test vectors are the source of truth (SC-004).

### Session queue building (FR-006, FR-015, FR-023a)

Inputs: deck, session kind, `now`, settings, and today's count of new cards introduced.

1. `review` session: due cards (`state ≠ new`, `due ≤ end of study day`, not suspended), learning
   and relearning first, then by `due` ascending, up to `session_size`. If every due card fits,
   the remaining slots are filled with `new` cards by `position`, capped by
   `deck.new_cards_per_day − introduced_today` (Story 1 #1).
2. `node` session: up to **10** due cards from the deck, most overdue first. Only if that includes
   every card due today in the deck, the node's `new` cards follow by `position`, up to 10, capped
   by `deck.new_cards_per_day − introduced_today`. Otherwise the session holds due cards only.

New cards are never introduced while a due card of the same deck is left out of the session
(FR-006, constitution Principle I).
3. `ahead` session (no cards due or new): Review cards not yet due, by `due` ascending. Every log
   has `study_ahead = true` and earns 0 XP.
4. A card graded Again (or still in learning steps) whose next `due` falls before the session ends
   is re-queued in the same session (Story 1 #6). The progress bar counts each queued card once.

### Path (FR-023)

- **node_index assignment** when a card is created: if the deck's last node has fewer than 10
  cards, use that node; otherwise use `last + 1`. Empty decks start at node 0. Assignments never
  change, so existing nodes are never reshuffled (Story 3 #2).
- **Status**:
  - `completed`: `studied_count = card count`, or the node has no remaining non-suspended new
    cards;
  - `available`: node 0, or the previous node is `completed`, and `studied_count = 0`;
  - `in_progress`: available and `0 < studied_count < card count`;
  - `locked`: otherwise.
- Locks never affect scheduling or the Review entry point (FR-023, Principle I).

### XP (FR-024)

```text
xp(log) = 0                        if log.revoked_at or log.study_ahead or log.kind = reset
        = 2                        otherwise (any grade: Again, Hard, Good, Easy)
session bonus = 5                  if session.completed and session.kind ≠ ahead
```

### Streak (FR-025)

- A study day is **met** when `DailyActivity.goal_met`.
- `current_streak`: the number of consecutive met days ending yesterday, plus one if today is
  met. "Today unmet but yesterday met" shows as *at risk* (Story 4 #3). If yesterday and today are
  both unmet, the streak is 0 (Story 4 #4).
- `longest_streak = max(longest_streak, current_streak)`.

### Dashboard donut segments (FR-028)

Each non-deleted card falls into exactly one segment, checked in this order:

1. `suspended = true` → **Suspended**
2. `state = new` → **New**
3. `state ∈ {learning, relearning}` → **Learning**
4. `state = review` and `due ≤ end of current study day` → **Due**
5. otherwise → **Not due**

The centre value is the number of cards to study today: Due + Learning that are due today + New
still allowed today. Invariant: the sum of segments equals the card count.

---

## Client store (`LocalStore` contract; web implementation: IndexedDB via Dexie)

The table below is the platform-neutral `LocalStore` contract (research R6, R17). The web app
implements it with Dexie. A future Flutter app implements the same stores as SQLite tables (drift)
and keeps media bytes in its own file cache instead of the service-worker cache.

| Store | Key | Contents | Notes |
|---|---|---|---|
| `meta` | key | `deviceId`, `pullCursor`, `userId`, `lastSyncAt` | Cleared on sign-out |
| `settings` | userId | LearnerSettings | |
| `stats` | userId | LearnerStats | Optimistic values, corrected on pull |
| `decks` | id | Deck | |
| `cards` | id; indexes `[deckId+state+due]`, `[deckId+nodeIndex]` | Card | Content and FSRS state only; no review history |
| `media` | id | MediaAsset metadata | Bytes live in the service-worker cache |
| `outbox` | id (UUIDv7, sorted) | `ReviewEvent` \| `RevokeEvent` \| `SessionEvent` \| `DayFlagEvent` | Deleted after the server acknowledges them |
| `sessions` | id | In-progress StudySession with queue and undo snapshot | Allows resume (FR-019) |
| `dailyActivity` | studyDay | Last 400 days | Heatmap and streak, readable offline |

Signing out clears every store and the media cache (shared-device privacy).
