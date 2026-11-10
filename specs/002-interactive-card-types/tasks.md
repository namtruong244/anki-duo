---
description: "Task list for 002-interactive-card-types"
---

# Tasks: Interactive Card Types

**Input**: Design documents from `/specs/002-interactive-card-types/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle II (Test-First) is non-negotiable. Every test task
must be written first and fail for the right reason before its implementation task starts.

**Organization**: tasks are grouped by user story, so each story can be implemented and tested
on its own after Phase 2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 from spec.md
- Decisions are cited as R* (research.md). Requirements are cited as FR-*, SC-* or edge cases
  (spec.md).

## Path Conventions

The monorepo is described in [plan.md § Project Structure](./plan.md):

- `packages/domain/src`, `packages/domain/tests`
- `packages/contract/src`, `packages/contract/tests`
- `apps/api/src`, `apps/api/drizzle`, `apps/api/tests/integration`
- `apps/web/src`, `apps/web/tests`
- `tests/e2e`

The REST source of truth is `specs/001-fsrs-gamified-learning/contracts/openapi.yaml`.
`pnpm gen:api` regenerates `apps/web/src/client/api-types.ts` from it, and `pnpm test:contract`
compares the zod routes against it.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: module skeletons and a green baseline.

- [X] T001 Run `pnpm verify` on a clean tree and record any pre-existing failures in the PR description, so new failures can be told apart from old ones (no file change; note it in `specs/002-interactive-card-types/tasks.md` under Notes if any)
- [X] T002 [P] Create empty module barrels `packages/domain/src/answer/index.ts`, `packages/domain/src/notes/interaction.ts`, `packages/domain/src/notes/slots.ts`, `packages/domain/src/notes/cloze.ts` and `packages/domain/src/notes/furigana.ts`, and re-export them from `packages/domain/src/index.ts` and `packages/domain/src/notes/index.ts`
- [X] T003 [P] Create the empty folder `apps/web/src/components/answer/` with `index.ts` exporting a slot widget registry type `SlotWidget = (props: { slot: Slot; side: 'front' | 'back'; index: number }) => ReactNode` (R4)

---

## Phase 2: Foundational (Blocking Prerequisites, plan P0)

**Purpose**: the filter chain, ordinals, the interaction record, reconciliation with the removal
409, schema, migration and contract, export v2, the answering step in the session, and slot
hydration in `CardHtml`. Basic cards must behave exactly as before (FR-016).

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

### Tests for Foundation (write first, must fail) ⚠️

- [X] T004 [P] Filter-chain tokenizer tests in `packages/domain/tests/template-filters.test.ts`:
  - `{{f1:f2 arg:Field}}` splits on `:`; the last segment is the field; filters apply right to left;
  - `{{text:Field}}` behaves as today;
  - an unknown filter produces a validation error from `validateNoteType` and an error span in the render;
  - `renameFieldInTemplates` rewrites `{{type:cloze:Old}}` → `{{type:cloze:New}}`;
  - `tts` without an argument is an error.

  See [contracts/template-syntax.md](./contracts/template-syntax.md) and R1.
- [X] T005 [P] Reserved-attribute tests in `packages/domain/tests/sanitize-reserved.test.ts`:
  - `stripReservedAttrs` removes any `id` starting with `ad-` and any `class` token starting with `ad-`, and keeps the other ids and classes;
  - author-written `<span class="ad-slot" id="ad-slot-0">` inside a field never survives `renderCard`.

  See R4 and FR-013.
- [X] T006 [P] Script-injection payload suite in `packages/domain/tests/injection.test.ts`: a table of at least 30 known XSS payloads (script tags, `on*` handlers, `javascript:` URLs, `<svg onload>`, `<math>`, `<input autofocus onfocus>`, `<img src=x onerror>`, CSS `expression()`/`url(javascript:)`, nested-template tricks such as `{{c1::<img onerror>}}`). Each one goes through field values and templates, and the test asserts that `renderCard` output contains no script, event-handler attribute, form control, `svg`, `math` or `data-*` (SC-008).
- [X] T007 [P] Slot and render tests for standard kinds in `packages/domain/tests/slots.test.ts`:
  - `listCardSlots` for Basic, Basic (and reversed) and optional reversed returns `{ templateId, ordinal: 0 }` per template;
  - `renderCard(def, fields, null, { templateId, ordinal: 0 })` returns `interaction: null` and `answerText` equal to the plain text of the fields used on the back but not the front (R8);
  - the existing `notes.test.ts` expectations still pass (FR-016).
- [X] T008 [P] `suggestGrade` tests in `packages/domain/tests/suggest.test.ts`: `wrong → 1 (Again)`, `almost → 2 (Hard)`, `correct → 3 (Good)`. It never returns 4 and takes no time argument (FR-007, FR-009).
- [ ] T009 [P] Migration test in `apps/api/tests/integration/migrations.test.ts` for `0005_interactive_cards`:
  - existing `review_log` rows are byte-identical after the migration;
  - existing cards get `ordinal = 0`, `interaction = null` and `answer_text = ''`;
  - existing note types get `kind = 'standard'` and `options = '{}'`;
  - `builtin_key` is backfilled for rows that match the three 001 built-ins;
  - after `backfill-0005`, an existing Basic card's `answer_text` equals the plain text of its back-only fields, and its FSRS columns and `review_log` rows are unchanged.
- [ ] T010 [P] Reconciliation tests in `apps/api/tests/integration/notes.test.ts`:
  - card identity is `(note_id, template_id, ordinal)`;
  - new slots get adjacent positions in ordinal order (FR-004);
  - removing a template whose cards have `reps > 0` through `PATCH /note-types/{noteTypeId}` without `confirmRemoval` returns 409 `cards_would_be_removed` with `{ count, cards: [{ id, templateId, ordinal, reps }] }` listing only those reviewed cards, and saves nothing;
  - removing a template whose cards were never reviewed succeeds without `confirmRemoval` and soft-deletes them;
  - with `confirmRemoval: true` the card is soft-deleted (`deleted_at` set) and its `review_log` rows remain (SC-003);
  - a slot whose front renders empty is kept;
  - a note producing more than 100 cards returns 422 `too_many_cards`;
  - `cardIds` keyed `"templateId:ordinal"` is honoured.
- [ ] T011 [P] Built-in top-up tests in `apps/api/tests/integration/note-types.test.ts` (new file):
  - `GET /note-types` for a learner who has only the three 001 built-ins inserts each missing `builtin_key`;
  - the top-up is idempotent under concurrent calls (`on conflict do nothing`);
  - a renamed built-in keeps its key and is not duplicated (R14).
- [ ] T012 [P] Deck and settings field tests:
  - in `apps/api/tests/integration/decks.test.ts`, `mcPractice` defaults to `false` and can be set by `POST /decks` and `PATCH /decks/{deckId}`, and toggling it changes no card FSRS column (FR-047);
  - in `apps/api/tests/integration/settings.test.ts`, `autoGrade` defaults to `false` and can be set by `PATCH /me/settings`.
- [ ] T013 [P] Export v2 tests:
  - in `packages/domain/tests/export.test.ts`, `parseExport` accepts `version: 1` and `version: 2` and fills the defaults for v1;
  - in `apps/api/tests/integration/export-restore.test.ts`, export then restore reproduces the same cards with the same `ordinal` and `answerText`;
  - restore recomputes `interaction` from the note and ignores an `interaction` supplied in the file.

  See [contracts/export-format-v2.md](./contracts/export-format-v2.md) and SC-004.
- [ ] T014 [P] Session machine tests in `apps/web/tests/session/session-machine.test.ts`:
  - a card whose effective answer has `kind` `'type'` or `'choice'` starts in status `'answering'`; an `'occlusion'` answer, a null answer and a Basic card go `'front'` → `'back'` through `reveal()` with `suggested = null`;
  - `submitAnswer({ verdict, given?, choiceIndex? })` moves it to `'back'` and exposes `suggested`;
  - `grade()` submits only the chosen grade and the review event shape is unchanged (FR-010);
  - with `autoGrade: true`, `grade(suggested)` runs right after `submitAnswer` and the state stays on `'back'` until `continue()`;
  - `undo()` returns the card to `'answering'` with the answer cleared (FR-012);
  - a reload restores the persisted `answer` (R7);
  - Basic cards still go `'front'` → `'back'`.
- [ ] T015 [P] `CardHtml` slot hydration tests in `apps/web/tests/components/card-html.test.tsx`:
  - for HTML containing `<span class="ad-slot" id="ad-slot-0">` and `interaction.slots[0]`, the registered widget mounts inside the shadow root;
  - missing slot entries render nothing;
  - `<details class="ad-hint"><summary></summary>` gets the localized label;
  - Basic cards render exactly as before.
- [ ] T015a [P] Session page tests in `apps/web/tests/session/session-page.test.tsx`:
  - while `'answering'` the reveal button is hidden and `CardHtml` receives `interaction` and `side`;
  - after `submitAnswer`, GradeBar shows the "Suggested" text badge on the suggested grade;
  - Space/Enter confirms the suggestion, and the Enter that submitted a TypeInSlot does not also confirm it;
  - with auto-grade on, the feedback and "Continue" stay visible until clicked.
- [X] T015b [P] Auto-grade toggle tests: extend `apps/web/tests/components/settings.test.tsx` and `apps/web/tests/settings-save.test.ts` (default off, saves `autoGrade`) (FR-008).
- [X] T015c [P] Removal-warning tests:
  - extend `apps/web/tests/components/note-editor.test.tsx`: the dialog shows the count of reviewed (`reps > 0`) cards that will be removed; confirming resends with `confirmRemoval: true`; removing only unreviewed cards shows no dialog; a server 409 opens the same dialog;
  - extend the `NoteTypeEditorPage` block in `apps/web/tests/components/note-types.test.tsx` with the same cases (FR-003).
- [ ] T015d [P] Dexie upgrade test in `apps/web/tests/local-store-upgrade.test.ts` (fake-indexeddb): open a v2 database seeded with `cards`, `outbox` (pending review events), `sessions` and `noteTypes`; reopen with the v3 schema; assert every row, above all `outbox` and the cards' `fsrs`, is deep-equal to before, and that v2 cards read back with `ordinal`, `interaction` and `answerText` undefined, handled as `0 / null / ''` by `local-store.ts` (constitution II, persistence).

### Implementation for Foundation

- [X] T016 [P] Define the `Interaction`, `Slot`, `Answer`, `Mask` and `NoteExtra` types and the `NoteTypeKind = 'standard' | 'cloze' | 'image_occlusion' | 'multiple_choice'` and `NoteTypeOptions` types in `packages/domain/src/notes/interaction.ts` and `packages/domain/src/notes/types.ts`, copied verbatim from [data-model.md](./data-model.md). `NoteTypeDef` gains `kind` and `options`. `Mask` has `n: int ≥ 1` and `x, y, w, h` as numbers in 0..1.
- [X] T017 Replace the tokenizer's `textOnly` with `filters: string[]` in `packages/domain/src/notes/template.ts`:
  - parse `{{f1:f2 arg:Field}}`;
  - implement a filter dispatch table (only `text` is active for now; the others register in their stories);
  - make an unknown filter an error in `checkTemplateSide`/`validateNoteType`;
  - update `renameFieldInTemplates` to rewrite the field inside any chain.

  Makes T004 pass (R1).
- [X] T018 [P] Implement `stripReservedAttrs` in `packages/domain/src/notes/sanitize.ts` and call it on field values and templates before rendering in `template.ts`. Makes T005 and T006 pass (R4).
- [X] T019 Implement `listCardSlots(def, fields, extra)` in `packages/domain/src/notes/slots.ts` (standard kind: one slot per template, ordinal 0). Change `renderCard` in `packages/domain/src/notes/template.ts` to the signature `renderCard(def, fields, extra, { templateId, ordinal, tags?, deckName? })`. It returns `{ front, back, frontEmpty, interaction, answerText }` and appends slots with `<span class="ad-slot" id="ad-slot-N"></span>` after sanitization. Update every caller: `apps/api/src/services/notes.ts`, `apps/web/src/components/editor/RichFieldEditor.tsx` and `apps/web/src/routes/note-types/NoteTypeEditorPage.tsx`. Makes T007 pass (R2, R4, R8).
- [X] T020 [P] Implement `suggestGrade` in `packages/domain/src/answer/suggest.ts`. Makes T008 pass (R7).
- [X] T021 Add a `builtinKey` to each entry and `kind: 'standard'` and `options: {}` to the 001 built-ins in `packages/domain/src/notes/defaults.ts`. Keep the existing ids `t_card1`, `t_card2`, `f_front`, `f_back` and `f_addrev`.
- [X] T022 Add the columns to the Drizzle schemas:
  - in `apps/api/src/db/schema/content.ts`:
    - `card.ordinal integer not null default 0`, `card.interaction jsonb null` and `card.answer_text text not null default ''`;
    - replace the `card_note_template_unique` index with `card_note_ordinal_unique` on `(note_id, template_id, ordinal)` where `deleted_at is null and note_id is not null`;
    - `note.extra jsonb null`;
    - `note_type.kind text not null default 'standard'`, with a check in (`standard`, `cloze`, `image_occlusion`, `multiple_choice`);
    - `note_type.options jsonb not null default '{}'` and `note_type.builtin_key text null`;
    - the unique index `note_type_user_builtin_unique` on `(user_id, builtin_key)` where `deleted_at is null and builtin_key is not null`;
    - `deck.mc_practice boolean not null default false`;
  - in `apps/api/src/db/schema/learner.ts`, `learner_settings.auto_grade boolean not null default false`.
- [ ] T023 Generate the migration `apps/api/drizzle/0005_interactive_cards.sql` and its snapshot, and update `apps/api/drizzle/meta/_journal.json`. Hand-add the `builtin_key` backfill (match on name and templates against the 001 built-ins). Add `apps/api/src/db/backfill-0005.ts`, which re-renders every live card's `answer_text` (and `interaction`) with `renderCard` in batches of 500, changing content columns only; the `apps/api` migrate script runs it right after `0005` is applied. It is idempotent: it skips rows whose `answer_text` is already non-empty or whose note renders to an empty answer. Makes T009 pass.
- [X] T024 Update the shared zod schemas in `packages/contract/src/common.ts`:
  - `Card` gains `ordinal` (int ≥ 0), `interaction` (`Interaction | null`, output only) and `answerText`;
  - `Deck` gains `mcPractice`;
  - `NoteType` gains `kind`, `options` and `builtinKey`;
  - `Note` gains `extra`, and its `cards` items become `{ id, templateId, ordinal }`;
  - `SettingsFields` gains `autoGrade`.
- [X] T025 Update the request schemas and routes in `packages/contract/src/decks.ts` (`mcPractice?`), `packages/contract/src/notes.ts` and `packages/contract/src/me.ts`:
  - the note create body gains `extra?` and `cardIds?`, keyed by `templateId` for ordinal 0 and `"templateId:ordinal"` otherwise;
  - the note patch body gains `extra?` and `confirmRemoval?`;
  - the note-type create and patch bodies gain `kind?`, `options?` and `confirmRemoval?` (patch only);
  - the settings patch gains `autoGrade?`.

  Add the 409 `cards_would_be_removed` and 422 `too_many_cards`, `cloze_required`, `wrong_answers_required` and `occlusion_masks_required` problem responses. See [contracts/api-changes.md](./contracts/api-changes.md).
- [X] T026 Mirror T024–T025 in `specs/001-fsrs-gamified-learning/contracts/openapi.yaml`, run `pnpm gen:api` to regenerate `apps/web/src/client/api-types.ts`, and make `pnpm test:contract` pass (`packages/contract/tests/openapi.test.ts`).
- [ ] T027 Map the new columns in both directions in `apps/api/src/services/mappers.ts`: card `ordinal`, `interaction` and `answerText`; deck `mcPractice`; note `extra`; note type `kind`, `options` and `builtinKey`. Map settings `autoGrade` in `apps/api/src/services/settings.ts`. Accept `mcPractice` in `apps/api/src/services/decks.ts`. Makes T012 pass.
- [ ] T028 Rewrite `syncNoteCards` in `apps/api/src/services/notes.ts` to diff the wanted `listCardSlots` set against the live `(templateId, ordinal)` cards:
  - insert new slots, reserving placement in ordinal order through `apps/api/src/services/placement.ts`;
  - update only the content columns `front`, `back`, `front_norm`, `interaction`, `answer_text` and `tags` on existing slots;
  - soft-delete vanished slots, keeping their `review_log` rows;
  - throw 409 `cards_would_be_removed` when any vanished card is reviewed (`reps > 0` or has a `review_log` row) and `confirmRemoval` is not set; unreviewed vanished cards are soft-deleted without confirmation;
  - enforce "Note produces ≤ 100 cards" → 422 `too_many_cards`.

  Make `toNote` return `ordinal`. Wire `confirmRemoval` and `extra` through `apps/api/src/routes/notes.ts`. Makes T010 pass (R3).
- [ ] T029 Make seeding a top-up in `apps/api/src/services/note-types.ts`: every list call inserts each missing `builtin_key` with `on conflict do nothing`. Route `PATCH /note-types/{noteTypeId}` through the same reconciliation with `confirmRemoval`. Makes T011 pass (R14).
- [ ] T030 Implement export v2:
  - in `packages/domain/src/export/schema.ts`, widen `ExportDoc.version` to `1 | 2`, set `EXPORT_VERSION = 2`, and add the optional fields from [contracts/export-format-v2.md](./contracts/export-format-v2.md) with v1 defaults;
  - in `apps/api/src/services/export.ts`, write the new fields, and on restore re-render the note cards on the server, never trusting `interaction` from the file.

  Makes T013 pass (R13).
- [ ] T031 [P] Update the client store:
  - in `apps/web/src/client/dexie-store.ts`, bump Dexie to `version(3)` with unchanged `stores()` (no new index);
  - in `apps/web/src/client/local-store.ts`, extend the `Card`, `Deck`, `Settings` and `NoteType` types from `api-types`, and add `answer?: { verdict: 'correct'|'almost'|'wrong'|null; given?: string; choiceIndex?: number; suggested: 1|2|3|null }` to `StoredSession`.

  Makes T015d pass.
- [ ] T032 Add the status `'answering'` to `apps/web/src/client/session/session-machine.ts`:
  - `front` → `answering` when `effectiveAnswer(card, ctx)?.kind` is `'type'` or `'choice'`, through an `isAnswerable(answer)` helper (`effectiveAnswer` is the hook later stories extend);
  - `submitAnswer(result)` → `back` and stores `answer` in the persisted session;
  - `autoGrade` from settings calls `grade(suggested)` and holds `back` until `continue()`;
  - `undo()` restores `answering` with the answer cleared;
  - occlusion and non-interactive cards use `reveal()` as before.

  Makes T014 pass (R7).
- [ ] T033 Add slot hydration to `apps/web/src/components/card/CardHtml.tsx`:
  - accept an `interaction` prop and a `side` prop;
  - after the shadow-root content mounts, find `#ad-slot-N` and `createPortal` the widget registered for `interaction.slots[N].kind` (registry in `apps/web/src/components/answer/index.ts`);
  - fill an empty `details.ad-hint > summary` with `t('card.showHint')`;
  - add `.cloze`, `.ad-hint` and slot base styles to `BASE_CSS`.

  Makes T015 pass (R4, R10).
