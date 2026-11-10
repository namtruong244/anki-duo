# Feature Specification: Interactive Card Types

**Feature Branch**: `002-interactive-card-types`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "002-interactive-card-types: Interactive card types for anki-duo
(greenfield app, breaking changes allowed). Add Anki-style card types that the app lacks: (1) Cloze
deletion — {{cloze:Field}} with {{cN::answer::hint}}, one card per cN ordinal, nested clozes,
default "Cloze" note type (Text, Back Extra), editor button/shortcut Ctrl+Shift+C; plus
{{hint:Field}} filter. (2) Type in the answer — {{type:Field}} and {{type:cloze:Field}}, normalized
comparison (trim, NFC, optional case/diacritic-insensitive), Anki-style per-character diff on the
back, default "Basic (type in the answer)" note type. (3) Multiple choice — native note type
(Question, Correct, Distractors one per line, Explanation), options shuffled at display, optional
auto-distractors from other notes in the same deck, large Duolingo-style buttons with 1–4
shortcuts. (4) Image Occlusion — draw rectangle/ellipse masks over an image in the editor, one card
per mask, modes "hide all, guess one" and "hide one, guess one". (5) Extras (lower priority):
{{tts lang:Field}} via Web Speech, {{furigana:}}/{{kana:}}/{{kanji:}} filters, KaTeX math \( \)
\[ \], .apkg import. Design constraints: keep the HTML sanitizer strict (no JS, no input/svg in
template HTML); interactive parts are rendered by React into slots using a structured per-card
interaction spec stored with the card; one template may produce many cards (ordinal-based
templateId), editing a note reconciles cards per ordinal (removing cN soft-deletes that card,
editor warns); study session gains an "answering" step before reveal — answer result suggests a
grade (wrong → Again, right → Good, fast right → Easy) that the learner confirms, with a setting to
auto-grade; keyboard shortcuts must not fire while typing; FSRS scheduling unchanged; offline
sync and export/import must carry the interaction data; path position/nodeIndex assigned
contiguously for multi-card notes; i18n en/vi. Phases: P0 foundation, P1 cloze+hint, P2 type-in,
P3 multiple choice, P4 image occlusion, P5 extras."

## Context

Today every card in Anki Duo is studied the same way: the learner looks at the front, reveals the
back, and grades themselves Again/Hard/Good/Easy. Notes can only use the three "Basic" note types,
and card templates only substitute fields and show/hide sections. This feature adds the
Anki-style card types learners expect (cloze deletion, type-in answers, image occlusion), a native
multiple-choice type that fits the Duolingo-style experience, and a handful of smaller template
features. The app is pre-release, so existing data formats may change without migration of user
data in the wild.

**Out of scope**: importing Anki .apkg packages (planned as a separate feature).

## Clarifications

### Session 2026-11-10

- Q: Is Anki .apkg import part of this feature or a separate one? → A: Separate feature; removed
  from this spec.
- Q: How are small typos in typed answers handled? → A: "Almost correct" (edit distance 1 for
  answers of 5–11 characters, ≤ 2 for 12+ characters, after normalization) suggests Hard.
- Q: Can existing Basic cards be studied as multiple choice? → A: Yes, via a per-deck
  "multiple-choice practice" option (default off) that also covers auto-filling wrong answers for
  Multiple choice notes.
- Q: Should a fast correct answer suggest Easy? → A: No; a correct answer always suggests Good,
  and Easy is only chosen by the learner. Answer time is not used for suggestions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Study a cloze-deletion note (Priority: P1)

A learner writes a sentence such as "The capital of {{c1::France}} is {{c2::Paris::city}}." in a
note of the "Cloze" type. The app creates one card per cloze number. When studying card 2, the
front shows "The capital of France is [city]." and the back reveals "Paris" highlighted in place,
followed by any "Back Extra" notes. While editing, the learner can select text and press a button
(or Ctrl+Shift+C) to wrap it as the next cloze number, and the editor shows how many cards the note
will produce.

**Why this priority**: Cloze deletion is the most used Anki note type after Basic and is the
foundation the other interactive types build on (one note → many cards, per-card hidden content).
On its own it delivers a large share of the value of this feature.

**Independent Test**: Create a Cloze note with c1 and c2, confirm two cards appear in the deck,
study each and confirm the correct part is hidden on the front and revealed on the back.

