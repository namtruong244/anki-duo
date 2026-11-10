# Research: Interactive Card Types

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-11-10

This builds on `specs/001-fsrs-gamified-learning/research.md`. That document's decisions still
hold. They are cited here as 001-R*, most often R6 (offline store and sync), R11 (Markdown),
R13 (export) and R19 (note types, sanitizer, Shadow DOM). The app is pre-release, so storage and
export formats may change without migrating user data. Migrations are still written and tested,
as the constitution requires (Principle II).

---

## R1. Template filters

- **Decision**:
  - Replace the template tokenizer's single `text:` special case with a **filter chain**. A tag
    `{{f1:f2 arg:Field}}` splits on `:`. The last segment is the field name and the segments
    before it are filters, applied right to left.
  - Supported filters: `text`, `cloze`, `type`, `hint`, `tts <lang>`, `furigana`, `kana`,
    `kanji`, `choice`, `occlusion`.
  - An unknown filter is a validation error in `validateNoteType` and renders an error span, like
    an unknown field today.
  - `checkTemplateSide` and `renameFieldInTemplates` work on the parsed field name, so renaming a
    field also rewrites `{{type:cloze:Old}}`.
- **Rationale**: Anki's syntax is a filter chain. A generic chain covers every filter in the spec
  with one parser and keeps Anki templates portable.
- **Alternatives considered**: separate regexes per filter (rejected: `text:`'s regex is already
  duplicated in `renameIn`, and combinations such as `type:cloze:` multiply the cases).

## R2. One template → many cards (ordinals)

- **Decision**:
  - `note_type` gains `kind`: `standard | cloze | image_occlusion | multiple_choice`.
  - `card` gains **`ordinal integer not null default 0`**. Card identity becomes
    `(note_id, template_id, ordinal)`, with the unique partial index updated to match.
    - Standard and multiple-choice templates always use ordinal 0.
    - Cloze uses the cloze number N.
    - Image occlusion uses the mask's stable number.
  - The pure domain function `listCardSlots(def, fields, extra)` returns
    `{ templateId, ordinal }[]`. For a cloze kind, the ordinals are every distinct `cN` found in
    fields that the template's front uses through a `cloze` filter.
  - `renderCard(…, { ordinal })` renders one card.
- **Rationale**: A separate integer column is queryable, sortable (path order, FR-004) and
  validated by the DB. Encoding it in the string (`t_cloze:c3`) would need parsing everywhere
  and is easy to get wrong.
- **Alternatives considered**: a composite `templateId` string (rejected, see above); one
  template row per cloze number (rejected: Anki's model has one template, and the template count
  would change with the content).

## R3. Reconciling cards on save, and removing them

- **Decision**:
  - `syncNoteCards` diffs the wanted `(templateId, ordinal)` set against the live cards.
  - **New** slots get cards. Placement is reserved in ordinal order, so they sit next to each
    other in the path (FR-004).
  - **Existing** slots update only their content columns.
  - **Vanished** slots, meaning a template or ordinal that no longer exists, are
    **soft-deleted**: `deleted_at` is set and review logs are kept, which keeps history lossless
    (constitution I).
  - The current rule that keeps a card whose front is now empty (for example, optional reversed)
    is unchanged. The template still exists, so the slot has not vanished.
  - Removal of **reviewed** cards (`reps > 0` or any `review_log` row) needs consent:
    `PATCH /notes/{noteId}` and `PATCH /note-types/{noteTypeId}` return **409
    `cards_would_be_removed`** with `{ count, cards: [{ id, templateId, ordinal, reps }] }` listing
    only reviewed vanished cards, unless the body has `confirmRemoval: true`. Unreviewed vanished
    cards are soft-deleted without confirmation.
  - The editor computes vanished slots with `listCardSlots` against `note.cards`, then looks up each
    vanished card's `reps` in the Dexie `cards` table to decide whether to warn first (FR-003).
    The 409 response is the server-side guarantee.
  - A note is capped at 100 cards (edge case). Saving above the cap fails with
    `too_many_cards`.
- **Rationale**: Soft-deleting rather than deleting satisfies FR-002 and keeps review history
  recoverable. A server-enforced confirmation stops a stale client from removing cards silently.
- **Alternatives considered**: keeping orphaned cards suspended (rejected: they would clutter
  the browser, and the spec says they are removed); hard-deleting (rejected by constitution I).

## R4. The per-card interaction record and slots