- [ ] T034 Render the answering state in `apps/web/src/routes/session/SessionPage.tsx`:
  - pass `card.interaction` and `side` to `CardHtml`;
  - hide the reveal button while `'answering'`;
  - show the feedback and "Continue" after an auto-grade.

  Give `apps/web/src/components/session/GradeBar.tsx` a `suggested?: 1|2|3` prop that draws a visible focus ring with a text badge ("Suggested"), and make Space/Enter confirm the suggestion. Keys typed inside inputs must still never grade (FR-011). Makes T015a pass.
- [X] T035 [P] Add the "Auto-grade" toggle (default off, FR-008) to `apps/web/src/routes/settings/SettingsPage.tsx` and save it through `apps/web/src/client/settings-save.ts`. Makes T015b pass.
- [X] T036 Add a removal-confirmation flow to `apps/web/src/client/content.ts` and `apps/web/src/components/editor/NoteEditor.tsx`:
  - before saving, compute the vanished slots with `listCardSlots` against `note.cards`;
  - read each vanished card's `reps` from the Dexie `cards` table; if any is above 0, show a `Dialog` saying how many cards (and their review history) will be removed, and resend with `confirmRemoval: true` on confirm;
  - also handle a server 409 the same way.

  Do the same in `apps/web/src/routes/note-types/NoteTypeEditorPage.tsx`. Makes T015c pass (FR-003).
