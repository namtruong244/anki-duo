# Implementation Plan: Interactive Card Types

**Branch**: `002-interactive-card-types` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-interactive-card-types/spec.md`

## Summary

This feature adds the Anki-style card types the app lacks: **cloze** (with `{{hint:}}`),
**type in the answer**, native **multiple choice** (including a per-deck practice mode for
existing Basic cards) and **image occlusion**. It also adds smaller template features:
`{{tts}}`, furigana and KaTeX math.

**Technical approach** (details in [research.md](./research.md)):

- **Templates** (`packages/domain`): the tokenizer gets a generic filter chain (R1). Note types
  gain a `kind`, and a note can produce many cards per template through an integer `ordinal`
  (R2). `renderCard` also returns a structured, versioned **`interaction`** record and an
  `answerText` (R4, R8).
- **Interactive UI**: stored HTML stays strictly sanitized. The renderer only emits
  `<span class="ad-slot" id="ad-slot-N">` placeholders, and the web app mounts React widgets
  into them inside the existing Shadow DOM `CardHtml` (R4).
- **Saving notes** (`apps/api`): note save reconciles cards per `(templateId, ordinal)`. Vanished
  slots are soft-deleted, which keeps review logs. The server refuses with 409 until the client
  confirms the removal (R3).
- **Study session** (`apps/web`): the session gains an **`answering`** step. A pure
  `suggestGrade` maps wrong/almost/correct to Again/Hard/Good. An optional auto-grade setting
  applies it. FSRS scheduling and review events are unchanged (R7).
- **Pure domain functions**: cloze parsing (R5), typed-answer comparison and diff (R6), and
  choice building with an injected rng (R8) live in domain and are written test-first. Image
  occlusion stores normalized masks on the note and renders them as plain divs (R9).
- **Data formats**: export moves to `anki-duo-export` v2, and interaction data is recomputed on
  import (R13). Built-in note types are topped up for existing learners (R14).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict`), Node.js 24 LTS, React 19. These are unchanged
from 001.

**Primary Dependencies**: as in 001 (Hono, Drizzle, Zod/`@hono/zod-openapi`, Dexie, TipTap v3,
`htmlparser2`, i18next). The only new one is **`katex`**, used in `apps/web` for math and loaded
lazily. Diff, Levenshtein, cloze and furigana are hand-written in domain (R6, R12). The Web
Speech API is a browser built-in.

**Storage**: PostgreSQL. One new Drizzle migration, `0005_interactive_cards`, which changes:

- `card`: `ordinal`, `interaction`, `answer_text`, and a new unique index;
- `note`: `extra`;
- `note_type`: `kind`, `options`, `builtin_key`;
- `deck`: `mc_practice`;
- `learner_settings`: `auto_grade`.

On the client, Dexie stores the new fields as-is. No index change is needed (R4).

**Testing**: Vitest projects `unit` (domain), `int-api` (PGlite with real migrations) and
`int-web` (jsdom with fake-indexeddb); Playwright with axe for e2e; the i18n coverage test. See
research R16.

**Target Platform**: the 001 PWA on evergreen browsers, mobile first. Speech synthesis
availability varies by device, and the UI degrades gracefully when it is missing (R11).

**Project Type**: web application in the existing monorepo (`apps/web`, `apps/api`,
`packages/domain`, `packages/contract`, `packages/fixtures`).

**Performance Goals**:

- next interactive card shown in ≤ 100 ms at p95 on a mid-range phone, the same as 001 (SC-006);
- `compareTyped` and `buildChoices` in under 1 ms for typical inputs;
- KaTeX loaded only for cards that contain math;
- saving a note with 100 cards completes in a single transaction.

**Constraints**:

- Interactive study works fully offline. Content edits stay online-only (001).
- No author-controlled scripts, form controls, SVG or `data-*` in stored HTML (FR-013).
- The domain package has no clock and no randomness (rng and clock are injected).
- WCAG 2.2 AA, with keyboard and touch on every widget (FR-014).
- At most 100 cards per note and at most 8 options per choice.

**Scale/Scope**: the 001 limits (≤ 20,000 cards per learner). Four new built-in note types, about
6 new web components (type-in, choice, occlusion view, occlusion editor, hint, tts), 1 migration
and export v2.

No NEEDS CLARIFICATION items remain. Research R1–R16 resolves all of them.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution v1.0.0.

### Principle I — Learning-Science Fidelity

| Rule | How the plan satisfies it | Status |
|---|---|---|
| Published SRS algorithm, no undocumented deviation | FSRS is untouched. Interactive cards submit one of the same four grades through the same `grade()` path (R7) | ✅ |
| Scheduler deterministic; no clock or randomness | Scheduler unchanged. New domain functions (`compareTyped`, `suggestGrade`, `buildChoices`) are pure, and `buildChoices` takes an injected rng (R8) | ✅ |
| Gamification can't change scheduling or reward harmful behaviour | XP stays grade-independent. Correct answers earn no extra XP. Suggestions never propose Easy and never use answer time (clarification 4). Auto-grade only applies the verdict-derived grade (R7) | ✅ |
| Due before new; configurable new-card limit | The queue builder is unchanged. Extra cloze or occlusion cards are ordinary new cards subject to the daily limit | ✅ |
| Lossless review history | Vanished slots are soft-deleted and their review logs kept. Removal needs explicit confirmation. The migration test asserts logs survive (R3, R16) | ✅ |

### Principle II — Test-First

| Rule | How the plan satisfies it | Status |
|---|---|---|
| Failing test before each behaviour change | `/speckit-tasks` puts a test task before every implementation task. The domain functions get table-driven tests first (R16) | ✅ (process) |
| Persistence and migration tests prove history survives | `migrations.test.ts` is extended for `0005`. Reconciliation tests assert review logs remain after a soft-delete | ✅ |
| Deterministic tests | Seeded rng for choices, no wall clock (answer time is not used), PGlite and fake-indexeddb | ✅ |

