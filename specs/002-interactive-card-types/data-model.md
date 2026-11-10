# Data Model: Interactive Card Types (delta to 001)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

This is a delta to `specs/001-fsrs-gamified-learning/data-model.md`. Only new or changed columns
are listed; everything else is unchanged. Server schema lives in `apps/api/src/db/schema/`. The
change ships as migration `0005_interactive_cards.sql` (after `0004_note_types.sql`), which MUST
keep every `review_log` row (Principle II; tested per R16). Decisions are cited as R*.

## Entity changes

### note_type *(`schema/content.ts`)*

| Column | Type | Rules |
|---|---|---|
| kind | text not null default `'standard'` | check in `standard`, `cloze`, `image_occlusion`, `multiple_choice`. Decides how `listCardSlots` derives ordinals (R2) |
| options | jsonb not null default `'{}'` | `{ typeIgnoreCase?: boolean (default true), typeIgnoreDiacritics?: boolean (default false), roles?: { correct, wrong, explanation } }`. `roles` holds field ids and is required for `multiple_choice` (R8, R15) |
| builtin_key | text null | `basic`, `basic_reversed`, `basic_optional_reversed`, `cloze`, `basic_type`, `multiple_choice`, `image_occlusion`. Kept when the learner renames the type (R14) |

- Unique index `note_type_user_builtin_unique` on `(user_id, builtin_key)` where
  `deleted_at is null and builtin_key is not null`.
- Existing rows: `kind='standard'`, `options='{}'`. Rows whose name and templates match one of
  the three old built-ins get the matching `builtin_key` in the migration (best effort; unmatched
  rows stay null and are topped up with fresh built-ins).
- Seeding (`services/note-types.ts`) becomes a **top-up**: every list call inserts each missing
  `builtin_key` with `on conflict do nothing`.

### note *(`schema/content.ts`)*

| Column | Type | Rules |
|---|---|---|
| extra | jsonb null | Image occlusion only: `{ occlusion: { mode: 'hide_all' \| 'hide_one', masks: Mask[] } }`. Null for every other kind (R9) |

`Mask = { n: int ≥ 1, shape: 'rect' | 'ellipse', x, y, w, h: number in 0..1, label?: string }`

- `n` is stable: assigned as `max(n ever used in the note) + 1`, never reused, so deleting a mask
  removes only its card. "Ever used" includes masks of soft-deleted cards (ordinals are read from
  all cards of the note, live or not).
- `x`, `y`, `w`, `h` are fractions of the image's natural size; `w, h > 0`, `x + w ≤ 1`,
  `y + h ≤ 1`. `n` is unique within the note.
- `note` has no `change_seq` and is not synced; clients receive its effect through `card`
  (the interaction record carries the masks).

### card *(`schema/content.ts`)*

| Column | Type | Rules |
|---|---|---|
| ordinal | integer not null default 0 | ≥ 0. Standard and multiple-choice: 0. Cloze: the cloze number N (≥ 1). Occlusion: mask `n` (R2) |
| interaction | jsonb null | `Interaction` (below). Null for cards without interaction, including all legacy and Markdown cards |
| answer_text | text not null default `''` | Plain text answer (see R8). Distractor pool for deck MC practice (R8). Backfilled for pre-002 cards by `backfill-0005` (re-rendered once after migration 0005) |

**Identity**: unique index `card_note_ordinal_unique` on `(note_id, template_id, ordinal)` where
`deleted_at is null and note_id is not null`. It **replaces** `card_note_template_unique`
(`(note_id, template_id)`); existing rows have `ordinal=0`, so no data conflicts.

`interaction` type (verbatim from R4):

```ts
interface Interaction {
  v: 1;
  slots: Slot[];            // index N ↔ <span class="ad-slot" id="ad-slot-N"> in front/back
  answer: Answer | null;    // what the answering step checks
}
type Slot =
  | { kind: 'type' }
  | { kind: 'choice' }
  | { kind: 'occlusion' }
  | { kind: 'tts'; lang: string; text: string };
type Answer =
  | { kind: 'type'; expected: string; ignoreCase: boolean; ignoreDiacritics: boolean }
  | { kind: 'choice'; correct: string; wrong: string[]; explanationHtml: string }
  | { kind: 'occlusion'; image: string; mode: 'hide_all' | 'hide_one';
      masks: Mask[]; target: number };
```