**Acceptance Scenarios**:

1. **Given** a Cloze note with text containing `{{c1::A}}` and `{{c2::B}}`, **When** it is saved,
   **Then** exactly two cards exist for that note, one per cloze number.
2. **Given** card c2 of that note, **When** its front is shown, **Then** B is replaced by `[...]`
   (or by its hint if one was written), and A is shown as plain text.
3. **Given** card c2 is revealed, **When** the back is shown, **Then** B is visibly highlighted in
   its original position and the "Back Extra" field is shown below.
4. **Given** the same cloze number appears several times in a note, **When** that card is
   studied, **Then** all occurrences of that number are hidden together on one card.
5. **Given** a note with c1, c2 and c3, **When** the learner removes c3 and saves, **Then** the
   editor first warns that one card and its review history will be removed, and after
   confirmation the c3 card no longer appears in study while c1 and c2 keep their history.
6. **Given** a note with c1 and c2, **When** the learner adds c3, **Then** one new card is created
   and c1/c2 keep their scheduling state.
7. **Given** the editor with text selected, **When** the learner presses Ctrl+Shift+C or the cloze
   button, **Then** the selection is wrapped as the next unused cloze number.
8. **Given** a cloze nested inside another (e.g. `{{c1::capital of {{c2::France}}}}`), **When**
   card c1 is studied, **Then** the whole outer span is hidden; when card c2 is studied, only
   "France" is hidden.
9. **Given** a Cloze note whose text contains no cloze markers, **When** the learner tries to
   save, **Then** saving is blocked with a message explaining that at least one cloze is needed.

---

### User Story 2 - Answer by typing (Priority: P1)

A learner studies a card from a "Basic (type in the answer)" note, or a cloze card whose template
asks for typed input. The front shows an input box. The learner types their answer and presses
Enter. The back then shows their answer compared with the correct one, character by character:
matching characters, wrong characters and missing characters are visually distinct. The app
suggests a grade based on the result, which the learner confirms or changes.

**Why this priority**: Active recall by typing is substantially stronger than passive reveal, is
core Anki functionality, and introduces the "answering step" that multiple choice and image
occlusion reuse.

**Independent Test**: Create a type-in note "dog → chó", study it, type "cho", and confirm the back
shows a diff marking the missing diacritic and a suggested grade of Again (or Good if
diacritic-insensitive comparison is turned on).

**Acceptance Scenarios**:

1. **Given** a type-in card, **When** the front is shown, **Then** an input box is focused and
   ready for typing.
2. **Given** the learner is typing, **When** they press keys that are also grading or navigation
   shortcuts (1–4, Space), **Then** those shortcuts do not fire.
3. **Given** the learner presses Enter, **When** the back is shown, **Then** their answer and the
   expected answer are shown with a per-character comparison.
4. **Given** the typed answer differs from the expected answer only by surrounding whitespace or
   Unicode normalization form, **When** compared, **Then** it counts as correct.
5. **Given** the note type's comparison options "ignore case" and/or "ignore diacritics" are on,
   **When** the answer differs only in case and/or diacritics, **Then** it counts as correct.
6. **Given** a correct answer, **When** the back is shown, **Then** Good is pre-selected as the
   suggested grade, an almost-correct answer
   pre-selects Hard, and an incorrect answer pre-selects Again; the learner can still pick any
   grade.
7. **Given** a cloze note whose template uses typed input, **When** a card is studied, **Then** one
   input appears in place of the hidden text and is compared against that cloze's answer.
8. **Given** the learner submits an empty answer, **When** the back is shown, **Then** it is
   treated as incorrect and the expected answer is shown in full.

---

### User Story 3 - Answer a multiple-choice question (Priority: P2)

A learner creates a "Multiple choice" note with a question, one correct answer, several wrong
answers (one per line) and an optional explanation. During study, the question appears with large
answer buttons in a random order. The learner taps one (or presses 1–4). The chosen button turns
green or red, the correct one is highlighted, the explanation is shown, and a grade is suggested.

A deck can also turn on "multiple-choice practice" so its existing Basic cards are studied this
way, with wrong options taken from other cards' answers in the same deck.

**Why this priority**: Multiple choice is the signature Duolingo interaction and makes the app
feel like a game, but it is not part of core Anki, so it follows the Anki-compatible types.