- [X] T037 [P] Add the foundation i18n keys (`card.showHint`, `session.suggested`, `session.continue`, `settings.autoGrade`, `settings.autoGradeHint`, `editor.removeCardsTitle`, `editor.removeCardsBody` with `{count}`, and the problem messages for the five new codes) to `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/vi.json`. `pnpm test:i18n` must pass (FR-017).

**Checkpoint**: `pnpm verify` is green. Basic cards study exactly as before. The new columns flow
through the API, sync, Dexie and export. User stories can now proceed in parallel.

---

## Phase 3: User Story 1 - Study a cloze-deletion note (Priority: P1) 🎯 MVP

**Goal**: Cloze notes produce one card per cloze number, hide and reveal correctly, support
nesting and hints, and are easy to author.

**Independent Test**: Create a Cloze note with c1 and c2 and confirm that two adjacent cards
exist. Study each card: the correct part is hidden on the front and highlighted on the back.
Remove c2: after a warning, only that card disappears ([quickstart.md](./quickstart.md) V1–V3).

### Tests for User Story 1 (write first, must fail) ⚠️

- [ ] T038 [P] [US1] Cloze scanner tests in `packages/domain/tests/cloze.test.ts`:
  - `parseCloze` on `{{c1::A}}`, `{{c2::B::hint}}`, repeated `c1`, skipped numbers (c1, c3 → ordinals [1, 3]), nested `{{c1::capital of {{c2::France}}}}`, answers containing HTML;
  - markers inside tag attributes are ignored;
  - malformed `{{c1::abc`, `{{c0::x}}`, `{{cx::x}}` and an unmatched `}}` stay literal;
  - `findClozeProblems` reports each malformed marker.

  See [contracts/template-syntax.md § Cloze markers](./contracts/template-syntax.md) and R5.