Rules: server-produced only (`renderCard`), never accepted from clients (FR-013);
`answer.choice.wrong` keeps all wrong answers (no cap). `buildChoices` samples up to 7 per
showing, so at most 8 options (with the correct one) are shown.

**Card lifecycle** (FR-002, SC-003; R3):

| Transition | Trigger | Effect |
|---|---|---|
| created | Slot `(templateId, ordinal)` appears (new cloze number, new mask, new template, note created) | Row inserted as `new`; `position` reserved in ordinal order so siblings are adjacent (FR-004) |
| content-updated | Slot still exists after a note/note-type edit | Only `front`, `back`, `front_norm`, `interaction`, `answer_text`, `tags` change. FSRS columns and `review_log` untouched |
| soft-deleted | Slot vanished (cloze number removed, mask deleted, template removed, note type changed) | `deleted_at` set, content cleared as in 001; `review_log` rows retained. Requires `confirmRemoval` only if the card is reviewed (`reps > 0` or has a `review_log` row) (api-changes.md) |

A slot whose front renders empty (optional reversed) is **not** vanished and keeps its card (R3).
Re-adding a number later creates a new card (the old tombstone stays soft-deleted).

### deck

| Column | Type | Rules |
|---|---|---|
| mc_practice | boolean not null default false | FR-044. Toggling never touches card scheduling or `review_log` (FR-047) |

### learner_settings

| Column | Type | Rules |
|---|---|---|
| auto_grade | boolean not null default false | FR-008. Synced via the existing settings pull/patch |

## Built-in note types

`apps/api` seeds these from `packages/domain/src/notes/defaults.ts` (extended). Field ids are
`f_<snake_name>`; template ids `t_<n>` as for the existing built-ins.

| builtin_key | Name | kind | Fields | Templates (front / back) | options |
|---|---|---|---|---|---|
| basic, basic_reversed, basic_optional_reversed | unchanged from 001 (FR-016) | standard | Front, Back (+ Add Reverse) | unchanged | `{}` |
| cloze | Cloze | cloze | Text, Back Extra | `{{cloze:Text}}` / `{{cloze:Text}}<br>{{Back Extra}}` | `{}` |
| basic_type | Basic (type in the answer) | standard | Front, Back | `{{Front}}<br>{{type:Back}}` / `{{Front}}<hr id=answer>{{type:Back}}` | `{typeIgnoreCase:true, typeIgnoreDiacritics:false}` |
| multiple_choice | Multiple choice | multiple_choice | Question, Correct, Wrong answers, Explanation | `{{Question}}{{choice:Correct}}` / `{{Question}}{{choice:Correct}}<hr id=answer>{{Explanation}}` | `{roles:{correct:'f_correct', wrong:'f_wrong_answers', explanation:'f_explanation'}}` |
| image_occlusion | Image Occlusion | image_occlusion | Image, Header, Back Extra | `{{Header}}{{occlusion:Image}}` / `{{Header}}{{occlusion:Image}}<br>{{Back Extra}}` | `{}` |

## Validation rules

| Rule | FR | Error (422 unless noted) |
|---|---|---|
| Cloze note needs at least one valid `{{cN::…}}` in a field the front clozes | FR-024 | `cloze_required` |
| Note produces ≤ 100 cards | edge case | `too_many_cards` |
| Multiple-choice note needs ≥ 1 wrong answer unless the target deck has `mc_practice` | FR-045 | `wrong_answers_required` |
| Occlusion note needs an image and ≥ 1 mask; masks within 0..1 | FR-054, FR-053 | `occlusion_masks_required` |
| Save that removes reviewed cards (`reps > 0` or a `review_log` row) without `confirmRemoval: true` | FR-002/003 | 409 `cards_would_be_removed` |
| Unknown filter in a template | R1 | `validateNoteType` error list ([template-syntax.md](./contracts/template-syntax.md)) |
| Options: ≤ 8 shown, de-duplicated after normalization | FR-041 | `buildChoices` samples up to 7 wrong per showing; the record keeps all |
| Second `{{type:}}`, interactive tag only on back | edge cases | template warning, not an error |