**Independent Test**: Create a Multiple choice note with 1 correct and 3 wrong answers, study it
several times, confirm the order changes, pick a wrong answer and confirm the feedback and
suggested grade.

**Acceptance Scenarios**:

1. **Given** a Multiple choice note with 1 correct and N wrong answers, **When** the card is
   shown, **Then** min(N, 7) wrong answers (sampled at random each showing when N > 7) appear
   with the correct one as large tappable buttons, in an order that is not fixed between showings.
2. **Given** at most 4 options, **When** the learner presses 1–4, **Then** the matching option is
   chosen; options beyond 4 are reachable by tab/arrow keys and touch.
3. **Given** the learner picks an option, **When** feedback is shown, **Then** the chosen option is
   marked correct or incorrect, the correct option is always highlighted, and the explanation (if
   any) is revealed.
4. **Given** a correct pick, **Then** Good is suggested; a wrong pick suggests
   Again.
5. **Given** a note with no wrong answers written and "multiple-choice practice" turned on for the
   deck, **When** the card is shown, **Then** up to 3 wrong answers are drawn from the answers of
   other cards in the same deck; if none are available, the card is shown as a normal reveal card
   instead.
6. **Given** a note with no wrong answers and multiple-choice practice off, **When** the learner
   saves, **Then** saving is blocked with a message asking for at least one wrong answer.
7. **Given** a deck of Basic cards with "multiple-choice practice" on, **When** a Basic card is
   studied, **Then** its front is shown with 4 options: its own answer and 3 answers from other
   cards of the same template in the deck, and it behaves like a Multiple choice card.
8. **Given** multiple-choice practice is on but the card's answer is longer than 80 characters,
   has no text (image or audio only), or fewer than 1 other distinct answer exists in the deck,
   **When** the card is studied, **Then** it is shown as a normal reveal card.
9. **Given** duplicate options (same text after normalization), **When** shown, **Then** duplicates
   appear only once.

---

### User Story 4 - Study image occlusion cards (Priority: P2)

A learner adds an image (e.g. an anatomy diagram) to an "Image Occlusion" note and draws rectangles
or ellipses over the labels they want to learn. Each shape becomes a card. They choose between
"hide all, guess one" (every shape is covered, the target is highlighted) and "hide one, guess one"
(only the target is covered). During study the target shape is covered on the front and uncovered
on the back.

**Why this priority**: High value for visual subjects (medicine, geography, diagrams) and a native
Anki feature, but it needs a new drawing editor and depends on the one-note-many-cards mechanism
from Story 1.

**Independent Test**: Create an Image Occlusion note with three masks in "hide all" mode, confirm
three cards exist, and that each card covers all three shapes on the front with its own target
distinct, then reveals only its target on the back.

**Acceptance Scenarios**:

1. **Given** an image in the editor, **When** the learner drags on it, **Then** a rectangle (or
   ellipse, by tool choice) mask is drawn; masks can be moved, resized and deleted.
2. **Given** a note with K masks, **When** it is saved, **Then** exactly K cards exist.
3. **Given** "hide all, guess one" mode, **When** card k is shown, **Then** all masks cover the
   image and mask k is visually distinct; on the back only mask k is removed.
4. **Given** "hide one, guess one" mode, **When** card k is shown, **Then** only mask k covers
   the image; on the back it is removed.
5. **Given** the learner deletes one mask from a saved note, **When** saving, **Then** the editor
   warns and, after confirmation, only that mask's card is removed.
6. **Given** the image is shown on a small or large screen, **When** it scales, **Then** masks stay
   aligned with the same image regions.
7. **Given** a mask can optionally carry a label, **When** the back is shown, **Then** the label is
   displayed near the uncovered region.

---

### User Story 5 - Smaller template features (Priority: P3)

A learner or deck author can use additional template features from Anki:

- `{{hint:Field}}` shows a "Show hint" control that reveals the field on demand.
- `{{tts xx_YY:Field}}` adds a speaker button that reads the field aloud in that language.
- `{{furigana:Field}}`, `{{kana:Field}}`, `{{kanji:Field}}` render Japanese reading annotations
  written as `漢字[かんじ]`.
- Math written between `\( \)` (inline) or `\[ \]` (block) is typeset.