- [ ] T039 [P] [US1] Cloze render tests in `packages/domain/tests/cloze-render.test.ts`:
  - for card N, the front shows each cN as `<span class="cloze">[...]</span>`, or `[hint]` when a hint is given;
  - other numbers render as their answer;
  - the back shows `<span class="cloze">answer</span>`;
  - nesting: card 1 hides the whole outer span, card 2 hides only the inner one (FR-022, FR-023);
  - `listCardSlots` for a cloze kind returns one ordinal per distinct N in fields that the front uses through `cloze`;
  - more than 100 ordinals is reported.
- [ ] T040 [P] [US1] Hint filter tests in `packages/domain/tests/template-filters.test.ts`: `{{hint:Notes}}` with a non-empty field renders `<details class="ad-hint"><summary></summary>…</details>`, and an empty field renders nothing (FR-027).
- [ ] T041 [P] [US1] API cloze integration tests in `apps/api/tests/integration/notes.test.ts`:
  - creating a Cloze note with c1 and c2 makes 2 cards at adjacent positions;
  - adding c3 makes 1 new card and leaves the FSRS columns of c1 and c2 unchanged;
  - after c3 has been reviewed, removing it without `confirmRemoval` returns 409, and with it the card is soft-deleted and its logs kept; removing a never-reviewed cN needs no confirmation;
  - a Cloze note without a valid marker returns 422 `cloze_required` (FR-024);
  - 101 clozes returns 422 `too_many_cards`.
- [ ] T042 [P] [US1] Editor tests in `apps/web/tests/components/note-editor.test.tsx`:
  - the cloze button and Ctrl+Shift+C (Cmd+Shift+C on macOS) wrap the selection as the next unused number;
  - Ctrl+Alt+Shift+C reuses the highest number (FR-025);
  - the card count updates live (FR-026);
  - a malformed marker shows a warning.
- [ ] T042a [P] [US1] Cloze preview tests in `apps/web/tests/components/note-types.test.tsx` (`NoteTypeEditorPage` block): picking cloze number N in the preview renders card N.
- [ ] T043 [P] [US1] E2E cloze journey in `tests/e2e/cloze.spec.ts` following [quickstart.md](./quickstart.md) V1–V3: create, study c2, remove c3 with the warning, nested cloze.

### Implementation for User Story 1

- [ ] T044 [US1] Implement `parseCloze(html)`, `findClozeProblems(html)` and `renderCloze(html, n, side)` in `packages/domain/src/notes/cloze.ts`: a depth-counting scanner over sanitized HTML that skips tag interiors and returns `{ n, answerHtml, hint?, start, end, children }` (R5). Makes T038 pass.
- [ ] T045 [US1] Register the `cloze` and `hint` filters in `packages/domain/src/notes/template.ts`, and add the cloze-kind ordinals to `listCardSlots` in `packages/domain/src/notes/slots.ts`. `validateNoteType` errors when `cloze` is used in a `standard` kind, or when a `cloze` kind does not use it on the front. Makes T039 and T040 pass.
- [ ] T046 [US1] Add the `cloze` built-in ("Cloze", kind `cloze`, fields Text and Back Extra, front `{{cloze:Text}}`, back `{{cloze:Text}}<br>{{Back Extra}}`) to `packages/domain/src/notes/defaults.ts`, following [data-model.md § Built-in note types](./data-model.md).
- [ ] T047 [US1] Enforce `cloze_required` ("Cloze note needs at least one valid `{{cN::…}}` in a field the front clozes") in `apps/api/src/services/notes.ts` on create and patch. Makes T041 pass.
- [ ] T048 [US1] Add a cloze toolbar button and keyboard shortcuts to `apps/web/src/components/editor/RichFieldEditor.tsx`: a TipTap command wraps the selection in `{{cN::…}}` with the next unused N across all the note's fields; Mod+Shift+C uses the next number and Mod+Alt+Shift+C reuses the highest. Only show it for `kind === 'cloze'`.
- [ ] T049 [US1] Show the live card count (from `listCardSlots`) and a `findClozeProblems` warning, and block saving with no valid marker, in `apps/web/src/components/editor/NoteEditor.tsx`. Makes T042 pass.
- [ ] T050 [P] [US1] Add a cloze-number selector to the preview in `apps/web/src/routes/note-types/NoteTypeEditorPage.tsx`, so authors can preview card N. Makes T042a pass.
- [X] T051 [P] [US1] Add the i18n keys (`editor.cloze`, `editor.clozeShortcut`, `editor.cardCount` with `{count}`, `editor.clozeProblem`, `noteTypes.builtin.cloze`) to `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/vi.json`.