- **Decision**:
  - `card.interaction jsonb null` holds a versioned record produced by `renderCard` on the
    server and stored with the card:
    ```ts
    interface Interaction {
      v: 1;
      slots: Slot[];            // index N ↔ <span class="ad-slot" id="ad-slot-N"> in front/back
      answer: Answer | null;    // what the answering step checks
    }
    type Slot =
      | { kind: 'type' }                         // the input box (front) / diff (back)
      | { kind: 'choice' }                       // the option buttons
      | { kind: 'occlusion' }                    // the image with masks
      | { kind: 'tts'; lang: string; text: string };
    type Answer =
      | { kind: 'type'; expected: string; ignoreCase: boolean; ignoreDiacritics: boolean }
      | { kind: 'choice'; correct: string; wrong: string[]; explanationHtml: string }
      | { kind: 'occlusion'; image: string; mode: 'hide_all' | 'hide_one';
          masks: Mask[]; target: number };
    ```
  - Slots are emitted **after** field and template sanitization. Before rendering, the sanitizer
    strips any author-written `id` that starts with `ad-` and any `class` token that starts with
    `ad-`, so content cannot fake a slot (FR-013).
  - `CardHtml` already renders into an open shadow root. It finds `#ad-slot-N` and mounts the
    matching React widget with `createPortal`.
  - The record is plain data, so it syncs through the existing pull (001-R6), is stored in Dexie
    without an index change, and goes into the export (R13).
  - Only the first `type` slot of a card is interactive. Later ones render the expected text
    statically and the template validator warns (edge case).
- **Rationale**: This keeps the sanitizer strict (no form controls or scripts in stored HTML)
  while the app owns all interactive UI (FR-013). Storing the record means the client never
  re-runs template logic for study, which keeps offline study simple and identical across
  clients (a future Flutter client reads the same JSON; 001-R17).
- **Alternatives considered**:
  - `data-*` attributes on slots (rejected: the sanitizer drops `data-*`, and allowing them would
    widen the attack surface);
  - re-rendering templates on the client during study (rejected: it duplicates server work and
    every client would need the template engine).

## R5. Cloze parsing and rendering

- **Decision**:
  - A hand-written scanner in `packages/domain/src/notes/cloze.ts` reads sanitized field HTML. It
    finds `{{c<N>::` openers and matching `}}` with a depth counter (nesting, scenario 8), and
    skips text inside tags.
  - Each match has the shape `{ n, answerHtml, hint?, start, end, children }`.
  - Rendering for card N:
    - **Front**: each cN becomes `<span class="cloze">[hint]</span>` or `[...]`. With
      `type:cloze`, the first cN becomes a `type` slot and its answer becomes `expected`. Several
      cN are joined with `", "` (FR-031).
    - **Back**: each cN becomes `<span class="cloze">answer</span>`.
    - **Other numbers** render their answer as plain content, recursively.
  - Malformed markers stay literal text. The editor shows a warning from
    `findClozeProblems(html)`.
- **Rationale**: Field values are HTML, so a plain regex cannot balance nested markers. A small
  scanner is easy to test exhaustively, which Principle II requires.
- **Alternatives considered**: running a regex until nothing changes (rejected: wrong with
  nesting and with `}}` inside answers).

## R6. Comparing typed answers

- **Decision**:
  - The pure domain function `compareTyped(expected, given, opts)` returns
    `{ verdict: 'correct' | 'almost' | 'wrong', ops: DiffOp[] }`.
  - **Normalization**: `htmlToText`, NFC, trim, collapse whitespace. With `ignoreCase`, compare
    with `toLowerCase()`. With `ignoreDiacritics`, use NFD, remove `\p{M}`, and map `đ/Đ → d/D`
    (Vietnamese `đ` has no combining mark).
  - **Units**: grapheme clusters from `Intl.Segmenter`, so emoji and combined characters count
    as one character.
  - **Verdict**: equal → `correct`. Levenshtein distance 1 with 5–11 expected graphemes, or ≤ 2
    with 12 or more → `almost` (FR-035). Anything else → `wrong`. An empty answer → `wrong`.
  - **Diff**: an LCS-based alignment over graphemes produces `equal | wrong | missing | extra`
    runs for the back (FR-034). Each run carries a text marker as well as colour, for example
    underline or strikethrough and a screen-reader label.
- **Rationale**: The inputs are small (one answer), so O(n·m) is fine. Two short pure functions
  avoid a new dependency and are fully testable.
- **Alternatives considered**: the `diff` and `fast-levenshtein` packages (rejected: a new
  dependency for about 60 lines, with no grapheme awareness).

## R7. Answering step, suggested grade and auto-grade