**Why this priority**: Each is useful but independent and smaller; they can ship incrementally
after the core types. `{{hint:}}` is expected to ship with Story 1.

**Independent Test**: Each feature can be tested on its own with a single note using the
corresponding syntax.

**Acceptance Scenarios**:

1. **Given** a template with `{{hint:Notes}}` and a non-empty Notes field, **When** the card is
   shown, **Then** a "Show hint" control appears and reveals the content when activated; if the
   field is empty, nothing is shown.
2. **Given** `{{tts en_US:Front}}`, **When** the speaker is activated, **Then** the field's text is
   read aloud in that language; if the device has no voice for it, the button is shown disabled
   with an explanation.
3. **Given** a field `日本[にほん]`, **When** rendered with `{{furigana:}}`, **Then** the reading
   appears above the kanji; `{{kana:}}` shows only the reading and `{{kanji:}}` only the kanji.
4. **Given** text `\(x^2\)`, **When** the card is shown, **Then** it is displayed as typeset math;
   invalid math is shown as its source text instead of breaking the card.

---

### Edge Cases

- A cloze number is skipped (c1, c3 but no c2): only cards c1 and c3 are created.
- Cloze numbers above 1: no hard limit on the number itself; a single note produces at most 100
  cards, beyond which saving is blocked with an explanation.
- Unbalanced or malformed cloze markers (`{{c1::abc`): treated as literal text; the editor shows a
  warning.
- A cloze answer containing formatting (bold, images, audio): formatting is preserved on the back;
  type-in comparison uses the plain text only.
- A type-in field whose expected answer is empty: the card is shown as a normal reveal card.
- More than one `{{type:}}` in a template: only the first is interactive; the rest are shown as
  plain text and the template editor warns.
- The learner undoes the last grade on an interactive card: the card returns to its unanswered
  front, with the previous input cleared.
- A card is studied offline: answering, feedback and grading work fully offline, and the result
  syncs later without loss.
- The note type of an existing note changes (e.g. Basic → Cloze): cards are reconciled to the new
  type; cards that no longer exist are removed with a warning.
- The image in an Image Occlusion note fails to load: a placeholder is shown, the masks are not
  shown, and the card falls back to a reveal-and-grade flow.
- A multiple-choice option text is very long: buttons wrap text and stay fully readable on mobile.
- Auto-grade is on and the learner answers wrongly: the grade is applied immediately but the
  feedback stays visible until the learner continues.
- A template author places interactive placeholders in the back template only: they are shown as
  the answer (non-interactive) and the template editor warns.
- Any script or event-handler code written into a field or template is never executed.

## Requirements *(mandatory)*

### Functional Requirements

**Foundation (one note → many cards, answering step)**

- **FR-001**: A note type MUST be able to produce more than one card from a single template, one
  per ordinal (cloze number or occlusion mask), in addition to the existing one-card-per-template
  behaviour.
- **FR-002**: When a note is saved, the system MUST reconcile its cards: create cards for new
  ordinals/templates, update content of existing ones while keeping their scheduling state and
  review history, and remove cards whose ordinal/template no longer exists.
- **FR-003**: Before a save that removes one or more cards with review history, the editor MUST
  warn the learner how many cards will be removed and require confirmation.
- **FR-004**: Cards created from one note MUST be placed next to each other in the deck's learning
  path, in ordinal order.
- **FR-005**: Each card MUST carry the information needed to run its interaction (expected typed
  answer and comparison options; multiple-choice options; occlusion image, masks, target and mode)
  so that it can be studied fully offline.
- **FR-006**: Type-in and multiple-choice cards MUST add an "answering" step before the reveal: the
  learner types or picks, then sees feedback and the back. Image occlusion cards use the normal
  reveal flow.
- **FR-007**: After a type-in or multiple-choice answer, the system MUST suggest a grade:
  incorrect → Again, almost correct (type-in only, see FR-035) → Hard, correct → Good. Easy is
  never suggested. The learner MUST be able to confirm or choose a different grade.
- **FR-008**: The learner MUST be able to turn on an "auto-grade" setting that applies the
  suggested grade without confirmation. It MUST be off by default.
- **FR-009**: Grade suggestions MUST depend only on the answer's correctness, never on how long
  the learner took to answer.