**Checkpoint**: US1 works on its own (MVP). T043 passes.

---

## Phase 4: User Story 2 - Answer by typing (Priority: P1)

**Goal**: Type-in cards take a typed answer, compare it with normalization, show a
per-character diff, and suggest Again/Hard/Good.

**Independent Test**: Study a "Basic (type in the answer)" card "Con voi → elephant". Type
`elephnt`: the result is "almost correct" with Hard suggested. Type `Elephant`: correct with
Good suggested. Type `xyz`: wrong with Again suggested ([quickstart.md](./quickstart.md) V4–V5).

### Tests for User Story 2 (write first, must fail) ⚠️

- [ ] T052 [P] [US2] `compareTyped` table tests in `packages/domain/tests/compare.test.ts`:
  - trim, internal whitespace collapse and NFC vs NFD input count as equal (FR-032);
  - `ignoreCase` defaults to on, and `ignoreDiacritics` (off by default) maps `Việt Nam` ≈ `viet nam` and `đ` → `d` (FR-033);
  - graphemes: emoji and combined characters count as one unit;
  - **almost-correct rule**: "exactly 1 character edit … for expected answers of 5–11 characters, or by at most 2 edits for 12 characters or more. Answers shorter than 5 characters are only correct or incorrect" (FR-035). For example, `elephnt`/`elephant` → almost, and `cat`/`cut` → wrong;
  - empty input → wrong (edge case);
  - the diff ops are `equal | wrong | missing | extra` with correct spans (FR-034).
- [ ] T053 [P] [US2] Type filter tests in `packages/domain/tests/template-filters.test.ts`:
  - `{{type:Back}}` emits one `type` slot with `answer = { kind: 'type', expected, ignoreCase, ignoreDiacritics }` copied from `note_type.options`;
  - `{{type:cloze:Text}}` sets `expected` to card N's answers joined with `", "` (FR-031);
  - an empty expected answer gives `answer: null` (edge case);
  - a second `{{type:}}` renders the expected text statically and `validateNoteType` returns a warning;
  - a type tag only on the back is a warning.
- [ ] T054 [P] [US2] Widget tests in `apps/web/tests/components/type-in.test.tsx`:
  - `TypeInSlot` autofocuses, Enter submits through `submitAnswer`, and the keys 1–4 and Space typed into it never reach GradeBar (FR-011);
  - on the back, `TypedDiff` renders the typed and expected answers with text markers (underline or strikethrough plus an sr-only label), not colour alone (FR-034, FR-014);
  - the verdict "almost correct" is shown.
- [ ] T054a [P] [US2] Comparison-option tests in `apps/web/tests/components/note-types.test.tsx` (`NoteTypeEditorPage` block): the "Ignore case" and "Ignore diacritics" toggles default to on and off, and saving sends `options.typeIgnoreCase` and `options.typeIgnoreDiacritics` (FR-033).
- [ ] T055 [P] [US2] E2E type-in journey in `tests/e2e/type-in.spec.ts` following [quickstart.md](./quickstart.md) V4–V6: almost, correct and wrong; the diacritics option; auto-grade on; keyboard only (SC-002).

### Implementation for User Story 2

- [ ] T056 [US2] Implement `compareTyped(expected, given, { ignoreCase, ignoreDiacritics })` in `packages/domain/src/answer/compare.ts`:
  - normalize with `htmlToText`, NFC, trim and whitespace collapse;
  - case-fold with `toLowerCase()`;
  - strip diacritics with NFD, removing `\p{M}`, and map `đ/Đ → d/D`;
  - split into graphemes with `Intl.Segmenter`;
  - compute Levenshtein distance for the verdict and an LCS alignment for the `DiffOp[]`.

  Makes T052 pass (R6).
- [ ] T057 [US2] Register the `type` filter in `packages/domain/src/notes/template.ts`, including the `type:cloze` chain that reuses `renderCloze` from T044. Only the first `type` slot is interactive, and the comparison options come from `def.options` (`typeIgnoreCase` default true, `typeIgnoreDiacritics` default false; R15). Makes T053 pass.
- [ ] T058 [US2] Add the `basic_type` built-in ("Basic (type in the answer)", kind `standard`, fields Front and Back, front `{{Front}}<br>{{type:Back}}`, back `{{Front}}<hr id=answer>{{type:Back}}`, options `{typeIgnoreCase:true, typeIgnoreDiacritics:false}`) to `packages/domain/src/notes/defaults.ts`.
- [ ] T059 [P] [US2] Create `apps/web/src/components/answer/TypeInSlot.tsx`: a labelled input that autofocuses on the front and submits on Enter with `stopPropagation`. It calls `compareTyped` and `suggestGrade` and then `submitAnswer({ verdict, given })`. Register it for slot kind `type` in `apps/web/src/components/answer/index.ts`.
- [ ] T060 [P] [US2] Create `apps/web/src/components/answer/TypedDiff.tsx`: on the back it renders the typed and expected answers with `equal/wrong/missing/extra` runs using colour plus underline, strikethrough or inserted-caret markers and sr-only labels, and a verdict badge ("Correct", "Almost correct", "Incorrect"). Makes T054 pass.
- [ ] T061 [US2] Add the "Ignore case" and "Ignore diacritics" toggles to the note-type options in `apps/web/src/routes/note-types/NoteTypeEditorPage.tsx` and save them through `PATCH /note-types/{noteTypeId}` `options`. Makes T054a pass.
- [X] T062 [P] [US2] Add the i18n keys (`answer.typePlaceholder`, `answer.correct`, `answer.almost`, `answer.incorrect`, `answer.yourAnswer`, `answer.expected`, `answer.missing`, `answer.extra`, `noteTypes.ignoreCase`, `noteTypes.ignoreDiacritics`, `noteTypes.builtin.basicType`) to `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/vi.json`.

**Checkpoint**: US1 and US2 both work on their own. T055 passes.

---

## Phase 5: User Story 3 - Answer a multiple-choice question (Priority: P2)

**Goal**: A native Multiple choice note type, plus a per-deck "multiple-choice practice" mode
that turns Basic cards into multiple choice, with options built offline.

**Independent Test**: Create a Multiple choice note with 1 correct and 3 wrong answers. Over
several showings the order changes. A wrong pick gives feedback and suggests Again. Turn on
practice for a Basic deck: its cards show 4 options, and long or image-only answers fall back
to a normal reveal ([quickstart.md](./quickstart.md) V7–V8).

### Tests for User Story 3 (write first, must fail) ⚠️

- [ ] T063 [P] [US3] `buildChoices` tests in `packages/domain/tests/choices.test.ts` with a seeded rng:
  - the result contains the correct answer plus the wrong ones;
  - options are de-duplicated after normalization (R6 normalization);
  - "≤ 8 (correct + ≤ 7 wrong)": with 10 wrong answers the result has exactly 8 options, always including the correct one, and different seeds sample different wrong subsets;
  - when `wrong` is empty, it picks "up to 3, each non-empty, ≤ 80 chars, distinct after normalization" from `pool`;
  - it returns `null` when fewer than 2 distinct options exist, or when the correct answer is longer than 80 characters or empty (FR-046);
  - the same seed gives the same order, and different seeds give different orders.
