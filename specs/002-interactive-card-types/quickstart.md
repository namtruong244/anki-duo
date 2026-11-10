# Quickstart & Validation Guide: Interactive Card Types

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

How to prove each story and success criterion. Local setup, seed login, migrations and deploy are
the same as in `specs/001-fsrs-gamified-learning/quickstart.md`; this guide does not repeat them.
It refers to [data-model.md](./data-model.md) and [contracts/](./contracts/).

## Prerequisites

- 001 local dev running: `pnpm install`, `pnpm db:migrate` (applies `0005_interactive_cards`),
  `pnpm dev` (API :8787, web http://localhost:5173), signed in as the seed learner.
- Open "Note types": the built-ins Cloze, Basic (type in the answer), Multiple choice and Image
  Occlusion appear on first list, also for accounts created before this feature (R14).
- A browser with speech voices for V11; Chromium with DevTools for the offline steps.

## Automated checks

```bash
pnpm test:unit       # domain: filters, cloze, compareTyped, buildChoices, suggestGrade, furigana, sanitizer payloads
pnpm test:int        # API (PGlite): reconcile, 409 flow, 100 cap, top-up, export v2, migration keeps review logs; web jsdom
pnpm test:contract   # zod/openapi schemas and the new problem codes
pnpm test:i18n       # vi/en keys for all new text (FR-017)
pnpm test:e2e        # Playwright journeys V1-V14 with axe checks on new widgets
```

## Manual validation scenarios

**V1: Create and study cloze (US1, SC-001)**
1. New note, type Cloze. Enter `The {{c1::mitochondrion}} makes {{c2::ATP}}`. Use the editor
   button, then select another word and press Ctrl+Shift+C (Cmd+Shift+C on macOS).
2. Expected: the editor shows the card count (3 with three clozes) before saving; saving
   creates exactly 3 cards adjacent in the deck path, in order c1, c2, c3 (FR-004, FR-026).
3. Study c2: front hides only c2 as `[...]` and shows c1, c3 as text; back highlights c2. A
   `{{c1::x::hint}}` marker shows `[hint]`.

**V2: Remove a cloze with a warning (US1, FR-003, SC-003)**
1. Review card c3 once, then edit the note and delete `{{c3::…}}`.
2. Expected: a warning says 1 card will be removed and asks for confirmation; Cancel keeps all.
   Confirm: c3 disappears, c1 and c2 keep due date and history. Via API, the same PATCH without
   `confirmRemoval` returns 409 `cards_would_be_removed` with `{count, cards[]}`.
3. Save a cloze note with no marker: blocked with `cloze_required` (FR-024). 101 clozes:
   `too_many_cards`.

**V3: Nested cloze (FR-023)**
1. Text `{{c1::outer {{c2::inner}} end}}`.
2. Expected: card 1 hides the whole outer answer; card 2 hides only `inner` and shows the rest.
   Malformed `{{c1::abc` stays literal and the editor warns.

**V4: Type-in with diff and almost-correct (US2, FR-034, FR-035)**
1. Note type Basic (type in the answer): Front `Con voi in English`, Back `elephant`.
2. Type `elephnt` (one missing letter): expected "almost correct", diff marks the missing letter with a text marker, not
   only colour, and GradeBar pre-selects Hard (ring visible). Type `Elephant`: correct (ignore case is on), Good
   suggested. Type `xyz`: wrong, Again suggested. Answers under 5 characters are only
   correct/wrong. Easy is never pre-selected.
3. Type `g` while typing: no grade shortcut fires (FR-011).

**V5: Diacritics option (FR-033)**
1. Back `Việt Nam`. Default (ignore case on, ignore diacritics off): `viet nam` is not correct
   (differs by diacritics; at most almost). Enable "ignore diacritics" on the note type: `viet nam`
   is correct; `đường` equals `duong` too.

**V6: Auto-grade (FR-008)**
1. Settings → turn on auto-grade, answer a type-in card wrongly.
2. Expected: Again is applied immediately, feedback and diff stay until "Continue". Setting is off
   by default. Undo returns to the unanswered front with input cleared (FR-012).

**V7: Keyboard only (SC-002)**
1. Without a mouse: Tab to the answer box, type, Enter to submit, Space/Enter to confirm the
   suggested grade. For multiple choice, keys 1-4 pick the first four options.
2. Expected: Enter in the box submits the answer and never also reveals/grades twice; run axe on
   the widgets.

**V8: Multiple-choice note (US3, FR-040..FR-043, FR-045)**
1. Create a Multiple choice note with Correct and three Wrong answers (one per line).
2. Study: options appear shuffled on each display, de-duplicated; the chosen option is marked,
   the correct one always highlighted with a non-colour marker, then the Explanation shows.
3. Save with no wrong answers in a deck with practice off: `wrong_answers_required`.

**V9: Deck practice mode and fallback (FR-044..FR-047)**
1. On a Basic deck with at least 5 cards, turn on "multiple-choice practice".
2. Expected: Basic cards are studied as multiple choice with up to 3 distractors from other cards
   of the same template; an answer over 80 characters or a deck with no other distinct answer
   falls back to reveal-and-grade. Turning the option off/on changes no due date or history. A
   multiple-choice note without wrong answers now saves and gets generated distractors.

**V10: Image occlusion (US4, FR-050..FR-054)**
1. New Image Occlusion note: upload an image, draw 3 masks (rect and ellipse), move/resize one,
   delete one, label one. Try with keyboard (Tab between masks, arrows, Shift+arrows).
2. Expected: 2 cards remain; saving without image or masks gives `occlusion_masks_required`.
   Study in "hide all, guess one" (all masks shown, target highlighted) and "hide one, guess one".
   Back reveals the target. Resize the window and rotate the phone: masks stay aligned (FR-053).
   Delete a mask: only its card goes (stable `n`). Break the image URL: placeholder and reveal
   fallback.

**V11: Hint, TTS, furigana, math (US5)**
1. Template with `{{hint:Extra}}`, `{{tts en-US:Front}}`, `{{furigana:Reading}}` and a field
   containing ` 日本語[にほんご]`, `\(x^2\)`, and a broken `\(\frac{\)`.
2. Expected: hint control only for a non-empty field; speaker plays offline, disabled with a
   tooltip when no voice; ruby text shown (kana/kanji variants show readings/bases only); math is
   typeset, the broken math shows as source text.

**V12: Offline study then sync (SC-005, FR-015)**
1. Load the deck, go offline (DevTools). Study cloze, type-in, MC and occlusion cards, including
   a reload mid-feedback (the session resumes on the feedback screen).
2. Go online. Expected: all reviews sync with no loss; only grades were sent (no verdicts).

**V13: Export and import round trip (SC-004)**
1. Make a deck with every card type, review some, export (`*.anki-duo.json`, version 2).
2. Restore into a fresh account. Expected: same card count per note, same rendered content and
   studies identically; scheduling state verified by replay. Importing a v1 file still works.
3. Hand-edit `interaction` in the file (e.g. a bad `expected`): restore ignores it and recomputes.

**V14: Script injection (SC-008, FR-013)**
1. Put payloads in fields and templates: `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`,
   `<div id="ad-slot-0" class="ad-slot">`, `{{c1::<svg onload=alert(1)>}}`, `\(\href{javascript:alert(1)}{x}\)`.
2. Expected: no script runs, no author-written form controls or fake slots appear (the `ad-`
   id/class are stripped), math does not become a link. The unit payload set in `pnpm test:unit`
   passes.

## Regression

Existing Basic, Basic (and reversed) and Basic (optional reversed) notes behave exactly as before
(FR-016): one card per non-empty template, reveal-and-grade flow, `Space`/number grading.