- **FR-010**: Grade suggestions MUST NOT change how the scheduling algorithm computes the next
  review; only the grade the learner (or auto-grade) submits is used.
- **FR-011**: Grading and navigation keyboard shortcuts MUST NOT fire while focus is in a text
  input.
- **FR-012**: Undoing a grade on an interactive card MUST return it to the unanswered state.
- **FR-013**: Field content and templates MUST NOT be able to run scripts or add their own form
  controls; all interactive controls MUST be provided by the app itself.
- **FR-014**: All interactive controls MUST be operable by keyboard and touch and meet WCAG 2.2
  AA colour contrast, including correct/incorrect feedback that does not rely on colour alone.
- **FR-015**: Card interaction data MUST be included in sync, offline storage, and the app's own
  export/import format, so a round-trip export → import reproduces the same cards.
- **FR-016**: Basic, Basic (and reversed), and Basic (optional reversed) cards MUST behave exactly
  as before.
- **FR-017**: All new user-facing text MUST be available in English and Vietnamese.

**Cloze (Story 1)**

- **FR-020**: The system MUST provide a default "Cloze" note type with fields "Text" and
  "Back Extra".
- **FR-021**: Templates MUST support a cloze placeholder on a field, recognising markers of the
  form `{{cN::answer}}` and `{{cN::answer::hint}}` where N is a positive integer.
- **FR-022**: For card N, the front MUST hide every occurrence of cN (showing the hint in brackets
  if given, otherwise `[...]`) and show all other cloze answers as plain text; the back MUST show
  cN's answers highlighted in place.
- **FR-023**: Nested clozes MUST be supported as described in Story 1, scenario 8.
- **FR-024**: A Cloze note with no valid cloze markers MUST NOT be saved.
- **FR-025**: The note editor MUST offer a button and the Ctrl+Shift+C shortcut (Cmd+Shift+C on
  macOS) that wraps the selection in the next unused cloze number, and Ctrl+Alt+Shift+C to reuse
  the current highest number.
- **FR-026**: The note editor MUST show how many cards the note will produce before saving.
- **FR-027**: Templates MUST support a hint placeholder that shows a "Show hint" control for a
  non-empty field and nothing for an empty one.

**Type-in answer (Story 2)**

- **FR-030**: The system MUST provide a default "Basic (type in the answer)" note type.
- **FR-031**: Templates MUST support a type-in placeholder on a field and on a cloze field
  (comparing against the current card's cloze answers; several answers for the same number are
  joined with ", ").
- **FR-032**: Comparison MUST ignore leading/trailing whitespace, collapse internal runs of
  whitespace, and treat Unicode-equivalent text as equal.
- **FR-033**: Each note type MUST have "ignore case" (default on) and "ignore diacritics" (default
  off) comparison options.
- **FR-034**: The back MUST show the typed answer and the expected answer with a per-character
  comparison that distinguishes correct, wrong and missing characters, without relying on colour
  alone.
- **FR-035**: A typed answer MUST count as "almost correct" when, after normalization, it differs
  from the expected answer by exactly 1 character edit (insert, delete or substitute) for expected
  answers of 5–11 characters, or by at most 2 edits for 12 characters or more. Answers shorter
  than 5 characters are only correct or incorrect. "Almost correct" is shown as such on the back.

**Multiple choice (Story 3)**

- **FR-040**: The system MUST provide a "Multiple choice" note type with fields "Question",
  "Correct", "Wrong answers" (one per line) and "Explanation".
- **FR-041**: Options MUST be shown in a random order each time the card is shown, de-duplicated
  after normalization, with at most 8 options. When more than 7 wrong answers exist, 7 are
  sampled at random for each showing; the correct answer is always included.
- **FR-042**: The first four options MUST be selectable with keys 1–4.
- **FR-043**: Feedback MUST mark the chosen option, always highlight the correct one, and reveal
  the explanation.
- **FR-044**: Decks MUST have a "multiple-choice practice" option (default off). When on:
  (a) Multiple choice notes without wrong answers get up to 3 wrong answers drawn from other
  cards' answers in the same deck; (b) cards from Basic-family note types are studied as multiple
  choice, with the card's answer (the field revealed on its back) as the correct option and up to
  3 distinct answers of other cards from the same template in the deck as wrong options.