- [ ] T064 [P] [US3] Choice filter tests in `packages/domain/tests/template-filters.test.ts`:
  - `{{choice:Correct}}` in a `multiple_choice` kind with `options.roles` emits a `choice` slot and `answer = { kind: 'choice', correct, wrong, explanationHtml }`;
  - wrong answers are split on `<br>`, `<p>` and `\n`, trimmed and de-duplicated;
  - `answerText` is the Correct text;
  - `choice` used outside its kind, or missing `roles`, is a `validateNoteType` error.
- [ ] T065 [P] [US3] API tests in `apps/api/tests/integration/notes.test.ts`:
  - a multiple-choice note with no wrong answers returns 422 `wrong_answers_required` when the deck has `mcPractice=false`, and saves when `mcPractice=true` (FR-045);
  - moving such a note to a deck with `mcPractice=false` is rejected with the same code.
- [ ] T066 [P] [US3] Distractor pool tests in `apps/web/tests/session/choices.test.ts` (fake-indexeddb):
  - the pool is cards in the same deck with the same `(noteTypeId, templateId)`, with Markdown cards grouped together;
  - non-empty `answerText` of at most 80 characters, excluding the card itself;
  - the session machine treats a Basic card as an effective multiple-choice card (status `'answering'`) only when `deck.mcPractice` is on and `buildChoices` returns a non-null result.
- [ ] T067 [P] [US3] `ChoiceSlot` tests in `apps/web/tests/components/choice.test.tsx`:
  - options render as large buttons, keys 1–4 pick the first four, tab and arrows reach the rest;
  - after a pick, the chosen option is marked correct or incorrect with an icon and text (not colour alone), the correct option is always highlighted, and the explanation is revealed;
  - the suggestion is Good for a correct pick and Again for a wrong one (FR-042, FR-043).
- [ ] T067a [P] [US3] Wrong-answers editor tests in `apps/web/tests/components/note-editor.test.tsx`: for `kind === 'multiple_choice'` the Wrong answers field shows the "one per line" hint; with no wrong answers an inline error appears when the deck's `mcPractice` is off and not when it is on (FR-045).
- [ ] T067b [P] [US3] Deck practice toggle tests: extend `apps/web/tests/components/deck-settings.test.tsx` (default off, saves `mcPractice`) (FR-044).
- [ ] T068 [P] [US3] E2E multiple-choice journey in `tests/e2e/multiple-choice.spec.ts` following [quickstart.md](./quickstart.md) V7–V8.

### Implementation for User Story 3

- [ ] T069 [US3] Implement `buildChoices({ correct, wrong, pool, rng })` in `packages/domain/src/answer/choices.ts`. It is pure; `rng` is `() => number` in [0,1); Fisher–Yates shuffle (R8). Makes T063 pass.
- [ ] T070 [US3] Register the `choice` filter in `packages/domain/src/notes/template.ts`: it uses `def.options.roles` (`correct`, `wrong`, `explanation` field ids), splits and de-duplicates wrong answers, keeps **all** of them in the interaction record (`buildChoices` samples up to 7 per showing), and sets `answerText`. Makes T064 pass.
- [ ] T071 [US3] Add the `multiple_choice` built-in ("Multiple choice", kind `multiple_choice`, fields Question, Correct, Wrong answers and Explanation, front `{{Question}}{{choice:Correct}}`, back `{{Question}}{{choice:Correct}}<hr id=answer>{{Explanation}}`, options `{roles:{correct:'f_correct', wrong:'f_wrong_answers', explanation:'f_explanation'}}`) to `packages/domain/src/notes/defaults.ts`.
- [ ] T072 [US3] Enforce `wrong_answers_required` ("Multiple-choice note needs ≥ 1 wrong answer unless the target deck has `mc_practice`") on create, patch and deck move in `apps/api/src/services/notes.ts`. Makes T065 pass.
- [ ] T073 [US3] Create `apps/web/src/client/session/choices.ts`:
  - `loadDistractorPool(store, card)` reads Dexie cards by the `deckId` index and filters them in memory (R8);
  - `seededRng(seed)` is a mulberry32 PRNG seeded from `cardId` and the session's showing counter, so the order changes between showings and is stable within one;
  - `effectiveAnswer(card, deck, pool)` returns the stored `interaction.answer`. For a Basic or Markdown card with `deck.mcPractice` on, it returns a synthesized `{ kind: 'choice', correct: card.answerText, wrong: [], explanationHtml: '' }` passed through `buildChoices`.

  Plug `effectiveAnswer` into the T032 hook in `apps/web/src/client/session/session-machine.ts`. Makes T066 pass.
- [ ] T074 [P] [US3] Create `apps/web/src/components/answer/ChoiceSlot.tsx`:
  - large, Duolingo-style 3D buttons (reuse `ChunkyButton`) that wrap long text on mobile;
  - keys 1–4, with `stopPropagation` so GradeBar does not also grade;
  - feedback state with a correct/incorrect icon and text, and the explanation;
  - the existing sound module plays on pick.

  Register it for slot kind `choice`. For synthesized practice cards (no slot in the HTML), render it below the `CardHtml` front in `apps/web/src/routes/session/SessionPage.tsx`. Makes T067 pass.
- [ ] T075 [P] [US3] Add a "Multiple-choice practice" toggle (default off) with a help line to `apps/web/src/routes/decks/DeckSettingsDialog.tsx`. Makes T067b pass.
- [ ] T076 [US3] Show a "one per line" hint on the Wrong answers field for `kind === 'multiple_choice'` in `apps/web/src/components/editor/NoteEditor.tsx`, and an inline error when there are no wrong answers and the deck's practice mode is off. Makes T067a pass.
- [X] T077 [P] [US3] Add the i18n keys (`answer.choose`, `answer.explanation`, `decks.mcPractice`, `decks.mcPracticeHint`, `editor.wrongAnswersHint`, `noteTypes.builtin.multipleChoice`) to `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/vi.json`.

**Checkpoint**: US3 works on its own. T068 passes.

---

## Phase 6: User Story 4 - Study image occlusion cards (Priority: P2)

**Goal**: Draw rectangle and ellipse masks over an image. Each mask is a card, with the modes
"hide all, guess one" and "hide one, guess one". Masks stay aligned at every size.

**Independent Test**: Create an Image Occlusion note with 3 masks in hide-all mode: 3 cards
exist, and each covers all masks with its target distinct, then reveals only the target.
Delete one mask: after a warning, only that card is removed ([quickstart.md](./quickstart.md)
V9–V10).