Changing a note's type or a note type's templates runs the same reconciliation and the same
checks. Moving the deck of an `mc_practice`-dependent note re-validates `wrong_answers_required`.

## Domain functions *(pure TS, `packages/domain`; no I/O, no randomness, no clock)*

```ts
// notes/template.ts
listCardSlots(def: NoteTypeDef, fields: Fields, extra: NoteExtra | null): { templateId: string; ordinal: number }[]
renderCard(def: NoteTypeDef, fields: Fields, extra: NoteExtra | null, opts: { templateId: string; ordinal: number }):
  { front: string; back: string; frontEmpty: boolean; interaction: Interaction | null; answerText: string }
validateNoteType(def: NoteTypeDef): string[]                 // gains filter and cloze/mc/occlusion checks
renameFieldInTemplates(...)                                  // parses filter chains (R1)
// notes/cloze.ts
parseCloze(html: string): ClozeMatch[]                       // { n, answerHtml, hint?, start, end, children }
findClozeProblems(html: string): ClozeProblem[]
// notes/sanitize.ts
stripReservedAttrs(html: string): string                     // drops id/class tokens starting with "ad-"
// notes/furigana.ts
furigana(html: string): string; kana(html: string): string; kanji(html: string): string
// answer/compare.ts + answer/suggest.ts
compareTyped(expected: string, given: string, opts: { ignoreCase: boolean; ignoreDiacritics: boolean }):
  { verdict: 'correct' | 'almost' | 'wrong'; ops: DiffOp[] }  // DiffOp: equal | wrong | missing | extra
suggestGrade(verdict: 'correct' | 'almost' | 'wrong'): 1 | 2 | 3   // never 4 (FR-007)
// answer/choices.ts
buildChoices(a: { correct: string; wrong: string[]; pool: string[]; rng: () => number }): string[] | null
```

`rng` is a seeded PRNG supplied by the web layer. `buildChoices` returns null when fewer than 2
distinct options exist (reveal fallback, FR-046).

## Limits

| Limit | Value |
|---|---|
| Cards per note | 100 |
| Options per multiple-choice card | ≤ 8 (correct + ≤ 7 wrong) |
| Auto-generated distractors | up to 3, each non-empty, ≤ 80 chars, distinct after normalization |
| Cloze/occlusion number | positive integer, no upper bound besides the 100-card cap |

## Client store (Dexie, `apps/web/src/client/dexie-store.ts`)

- **Version**: bump to 3 for the type-level change only; `stores()` is unchanged because no new
  index is needed (`cards: 'id, [deckId+state+due], [deckId+nodeIndex], deckId'`). Deck-scoped
  distractor pools are read with the existing `deckId` index and filtered in memory.
- **Tables gaining fields** (stored as plain JSON from pull): `cards` (`ordinal`, `interaction`,
  `answerText`), `decks` (`mcPractice`), `settings` (`autoGrade`), `noteTypes` (`kind`,
  `options`, `builtinKey`).
- **Persisted session** (`StoredSession`) gains `answer?: { verdict: 'correct'|'almost'|'wrong'|null; given?: string; choiceIndex?: number; suggested: 1|2|3|null }`
  so a reload resumes on the feedback screen (R7). It is UI state; the verdict is never pushed.
- **SessionMachine status** becomes `'front' | 'answering' | 'back' | 'done' | 'empty'`.
  Transitions: `front` → `answering` only when the effective answer's `kind` is `'type'` or
  `'choice'` (effective MC cards included). `answering` → `back` via `submitAnswer(result)`;
  occlusion, `answer: null` and non-interactive cards use `reveal()` as before. `grade()` → next
  card. `undo()` → `answering` with `answer` cleared (FR-012). With
  `autoGrade`, `grade(suggested)` runs right after `submitAnswer` and the back stays until
  "Continue".
- **Outbox / review event**: unchanged (FR-010).