- **FR-045**: A Multiple choice note with no wrong answers MUST NOT be saved unless
  multiple-choice practice is on for its deck.
- **FR-046**: A card MUST fall back to reveal-and-grade when generated options are not possible:
  its answer is longer than 80 characters, has no text, or no other distinct answer exists in the
  deck. Wrong options MUST be chosen from the deck's cards available offline.
- **FR-047**: Turning multiple-choice practice on or off MUST NOT change any card's scheduling
  state or review history.

**Image occlusion (Story 4)**

- **FR-050**: The system MUST provide an "Image Occlusion" note type with an image, masks, an
  optional header and an optional back extra.
- **FR-051**: The editor MUST let the learner draw, move, resize and delete rectangle and ellipse
  masks over the image, and give each mask an optional label.
- **FR-052**: Each mask MUST produce one card; the note-level mode MUST be "hide all, guess one"
  (default) or "hide one, guess one".
- **FR-053**: Masks MUST stay aligned with the image at every display size.
- **FR-054**: A saved Image Occlusion note MUST have an image and at least one mask.

**Extras (Story 5)**

- **FR-060**: Templates MUST support a text-to-speech placeholder with a language code, using the
  device's speech voices, with a disabled state when no voice exists.
- **FR-061**: Templates MUST support furigana, kana-only and kanji-only placeholders for text
  written as `base[reading]`.
- **FR-062**: Inline `\( \)` and block `\[ \]` math in fields MUST be typeset; invalid math MUST be
  shown as source text.

### Key Entities *(include if feature involves data)*

- **Note type**: Fields, card templates and styling, plus a kind (standard, cloze, image
  occlusion, multiple choice) and type-in comparison options. Determines how many cards a note
  produces.
- **Note**: Field values and tags for one fact. For image occlusion, also the image reference,
  mask list and mode.
- **Card**: One studyable item produced from a note by a template and, where relevant, an ordinal
  (cloze number or mask index). Keeps its own scheduling state and review history, the rendered
  front/back, and its interaction details (none, type-in, multiple choice, or occlusion).
- **Mask**: A shape (rectangle or ellipse) positioned relative to the image, with an optional
  label; one mask ↔ one card.
- **Deck**: Gains the "multiple-choice practice" option.
- **Study settings**: Gain the "auto-grade" option.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A learner can create a Cloze note with three clozes, using the editor button or
  shortcut, in under 1 minute, and the note produces exactly three cards.
- **SC-002**: Learners can answer a type-in or multiple-choice card using only the keyboard, with
  no grading shortcut ever triggered while typing.
- **SC-003**: After editing a note (adding or removing clozes or masks), 100% of the surviving
  cards keep their previous scheduling state and review history.
- **SC-004**: An export of a deck containing every new card type, re-imported into a fresh
  account, reproduces the same number of cards with identical study behaviour.
- **SC-005**: Interactive cards can be studied fully offline, and 100% of the resulting reviews
  sync once back online.
- **SC-006**: Moving from one interactive card to the next feels instant (under 100 ms perceived
  delay on a mid-range phone), matching existing basic cards.
- **SC-007**: In usability testing, at least 90% of learners correctly interpret the type-in
  comparison and multiple-choice feedback (what was wrong, what was right) without help.
- **SC-008**: No content in a field or template can cause scripts to run, verified by a test set
  of known script-injection payloads.

## Assumptions

- The app is pre-release: data formats, the export format version and stored cards may change
  without migrating existing user data. Development databases can be reset.
- The current scheduling algorithm (FSRS) is unchanged; this feature only changes how a grade is
  chosen, never how it is applied.
- Gamification rewards (XP, streaks) stay based on grades and completed reviews as today; no extra
  reward is given for correct interactive answers in this feature, to avoid encouraging dishonest
  grading.
- Multiple choice and image occlusion are graded the same way as other cards; image occlusion has
  no automatic answer check (the learner reveals and grades), so it suggests no grade.
- Text-to-speech depends on voices installed on the learner's device; no server-side speech is
  provided.
- Delivery order follows the priorities: foundation with Stories 1–2 first, then Stories 3–4,
  then Story 5 items independently.
- Technical design direction from the input (app-rendered interactive controls in place of
  template markup, a structured per-card interaction record, ordinal-based card identity) is
  carried into `/speckit-plan` rather than fixed in this specification.