### Tests for User Story 4 (write first, must fail) ⚠️

- [ ] T078 [P] [US4] Occlusion slot tests in `packages/domain/tests/occlusion.test.ts`:
  - `listCardSlots` for an `image_occlusion` kind returns one ordinal per mask `n`;
  - `{{occlusion:Image}}` emits an `occlusion` slot and `answer = { kind: 'occlusion', image, mode, masks, target: n }`;
  - mask validation: "`n` is unique within the note", "`w, h > 0`, `x + w ≤ 1`, `y + h ≤ 1`";
  - `occlusion` used outside its kind is a `validateNoteType` error.
- [ ] T079 [P] [US4] API tests in `apps/api/tests/integration/notes.test.ts`:
  - a note without an image or without masks returns 422 `occlusion_masks_required` (FR-054);
  - 3 masks make 3 adjacent cards;
  - deleting mask 2 with `confirmRemoval` soft-deletes only card `ordinal=2` and leaves the others' FSRS state unchanged;
  - a newly added mask gets `n = max(n ever used) + 1`, never reusing a soft-deleted `n`.
- [ ] T080 [P] [US4] `OcclusionView` tests in `apps/web/tests/components/occlusion-view.test.tsx`:
  - hide-all draws every mask with the target visually distinct; hide-one draws only the target;
  - the back removes the target and shows its label;
  - mask boxes use percentage positions, so they stay aligned when the container resizes (FR-053);
  - a failed image load shows a placeholder and falls back to the reveal flow (edge case).
- [ ] T081 [P] [US4] `OcclusionEditor` tests in `apps/web/tests/components/occlusion-editor.test.tsx`:
  - a pointer drag draws a rectangle or ellipse depending on the tool;
  - a mask can be moved and resized with handles and deleted with the Delete key;
  - keyboard: Tab focuses masks, arrows move, Shift+arrows resize;
  - a label can be set;
  - output coordinates are fractions in 0..1.
- [ ] T081a [P] [US4] Occlusion note-editor tests in `apps/web/tests/components/note-editor.test.tsx`: the OcclusionEditor mounts only for `kind === 'image_occlusion'`; create and patch send `extra.occlusion`; deleting a saved mask whose card is reviewed opens the removal dialog.
- [ ] T082 [P] [US4] E2E occlusion journey in `tests/e2e/image-occlusion.spec.ts` following [quickstart.md](./quickstart.md) V9–V10, at the mobile and desktop viewports.

### Implementation for User Story 4

- [ ] T083 [US4] Register the `occlusion` filter and the `image_occlusion` ordinals in `packages/domain/src/notes/template.ts` and `packages/domain/src/notes/slots.ts`, reading `extra.occlusion`. Add mask validation helpers. Makes T078 pass.
- [ ] T084 [US4] Add the `image_occlusion` built-in ("Image Occlusion", kind `image_occlusion`, fields Image, Header and Back Extra, front `{{Header}}{{occlusion:Image}}`, back `{{Header}}{{occlusion:Image}}<br>{{Back Extra}}`) to `packages/domain/src/notes/defaults.ts`.
- [ ] T085 [US4] Accept and validate `note.extra` in `apps/api/src/services/notes.ts`:
  - enforce "Occlusion note needs an image and ≥ 1 mask; masks within 0..1" → 422 `occlusion_masks_required`;
  - assign the `n` of new masks as max over all the note's cards, live or soft-deleted, plus 1.

  Makes T079 pass.
- [ ] T086 [P] [US4] Create `apps/web/src/components/answer/OcclusionView.tsx`: a relatively positioned image box with absolutely positioned divs at percentage coordinates (ellipse via `border-radius: 50%`), styles for hide-all and hide-one, and the target highlight and label. No SVG (R9). Register it for slot kind `occlusion`. In `session-machine.ts`, occlusion cards use `reveal()` with no suggested grade. Makes T080 pass.
- [ ] T087 [P] [US4] Create `apps/web/src/components/editor/OcclusionEditor.tsx`: an image picker (reusing `MediaPicker`), rect and ellipse tools, pointer-event drawing, move and resize handles, keyboard access, mask labels and a mode selector. It outputs `NoteExtra.occlusion`. Makes T081 pass.
- [ ] T088 [US4] Mount `OcclusionEditor` for `kind === 'image_occlusion'` in `apps/web/src/components/editor/NoteEditor.tsx`, send `extra` on create and patch through `apps/web/src/client/content.ts`, and reuse the T036 removal warning when masks are deleted. Makes T081a pass.
- [X] T089 [P] [US4] Add the i18n keys (`occlusion.rect`, `occlusion.ellipse`, `occlusion.modeHideAll`, `occlusion.modeHideOne`, `occlusion.label`, `occlusion.deleteMask`, `occlusion.imageMissing`, `noteTypes.builtin.imageOcclusion`) to `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/vi.json`.

**Checkpoint**: US4 works on its own. T082 passes.

---

## Phase 7: User Story 5 - Smaller template features (Priority: P3)

**Goal**: Add `{{tts lang:Field}}`, `{{furigana:}}`/`{{kana:}}`/`{{kanji:}}` and KaTeX math.
`{{hint:}}` already shipped with US1.

**Independent Test**: For each feature, one note with that syntax renders as specified
([quickstart.md](./quickstart.md) V11).

### Tests for User Story 5 (write first, must fail) ⚠️

- [ ] T090 [P] [US5] Furigana tests in `packages/domain/tests/furigana.test.ts`: ` 日本[にほん]語` → `<ruby>日本<rt>にほん</rt></ruby>語` through `{{furigana:}}`; `{{kana:}}` gives the readings only and `{{kanji:}}` the bases only; base boundaries at spaces and segment starts; HTML tags are left intact (R12).
- [ ] T091 [P] [US5] TTS filter tests in `packages/domain/tests/template-filters.test.ts`: `{{tts en_US:Front}}` emits a `tts` slot `{ lang: 'en-US', text }`, Anki's `en_US` is normalized to BCP 47, and a missing language is a validation error.
- [ ] T092 [P] [US5] `TtsSlot` tests in `apps/web/tests/components/tts.test.tsx` with a mocked `speechSynthesis`: it picks an exact voice, then a language-only one; when no voice matches it is disabled with a tooltip; it re-evaluates on `voiceschanged`.
- [ ] T093 [P] [US5] Math tests in `apps/web/tests/components/card-html.test.tsx` (KaTeX mocked or real): `\(x^2\)` and `\[…\]` in text nodes render as KaTeX markup inside the shadow root; invalid math stays as source text; cards without delimiters do not load KaTeX (FR-062). Also assert that the PWA precache config in `apps/web/vite.config.ts` (workbox `globPatterns` or the built manifest) includes the KaTeX font files, for offline use.

### Implementation for User Story 5