- **Decision**:
  - `SessionMachine` gains status **`answering`** only for cards whose effective answer's `kind`
    is `'type'` or `'choice'`. Effective multiple-choice cards (R8) count too. Occlusion answers,
    `answer: null`, and cards without an interaction use `reveal()` with no suggested grade.
  - `submitAnswer(result)` moves the card to `back`. It stores
    `{ verdict, given | choice, suggested }` in the persisted session, so a reload resumes on the
    feedback screen.
  - Image occlusion has no automatic check: `reveal()` goes straight to `back` and no grade is
    suggested.
  - `suggestGrade(verdict)` in domain: `wrong → Again`, `almost → Hard`, `correct → Good`. It
    never suggests Easy and never uses time (FR-009, clarification 4).
  - GradeBar pre-selects the suggestion with a visible ring, and the learner confirms with
    Space/Enter or picks another grade.
  - With **`learner_settings.auto_grade`** (default false), `grade(suggested)` is called right
    after the answer and the feedback stays on screen until "Continue" (edge case).
  - `undo()` restores the card to `answering` with the input cleared (FR-012).
  - GradeBar already ignores keys from INPUT, TEXTAREA and contentEditable (FR-011). The answer
    widgets stop Enter from bubbling into the reveal handler.
  - The review event is unchanged. The verdict is UI state only and is not sent to the server.
    Scheduling uses only the submitted grade (FR-010).
- **Rationale**: This keeps the scheduler and review history exactly as they are (constitution
  I). Suggestions are presentation only.
- **Alternatives considered**: storing the verdict on `review_log` (deferred: useful for
  analytics later, but it adds a contract change with no FR needing it).

## R8. Multiple choice: note type and deck practice mode

- **Decision**:
  - **Note type**: `kind = multiple_choice` with fields Question, Correct, Wrong answers and
    Explanation. `note_type.options.roles` maps `{ correct, wrong, explanation }` to field ids.
    The front template is `{{Question}}{{choice:Correct}}`. Wrong answers are split on line
    breaks (`<br>`, `<p>`, `\n`), trimmed, and de-duplicated after normalization (R6). All of them
    are kept; `buildChoices` samples up to 7 per showing, so at most 8 options are shown (FR-041).
  - **`card.answer_text text not null default ''`** is computed at render:
    - for multiple-choice cards, the Correct text;
    - for standard cards, the plain text of fields used on the back template but not on the
      front;
    - for Markdown cards, the back, as text.
    It is the distractor pool for the deck's multiple-choice practice.
  - **`deck.mc_practice boolean not null default false`** (FR-044).
  - **Client-side choice building**: the client, at session time and offline, uses the pure
    `buildChoices({ correct, wrong, pool, rng })` in domain, with `rng` injected (a seeded PRNG
    from the web layer, so domain stays free of randomness, constitution I).
    - Pool: Dexie cards in the same deck with the same `(noteTypeId, templateId)`. Markdown
      cards are grouped together. Answers must be non-empty, ≤ 80 characters, and different
      after normalization.
    - Up to 3 distractors are picked. With none available, `null` is returned and the card falls
      back to reveal (FR-046).
  - A multiple-choice note without wrong answers saves only when its deck has `mc_practice`
    (FR-045).
- **Rationale**: The practice mode works on existing decks without re-rendering cards. Building
  choices at study time reflects the deck's current content and works offline.
- **Alternatives considered**: storing generated distractors on the card (rejected: they go
  stale on every edit, and toggling the deck setting would need a re-render).

## R9. Image occlusion

- **Decision**:
  - `note.extra jsonb null` holds
    `{ occlusion: { mode, masks: [{ n, shape: 'rect' | 'ellipse', x, y, w, h, label? }] } }`.
    Coordinates are fractions (0–1) of the image's natural size, so they hold at any display
    size (FR-053).
  - `n` is a stable mask number that is never reused within a note, so deleting a mask removes
    only its card (scenario 5).
  - Note type fields: Image (one `<img>`), Header and Back Extra. The front template is
    `{{Header}}{{occlusion:Image}}`.
  - **Study**: an `OcclusionView` React component renders the image in a relatively positioned
    box, with absolutely positioned divs at percentage coordinates. An ellipse is a div with
    `border-radius: 50%`. No SVG is used, so the sanitizer stays strict.
  - **Editor**: `OcclusionEditor` uses pointer events (draw, move, resize handles, delete key,
    and a rect/ellipse tool). Keyboard access: tab between masks, arrows to move, shift+arrows
    to resize. No new dependency.
- **Rationale**: Normalized coordinates in note data keep cards responsive. Divs avoid widening
  the sanitizer (R4).
- **Alternatives considered**: storing a mask image (rejected: masks could not be edited), and
  `fabric.js` or `konva` (rejected: a large dependency for rectangles and ellipses).

## R10. `{{hint:}}`

- **Decision**: A non-empty field renders
  `<details class="ad-hint"><summary></summary>…</details>`, and an empty one renders nothing.
  `CardHtml` fills the empty summary with the localized "Show hint" text, because domain has no
  i18n. `details` and `summary` are already allowed by the sanitizer.
- **Rationale**: It works without JavaScript, is accessible by default, and needs no new slot
  kind.