### Platform Constraints

| Rule | Plan | Status |
|---|---|---|
| Offline review without loss | The interaction record and `answerText` are synced and stored in Dexie. Choices are built offline, and the session persists the answering state (R4, R7, R8) | ✅ |
| Open, documented export | `anki-duo-export` v2 is documented in [contracts/export-format-v2.md](./contracts/export-format-v2.md). Import accepts v1 | ✅ |
| Keyboard and touch; WCAG AA contrast | Keys 1–4 and Enter, tab/arrows for masks, and feedback with text and shape markers rather than colour alone (FR-014, R6, R9) | ✅ |
| New runtime dependencies justified | `katex`, see Complexity Tracking | ✅ |

**Gate result (pre-research)**: PASS.

**Gate result (post-design)**: PASS. Re-checked against [data-model.md](./data-model.md) and
[contracts/](./contracts/):

- interaction data is presentation-only;
- review events and the scheduler are unchanged;
- soft-delete keeps history.

## Project Structure

### Documentation (this feature)

```text
specs/002-interactive-card-types/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R16
├── data-model.md        # Phase 1: schema & domain delta
├── quickstart.md        # Phase 1: validation guide
├── contracts/
│   ├── api-changes.md        # REST /api/v1 delta (schemas, 409/422 problems)
│   ├── template-syntax.md    # Template filter & cloze syntax contract
│   └── export-format-v2.md   # anki-duo-export v2 delta
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
packages/domain/src/
├── notes/
│   ├── template.ts        # filter-chain tokenizer, ordinal-aware renderCard, validation (R1, R2)
│   ├── slots.ts           # listCardSlots (R2)
│   ├── cloze.ts           # cloze scanner & render (R5)
│   ├── interaction.ts     # Interaction types + builders (R4)
│   ├── furigana.ts        # furigana/kana/kanji (R12)
│   ├── sanitize.ts        # + strip reserved ad-* ids/classes (R4)
│   └── defaults.ts        # + cloze, basic_type, multiple_choice, image_occlusion (R14)
├── answer/
│   ├── compare.ts         # compareTyped + grapheme diff (R6)
│   ├── choices.ts         # buildChoices (rng injected) (R8)
│   └── suggest.ts         # suggestGrade (R7)
└── export/schema.ts       # v2 + v1 compatibility (R13)
packages/domain/tests/     # unit tests for all of the above
packages/contract/src/     # common.ts, decks.ts, notes.ts, note-types, me.ts (settings)

apps/api/
├── drizzle/0005_interactive_cards.sql
├── src/db/schema/{content,learner}.ts
├── src/services/{notes,note-types,export,mappers}.ts   # reconcile, 409, top-up, v2
└── tests/integration/{notes,note-types,export,migrations}.test.ts

apps/web/src/
├── components/card/CardHtml.tsx            # slot hydration, hint label, KaTeX post-process
├── components/answer/
│   ├── TypeInSlot.tsx  TypedDiff.tsx       # R6
│   ├── ChoiceSlot.tsx                      # R8
│   ├── OcclusionView.tsx                   # R9
│   └── TtsSlot.tsx                         # R11
├── components/editor/
│   ├── RichFieldEditor.tsx                 # cloze command + Ctrl/Cmd+Shift+C (FR-025)
│   ├── NoteEditor.tsx                      # card count, removal warning, MC/IO fields
│   └── OcclusionEditor.tsx                 # R9
├── client/session/session-machine.ts       # 'answering' status, submitAnswer, auto-grade, undo
├── client/session/choices.ts               # Dexie distractor pool + seeded rng
├── routes/session/SessionPage.tsx          # answering UI, suggested grade in GradeBar
├── routes/decks/DeckSettingsDialog.tsx     # mc_practice toggle
├── routes/settings/…                       # auto_grade toggle
└── i18n/messages/{en,vi}.json
apps/web/tests/                              # machine, CardHtml slots, widgets, editor
tests/e2e/                                   # one journey per story
```

**Structure Decision**: Keep the 001 monorepo layout. The template-level and answer-checking
logic is shared by API and web, so it goes in `packages/domain` (new `answer/` module). The API
owns rendering and reconciliation. The web app owns the interactive widgets and the answering
step.

## Delivery Order

| Phase | Scope | Depends on |
|---|---|---|
| P0 Foundation | R1 filter chain, R2 ordinals, R3 reconcile and 409, R4 interaction and slots, R7 answering step, R14 top-up, migration `0005`, contract and api-types, export v2 skeleton | — |
| P1 (US1) | Cloze and hint, editor cloze command, card count and removal warning | P0 |
| P2 (US2) | Type-in, compareTyped and diff, comparison options, auto-grade | P0 (P1 for `type:cloze`) |
| P3 (US3) | Multiple choice note type, deck practice mode, buildChoices | P0 |
| P4 (US4) | Image occlusion editor and view | P0, P1 (ordinal flow) |
| P5 (US5) | TTS, furigana, KaTeX | P0 |

## Complexity Tracking

| Violation / addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New runtime dependency `katex` (apps/web) | FR-062 needs reliable typesetting of LaTeX math, offline | Hand-rolled math rendering is not feasible. MathJax is larger and asynchronous. Server rendering would be stripped by the sanitizer (R13) |
| New `ordinal` column and composite identity | One template must produce many cards (FR-001) | A string-encoded templateId would need parsing everywhere and cannot be sorted or checked by the DB (R2) |
| Server 409 confirmation for card removal | FR-003 and constitution I (no silent loss of history) | A client-only warning can be skipped by a stale client (R3) |