- [ ] T094 [US5] Implement `furigana(html)`, `kana(html)` and `kanji(html)` in `packages/domain/src/notes/furigana.ts`, and register the filters in `packages/domain/src/notes/template.ts`. Makes T090 pass.
- [ ] T095 [US5] Register the `tts <lang>` filter in `packages/domain/src/notes/template.ts`, with language normalization (`en_US` → `en-US`). Makes T091 pass.
- [ ] T096 [P] [US5] Create `apps/web/src/components/answer/TtsSlot.tsx`, reusing `SpeakerBtn` with `speechSynthesis` and voice selection, and register it for slot kind `tts`. Makes T092 pass.
- [ ] T097 [US5] Add the `katex` dependency (pinned exact) to `apps/web/package.json`. In `apps/web/src/components/card/CardHtml.tsx`, post-process text nodes after sanitization: lazy `import('katex')` only when `\(` or `\[` is present, then `renderToString(src, { throwOnError: false, trust: false, output: 'htmlAndMathml', displayMode })`, and inject the KaTeX CSS into the shadow root. Precache the KaTeX fonts in the PWA config in `apps/web/vite.config.ts` for offline use (R13). Makes T093 pass.
- [X] T098 [P] [US5] Add the i18n keys (`tts.play`, `tts.noVoice`) to `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/vi.json`.

**Checkpoint**: all stories work on their own.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T099 [P] Add axe checks for the type-in, choice, occlusion (view and editor), hint and tts widgets in both themes to `tests/e2e/a11y.spec.ts` (FR-014, WCAG 2.2 AA).
- [ ] T100 [P] Add an offline journey to `tests/e2e/offline-interactive.spec.ts` (new): go offline, study one cloze, one type-in, one multiple-choice practice and one occlusion card, go back online, and assert every review syncs (SC-005, quickstart V12).
- [ ] T101 [P] Add an export round-trip e2e to `tests/e2e/export-roundtrip.spec.ts` (new): a deck containing every new type, exported and restored into a fresh account, gives the same card count and the same study behaviour (SC-004, quickstart V13).
- [ ] T102 [P] Add a short note on export v2 that links to `specs/002-interactive-card-types/contracts/export-format-v2.md` in `specs/001-fsrs-gamified-learning/contracts/export-format.md`.
- [ ] T103 Measure next-card latency on interactive cards with the e2e mobile profile (CPU throttled) in `tests/e2e/perf-interactive.spec.ts` (new). Assert ≤ 100 ms at p95 (SC-006).
- [ ] T104 Run the full [quickstart.md](./quickstart.md) V1–V14 manually, then `pnpm verify`, and fix any regressions. Self-review against constitution Principles I and II before merge.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** has no dependencies.
- **Foundational (Phase 2)** depends on Setup and blocks every story. Inside it:
  - T016 → T017 → T019 (the template chain), with T018 and T020 in parallel;
  - T021 → T022 → T023 (the schema), then T024 → T025 → T026 (the contract);
  - T027 and T028 depend on T019, T022 and T024; T029 depends on T021 and T028; T030 depends on T019 and T024;
  - web: T031 → T032 → T034; T033 depends on T016; T036 depends on T019 and T026.
- **US1 (Phase 3)** depends on Phase 2.
- **US2 (Phase 4)** depends on Phase 2. T057 (`type:cloze`) also needs T044 from US1. Plain `{{type:Field}}` does not.
- **US3 (Phase 5)** depends on Phase 2 only.
- **US4 (Phase 6)** depends on Phase 2. It reuses the ordinal and removal flow (T028 and T036), not US1 code.
- **US5 (Phase 7)** depends on Phase 2 only.
- **Polish (Phase 8)** depends on every story it covers.

### Within Each User Story

Tests come first (they must fail). Then domain → API → web widgets → editor → i18n. Commit after
each task or logical group.

### Parallel Opportunities

- Phase 2 tests T004–T015d are all [P] (different files, except T015c and the US-phase editor tests, which share `note-editor.test.tsx` / `note-types.test.tsx`).
- After Phase 2, US1, US3, US4 and US5 can proceed in parallel. US2 can too, except T057's
  `type:cloze` part.
- Inside a story, the [P] widget, i18n and test tasks run together.
- **Shared files need care**. Do not edit these concurrently; sequence the tasks or merge
  carefully:
  - `packages/domain/src/notes/template.ts` (T045, T057, T070, T083, T094, T095);
  - `packages/domain/src/notes/defaults.ts` (T046, T058, T071, T084);
  - `apps/api/src/services/notes.ts` (T047, T072, T085);
  - the i18n JSON files.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "T038 Cloze scanner tests in packages/domain/tests/cloze.test.ts"
Task: "T039 Cloze render tests in packages/domain/tests/cloze-render.test.ts"
Task: "T041 API cloze integration tests in apps/api/tests/integration/notes.test.ts"
Task: "T042 Editor cloze tests in apps/web/tests/components/note-editor.test.tsx"
Task: "T043 E2E cloze journey in tests/e2e/cloze.spec.ts"

# Then, in parallel where the files differ:
Task: "T050 Cloze-number preview in NoteTypeEditorPage.tsx"
Task: "T051 i18n keys for cloze"
```

## Parallel Example: User Story 3

```bash
Task: "T063 buildChoices tests"   Task: "T066 Distractor pool tests"   Task: "T067 ChoiceSlot tests"
Task: "T074 ChoiceSlot.tsx"       Task: "T075 DeckSettingsDialog toggle" Task: "T077 i18n keys"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 (Setup), then Phase 2 (Foundational): `pnpm verify` is green and Basic cards are unchanged.
2. Phase 3 (US1 Cloze and hint): validate with quickstart V1–V3 and T043.
3. **Stop and validate**: a demoable MVP.

### Incremental Delivery

1. Foundation → US1 (Cloze): MVP.
2. US2 (type-in) adds the answering step and suggested grades.
3. US3 (multiple choice and deck practice) adds the Duolingo feel to existing decks.
4. US4 (image occlusion).
5. US5 (tts, furigana, math).
6. Polish: a11y, offline, round trip, performance.

Each increment ships without breaking the earlier ones (each checkpoint runs `pnpm verify`).

### Delegation hint (per the project's delegation rule)

- **Sonnet** (judgement-heavy):
  - Phase 2: T017, T019, T028, T030, T032, T033;
  - the cloze scanner (T044), `compareTyped` (T056), `OcclusionEditor` (T087) and KaTeX (T097).
- **Haiku** (mechanical):
  - built-in defaults (T046, T058, T071, T084);
  - i18n tasks;
  - mapper and contract field additions (T024, T025, T027);
  - the toggles (T035, T075).

---

## Notes

- [P] tasks touch different files and have no dependency on an incomplete task.
- Every [Story] task traces to spec.md user stories, FRs and SCs.
- Verify that each test fails before implementing (constitution II).
- Never change the scheduler or the review event shape (constitution I, FR-010).