## R11. `{{tts lang:Field}}`

- **Decision**:
  - Emit a `tts` slot (R4) with `lang` (BCP 47, accepting Anki's `en_US` form) and the field's
    text.
  - The widget is a `SpeakerBtn` that uses `speechSynthesis` with the best voice for `lang`
    (exact match, then language only).
  - Voices load asynchronously (`voiceschanged`). With no matching voice, the button is disabled
    and has a tooltip (scenario 2).
- **Rationale**: On-device speech costs nothing and works offline (spec assumption).

## R12. `{{furigana:}}`, `{{kana:}}`, `{{kanji:}}`

- **Decision**: Pure domain transforms on text nodes of sanitized HTML, using Anki's syntax:
  `base[reading]`, with a space or the start of a segment marking where the base begins.
  - `furigana` → `<ruby>base<rt>reading</rt></ruby>`, which the sanitizer allows;
  - `kana` → the reading;
  - `kanji` → the base.
- **Rationale**: This is a tiny, well-specified string transform with no dependency.

## R13. Math (KaTeX) and export format v2

- **Math decision**:
  - Add **`katex`** to `apps/web` only (a new runtime dependency, see Complexity Tracking).
  - `CardHtml` post-processing finds `\(…\)` and `\[…\]` in text nodes, after sanitization, and
    replaces them with `katex.renderToString(src, { throwOnError: false, trust: false,
    output: 'htmlAndMathml', displayMode })`.
  - KaTeX is loaded lazily, only for cards that contain the delimiters. Its CSS is injected into
    the shadow root and its fonts are precached by the service worker for offline use.
  - Invalid math falls back to the source text (scenario 4).
- **Math rationale**: KaTeX is the standard fast, synchronous renderer. It runs after the
  sanitizer on library-generated markup with `trust: false`, so authors cannot inject markup
  through it.
- **Math alternatives considered**: MathJax (rejected: much larger and asynchronous); rendering
  on the server into stored HTML (rejected: the sanitizer would strip the MathML and SVG).
- **Export decision**:
  - Bump `anki-duo-export` to **version 2**:
    - cards gain `ordinal`, `interaction` and `answerText`;
    - notes gain `extra`;
    - note types gain `kind` and `options`;
    - decks gain `mcPractice`.
  - Import accepts v1 and v2. For v1, missing fields get their defaults and `interaction` is
    recomputed from the note on import.
  - Import re-renders note cards on the server, so a stored `interaction` is never trusted from
    the file.
- **Export rationale**: Recomputing on import keeps the server authoritative and prevents
  hand-crafted files from injecting bad interaction data. A round trip still reproduces the same
  cards (SC-004).

## R14. Built-in note types for existing learners

- **Decision**:
  - `note_type` gains `builtin_key text null` (`basic`, `basic_reversed`,
    `basic_optional_reversed`, `cloze`, `basic_type`, `multiple_choice`, `image_occlusion`),
    with a unique index on `(user_id, builtin_key)` where not deleted.
  - Lazy seeding becomes a **top-up**: on each list call, every missing `builtin_key` is
    inserted with `onConflictDoNothing`.
  - A learner who renames a built-in type keeps its key.
- **Rationale**: Today seeding only happens when a learner has zero note types, so new built-ins
  would never reach existing accounts.

## R15. Note type options

- **Decision**: `note_type.options jsonb not null default '{}'` with
  `{ typeIgnoreCase?: boolean = true, typeIgnoreDiacritics?: boolean = false, roles?: {…} }`.
  The values are copied into `interaction.answer` at render time.
- **Rationale**: Comparison settings belong to the note type (FR-033), while study needs them per
  card offline.

## R16. Testing approach

- **Domain (unit, test-first)**: tokenizer and filter chain; `listCardSlots`; the cloze scanner,
  including nesting, malformed markers, repeated numbers and hints; `compareTyped` with a table
  of `[expected, given, opts, verdict]`, including Vietnamese diacritics and graphemes;
  `buildChoices` with a seeded rng; `suggestGrade`; furigana; sanitizer stripping of `ad-*`
  ids/classes; a script-injection payload set (SC-008).
- **API integration (PGlite)**:
  - reconciliation: adding or removing cN, the 409 removal flow, contiguous placement, the
    100-card cap, review logs kept after soft-delete;
  - built-in top-up;
  - export v2 round trip, and v1 import;
  - the migration test proves review logs survive the new migration.
- **Web (jsdom)**:
  - session machine `answering` → `back`, auto-grade, and undo back to answering;
  - `CardHtml` slot hydration;
  - type-in, choice and occlusion widgets;
  - the editor cloze command and its warning;
  - i18n coverage (vi/en).
- **E2E (Playwright)**: one journey per story (quickstart V-steps), axe checks on the new
  widgets.
