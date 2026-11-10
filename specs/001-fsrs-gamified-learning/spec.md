# Feature Specification: FSRS Gamified Learning App (MVP)

**Feature Branch**: `001-fsrs-gamified-learning`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Xây dựng web app học tập kết hợp thuật toán lặp lại ngắt quãng FSRS
(Free Spaced Repetition Scheduler) hiện đại và trải nghiệm UI gamified của Duolingo. FSRS dựa trên
Difficulty, Stability, Retrievability với 4 mức Again/Hard/Good/Easy; quản lý Deck và Flashcard
(Text, Markdown, Image, Audio); import CSV/TSV; nút 3D chunky, bo góc lớn, màu tươi sáng, âm thanh
và micro-animation; lộ trình dạng bản đồ chặng / skill tree; Daily Streak, XP, progress bar trong
phiên học; dashboard heatmap và progress ring/donut Due/Learning/New; tối ưu phiên học ngắn 5–10
phút, chuyển thẻ tức thì (optimistic updates), responsive mobile web và desktop. Out of scope MVP:
mạng xã hội/bảng xếp hạng, chợ chia sẻ/mua bán deck cộng đồng."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review cards in a short FSRS-scheduled session (Priority: P1)

A learner opens the app, starts a session from a deck and sees one card at a time. They reveal the
answer, grade their recall with one of four large buttons (Again, Hard, Good, Easy), and the next
card appears immediately. Each grade reschedules the card using FSRS, so cards they know well come
back later and cards they struggle with come back sooner. A session is sized to fit in 5–10
minutes, and a progress bar fills as they go.

**Why this priority**: Accurate spaced-repetition review is the reason the app exists. Without it,
gamification has nothing to reward. This story alone is a usable flashcard app.

**Independent Test**: Load a deck with sample cards, run a session to completion, and check that
every graded card received a new due date matching the FSRS reference output for that history and
grade.

**Acceptance Scenarios**:

1. **Given** a deck with 5 due cards and 10 new cards, **When** the learner starts a session,
   **Then** all due cards are queued before any new card, and new cards are limited by the daily
   new-card limit.
2. **Given** a card showing its front, **When** the learner reveals the answer, **Then** the back
   is shown with the four grade buttons, each labelled with the interval it would schedule
   (e.g. "Good · 3d").
3. **Given** the answer is revealed, **When** the learner taps a grade button or presses its
   keyboard shortcut (1–4), **Then** the next card appears without waiting for the save to finish.
4. **Given** the learner graded the previous card by mistake, **When** they choose Undo,
   **Then** the previous card returns and its scheduling state and any XP earned are reverted.
5. **Given** the session's last card is graded, **When** the session ends, **Then** a summary shows
   cards reviewed, accuracy, time spent and XP earned.
6. **Given** a learning card graded Again, **When** the session continues, **Then** the card is
   shown again later in the same session according to FSRS learning steps.

---

### User Story 2 - Create decks and cards, including CSV/TSV import (Priority: P1)

A learner creates a deck and adds cards by hand. Each card side can contain plain text or Markdown
and can include an image and an audio clip. To get started quickly, they import a CSV or TSV file,
map its columns to Front and Back, preview the result, and confirm.

**Why this priority**: Users can't review without content. It is P1 alongside Story 1 because
together they form the smallest useful product.

**Independent Test**: Import a 200-row TSV file into a new deck, check that the preview and final
card count match the file, then edit one card to add an image and audio and confirm both render.

**Acceptance Scenarios**:

1. **Given** the learner is on the decks screen, **When** they create a deck with a name,
   **Then** the deck appears with zero cards and can be renamed or deleted.
2. **Given** the card editor, **When** the learner enters Markdown (bold, lists, code, tables),
   **Then** a live preview shows the formatted result and the card renders the same way in review.
3. **Given** the card editor, **When** the learner attaches an image or audio file, **Then** it is
   shown/playable on the card, and audio has a replay control during review.
4. **Given** a CSV or TSV file, **When** the learner imports it, **Then** the delimiter and header
   row are detected automatically, the first rows are previewed, and the learner can map columns to
   Front, Back and Tags before confirming.
5. **Given** an import file with malformed or empty rows, **When** the import runs, **Then** valid
   rows are imported, invalid rows are skipped, and a report lists each skipped row with its reason.
6. **Given** an imported row whose Front matches an existing card in the same deck, **When** the
   import runs, **Then** the learner chooses to skip duplicates, update them, or import them anyway.
7. **Given** a deck, **When** the learner exports it, **Then** they receive a file containing all
   cards and their full review history in an open, documented format.

---

### User Story 3 - Duolingo-style learning path (skill tree) (Priority: P2)

Instead of a plain list of decks, the learner sees a winding path of round nodes. Each node is a
bite-sized lesson. Completed nodes are filled and show a crown or level, the current node bounces
gently to draw attention, and later nodes are locked until earlier ones are started. Tapping a node
starts a short session for it.

**Why this priority**: The path is the main visual difference from a plain flashcard app and gives a
sense of progress, but Stories 1–2 work without it.

**Independent Test**: Create a deck with 60 new cards, open its path, and check that nodes are
generated, the first node is playable, later nodes are locked, and finishing the first node
unlocks the next one with an animation.

**Acceptance Scenarios**:

1. **Given** a deck with cards, **When** the learner opens it, **Then** the deck is shown as a path
   of nodes, each holding the next 10 new cards in deck order (the last node may hold fewer).
2. **Given** cards are added to a deck later, **When** the path is shown, **Then** the new cards
   fill the last node up to 10 and further nodes are appended; existing nodes are not reshuffled.
3. **Given** a locked node, **When** the learner taps it, **Then** a message explains what to finish
   first and no session starts.
4. **Given** the learner has due reviews in any node, **When** they view the path, **Then** a
   "Review" entry point is clearly shown and is never locked.
5. **Given** the deck has 6 due cards, **When** the learner starts an available node, **Then** the
   session shows the 6 due cards first (most overdue first), then the node's 10 new cards.
6. **Given** the deck has 25 due cards, **When** the learner starts an available node, **Then** the
   session holds only the 10 most overdue due cards and no new cards, the node explains "Review
   the remaining due cards to unlock new cards", and the other 15 due cards remain in the "Review"
   entry point.
7. **Given** every card in a node has been studied at least once, **When** the learner returns to
   the path, **Then** the node is marked completed with an animation and the next node unlocks.
8. **Given** a completed node, **When** its cards reach the Review state over time, **Then** the
   node shows a mastery level (fraction of its cards in Review state) without blocking progress.

---

### User Story 4 - Streak, XP and in-session feedback (Priority: P2)

While reviewing, the learner gets immediate, playful feedback: buttons press down like physical
keys, each graded card triggers a short sound and animation, and the progress bar slides
forward. Each completed session earns XP. Reaching the day's goal keeps the daily streak alive, and
the streak flame is shown prominently on the home screen.

**Why this priority**: Motivation features increase daily return rate but depend on Story 1.

**Independent Test**: Complete one session on day 1 and day 2 (simulated clock), and check XP
totals, that the streak shows 2, and that skipping day 3 resets the streak to 0 on day 4.

**Acceptance Scenarios**:

1. **Given** a session in progress, **When** the learner grades a card, **Then** the progress bar
   advances with a smooth animation and XP for that card is added.
2. **Given** the learner's daily goal is 20 XP and they have 18 XP today, **When** they earn 2 more
   XP, **Then** a celebration screen shows the goal met and the streak increasing.
3. **Given** the learner met the goal yesterday but not yet today, **When** they open the app,
   **Then** the streak is shown as at risk, not broken.
4. **Given** a full local day passed without meeting the goal, **When** the learner opens the app,
   **Then** the streak resets to 0 and their longest streak is kept.
5. **Given** the learner reviews a card before it is due (e.g. using "study ahead"), **When** they
   grade it, **Then** no XP is awarded for that card.
6. **Given** sound effects are on, **When** the learner turns them off in settings or the device is
   muted, **Then** no sounds play; **Given** the device requests reduced motion, **Then**
   animations are minimised.

---

### User Story 5 - Progress dashboard (Priority: P3)

The learner opens a dashboard showing a calendar heatmap of how many reviews they did each day, a
donut/ring chart of their cards split into New, Learning, Due, Not due and Suspended, their current
and longest streak, and total XP.

**Why this priority**: Helpful for reflection, but not needed to learn or stay motivated day to day.

**Independent Test**: Seed 90 days of review history and check that heatmap cell intensities match
daily review counts and ring segments match card counts per state.

**Acceptance Scenarios**:

1. **Given** review history over several months, **When** the learner opens the dashboard,
   **Then** a heatmap shows the last 12 months with darker cells for more reviews, and tapping or
   hovering a cell shows the date and count.
2. **Given** cards in different states, **When** the dashboard loads, **Then** a ring chart shows
   New, Learning, Due, Not due and Suspended counts with labels and numbers, readable without
   relying on colour, and the segment counts add up to the total number of cards.
3. **Given** multiple decks, **When** the learner filters by deck, **Then** all dashboard figures
   update to that deck only.

---

### Edge Cases

- No cards are due and no new cards remain today: the session screen says so, shows when the next
  card is due, and offers optional "study ahead" (which awards no XP).
- The learner closes the tab or loses connectivity mid-session: every grade already given is kept,
  and the session can be resumed.
- A grade is saved optimistically but persisting it fails: the learner is notified, the grade is
  retried, and it is never silently lost or applied twice.
- The device clock changes or the learner travels across time zones: due dates and streak days are
  calculated from the learner's local day with a configurable day-start hour (default 04:00).
- The same account is used on two devices with conflicting reviews for one card: both reviews are
  kept in history in timestamp order and the card's state is recomputed from history.
- Import file is empty, larger than the limit, wrongly encoded, or has only one column: the import
  is rejected with a clear reason before any card is created.
- An image or audio file is too large or in an unsupported format: it is rejected with the size and
  allowed formats shown.
- Markdown contains raw HTML or scripts: it is shown safely and no script runs.
- A deck is deleted: the learner must confirm, and the deck's cards and history are removed only
  after confirmation.
- Very long card content: the card scrolls within its area and grade buttons stay reachable.
- The learner has too few cards available today to reach the XP goal (e.g. a small deck): finishing
  every available card counts as meeting the goal, so the streak is kept without studying ahead.
- The learner is offline and tries to create, edit, delete or import cards or decks: the action is
  disabled with a message that it needs a connection; review sessions remain available.
- A card's media could not be downloaded before going offline (e.g. study ahead beyond today's
  cards): the card shows a placeholder for the missing media and can still be graded.

## Requirements *(mandatory)*

### Functional Requirements

**Scheduling (FSRS)**

- **FR-001**: The system MUST schedule every card with the FSRS algorithm, tracking for each card
  its Difficulty, Stability, Retrievability, state (New, Learning, Review, Relearning), due date
  and lapse count.
- **FR-002**: The system MUST offer exactly four grades — Again, Hard, Good, Easy — and show the
  resulting interval on each button before the learner chooses.
- **FR-003**: Given the same card history, grade and review time, scheduling MUST always produce the
  same result, and results MUST match the published FSRS reference for the same parameters.
- **FR-004**: The learner MUST be able to set a target retention (default 90%, allowed 70–97%) and a
  maximum interval; changing these affects future scheduling only.
- **FR-005**: The system MUST record every review (card, grade, review time, time taken, state
  before and after) and keep it permanently unless the learner deletes the card or deck.
- **FR-006**: Due reviews MUST be presented before new cards, and new cards MUST be introduced only
  in a session that already contains every card due today in that deck; the number of new cards
  introduced per day MUST be limited (default 20 per deck) and configurable.
- **FR-007**: Gamification features MUST NOT change any scheduling outcome.
- **FR-008**: The learner MUST be able to undo the most recent grade in a session.

**Decks & cards**

- **FR-009**: Learners MUST be able to create, rename and delete decks, and create, edit, delete,
  tag and search cards within a deck.
- **FR-010**: Each card side MUST support plain text and Markdown (headings, emphasis, lists, code,
  tables, links) and MAY include one or more images and audio clips. Legacy cards are Markdown
  cards. Note-type cards (FR-035 to FR-039) instead hold rich HTML field values edited in a WYSIWYG
  editor, and their layout is defined by the note type's templates and CSS.
- **FR-011**: Image (PNG, JPEG, WebP, GIF, SVG rendered safely) and audio (MP3, M4A/AAC, OGG, WAV)
  attachments MUST be accepted up to 5 MB each.
- **FR-012**: Learners MUST be able to suspend a card (exclude it from sessions) and reset a card's
  progress to New.
- **FR-013**: The system MUST import CSV and TSV files up to 10,000 rows / 10 MB in UTF-8, with
  automatic delimiter and header detection, column mapping (Front, Back, Tags), a preview, duplicate
  handling (skip, update, or keep both), and a report of skipped rows.
- **FR-014**: The system MUST export a deck (cards, media references and full review history) to an
  open, documented format, and re-importing the export MUST restore the deck with identical
  scheduling state.

**Sessions**

- **FR-015**: A session MUST default to a size that fits about 5–10 minutes (default 20 cards,
  configurable 5–50) and MUST show a progress bar of completion. Node sessions (FR-023a) have
  their own fixed size of up to 10 due plus 10 new cards.
- **FR-016**: After a grade, the next card MUST be shown immediately while the result is saved in
  the background (optimistic update); a failed save MUST be retried and reported, never dropped.
- **FR-017**: Review sessions MUST keep working when connectivity is lost, and grades made offline
  MUST be saved once connectivity returns. While online, the app MUST keep on the device the
  content and media (images, audio) of every card due today and every new card available today,
  so these cards display fully offline. Creating, editing, deleting and importing cards or decks
  requires a connection and MUST be clearly disabled while offline.
- **FR-018**: Every review action (reveal, four grades, undo, replay audio) MUST be operable by
  keyboard shortcuts on desktop and by touch on mobile.
- **FR-019**: An interrupted session MUST be resumable with all grades given so far intact.

**Gamification & visual experience**

- **FR-020**: The interface MUST use the playful visual language described: chunky, raised
  buttons that visibly press down, large rounded corners, bright colours, and short
  micro-animations on key moments (reveal, grade, progress, unlock, celebration).
- **FR-021**: The app MUST play short sound effects when a card is graded (the same sound for
  every grade), on session completion and on streak increases; sounds MUST be turned off with one
  setting. Feedback after Again MUST be neutral or encouraging, never a "mistake" cue.
- **FR-022**: When the device requests reduced motion, animations MUST be replaced with simple
  fades or removed.
- **FR-023**: Each deck MUST be shown as a learning path of nodes. Each node holds the next 10 new
  cards in deck order. A node is locked, available, in progress or completed. It becomes completed
  once each of its cards has been studied at least once, and that unlocks the next node. Due
  reviews MUST always be reachable regardless of node locks, and node locks MUST NOT change any
  card's scheduling.
- **FR-023a**: A node session MUST first present the deck's due cards (most overdue first, up to
  10). The node's new cards (up to 10, subject to the daily new-card limit) are added only if the
  session already contains every card due in that deck today; otherwise the session holds only
  due cards and the node shows "Review N due cards to unlock new cards". Remaining due cards stay
  available through the "Review" entry point.
- **FR-024**: Learners MUST earn 2 XP for each card reviewed that was due or new, whatever the
  grade, plus a bonus for completing a session (default 5); reviews of cards that were not yet due
  MUST earn no XP. XP MUST NOT depend on the grade chosen, so that grading honestly is never
  penalised.
- **FR-025**: The daily goal MUST be an XP target that the learner picks from 10, 20, 30 or 50 XP
  (default 20). The system MUST maintain a daily streak: a day counts when the learner reaches
  the XP goal, or when they finish every card available to them that day (all due cards plus the
  day's new-card allowance) even if the goal isn't reached. The streak resets after a full local
  day without meeting the goal. Current and longest streak MUST be stored.
- **FR-026**: The home screen MUST show current streak, today's XP and goal progress, and the
  number of cards due today.

**Dashboard**

- **FR-027**: The dashboard MUST show a 12-month heatmap of reviews per day with per-day details on
  tap/hover.
- **FR-028**: The dashboard MUST show a ring/donut chart in which every card belongs to exactly one
  segment: New (never studied), Learning (in Learning or Relearning state), Due (Review state, due
  by the end of today), Not due (Review state, due later) and Suspended. Segment counts MUST add up
  to the total card count. The centre shows the number of cards to study today. Every segment has
  a numeric label so the chart is readable without colour.
- **FR-029**: Dashboard figures MUST be filterable by deck.

**Accounts, platform & accessibility**

- **FR-030**: Learners MUST sign up and sign in to an account. Decks, cards, media, review history,
  settings, XP and streaks MUST be tied to the account and synced across all devices they sign in
  on. Learners MUST be able to sign out and to delete their account and all its data.
- **FR-030a**: Changes made on one device MUST appear on the learner's other online devices within
  1 minute. When reviews of the same card conflict, all reviews MUST be kept in history in
  timestamp order and the card's state MUST be recomputed from that history.
- **FR-031**: The interface MUST be available in Vietnamese and English. The initial language
  follows the browser language (English for any language other than Vietnamese), and the learner
  can switch it in settings. The choice is saved to the account. Card content is never translated.
- **FR-032**: The app MUST be installable to the home screen and fully usable from 320 px wide
  phones to large desktop screens without horizontal scrolling.
- **FR-033**: Interactive controls MUST meet WCAG 2.2 AA colour contrast, have visible focus, and
  have accessible names for screen readers.
- **FR-034**: Markdown, HTML and imported content MUST be displayed safely so that no embedded
  script can run. Note-type HTML and CSS are allowed but MUST be sanitized on save and on render
  (no script, no event-handler attributes, no unlisted URL schemes). Each note-type card MUST render
  in its own Shadow DOM so that its CSS cannot change the rest of the app.
- **FR-035**: Learners MUST be able to create, rename, edit and delete note types. A note type
  MUST define named fields, one or more card templates (front and back HTML that refers to fields
  by name) and CSS shared by its templates. Field names and template names MUST be unique within
  the note type.
- **FR-036**: Every learner MUST have three built-in note types, created on first use: Basic (Front,
  Back), Basic (and reversed card) and Basic (optional reversed card). Learners MAY edit or delete
  them under the same rules as any other note type.
- **FR-037**: Learners MUST be able to add notes of a note type to a deck, filling its fields in
  the WYSIWYG editor. A note MUST generate one card per template whose rendered front is non-empty
  (text or media), and MUST be rejected when no template yields a non-empty front. Each generated
  card carries the note's tags.
- **FR-038**: Editing a note type MUST update its notes. Every existing card MUST be re-rendered;
  a newly added template MUST create cards for existing notes whose front is non-empty; a removed
  template MUST delete its cards.
- **FR-039**: A note type that any live note uses MUST NOT be deletable; the learner MUST be told
  that the note type is in use, and the notes that block it MUST be left unchanged.

### Key Entities

- **Learner**: The person using the app, identified by an account. Holds interface language and
  settings (target retention, daily XP goal, new-card
  limit, day-start hour, sound and motion preferences), total XP, current and longest streak.
- **Deck**: A named collection of cards owned by a learner, with its own new-card limit and its
  learning path.
- **Card**: One flashcard with Front and Back content (text/Markdown plus optional media, or the
  rendered HTML of a note-type template), tags, and FSRS memory state (Difficulty, Stability,
  Retrievability, state, due date, lapses, suspended).
- **Note Type**: A reusable card design with named fields, one or more card templates and shared
  CSS. Three built-in note types are provided (FR-036).
- **Note**: One set of field values for a note type, held in a deck. It produces one card per
  template whose front is non-empty (FR-037).
- **Media Asset**: An image or audio file attached to a card side, with type and size.
- **Review Log**: One immutable record per grade: card, grade, review time, time taken, state
  before and after. The card's FSRS state can be recomputed from its review logs.
- **Path Node**: A lesson on a deck's learning path holding up to 10 new cards in deck order, with
  lock state (locked, available, in progress, completed) and mastery level.
- **Device**: A browser where the learner is signed in. Used to sync changes and resolve conflicts.
- **Study Session**: A run of reviews with start/end time, cards reviewed, XP earned, accuracy.
- **Daily Activity**: Per local day: reviews done, XP earned, whether the goal was met. Drives the
  streak and the heatmap.
- **Import Job**: A CSV/TSV import with source file name, column mapping, counts imported and
  skipped, and per-row skip reasons.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After grading a card, the next card is visible within 100 ms in 95% of grades on a
  mid-range phone, including while offline.
- **SC-002**: A first-time learner can import a CSV of 100 cards and start their first review
  session in under 3 minutes.
- **SC-003**: A default session (20 cards) is completed in 5–10 minutes by at least 80% of test
  learners.
- **SC-004**: 100% of published FSRS reference test cases produce the same intervals and memory
  states in the app.
- **SC-005**: 0 reviews are lost across a test of 500 grades with connectivity dropped and restored
  at random points and the tab closed mid-session.
- **SC-006**: Importing a 10,000-row file finishes in under 15 seconds, with an accurate count of
  imported and skipped rows.
- **SC-007**: All primary screens (home, path, session, editor, import, dashboard) work without
  horizontal scrolling at 320 px, 768 px and 1440 px widths.
- **SC-008**: A review graded on one device appears on the learner's second online device within 1
  minute in 95% of cases, with no review duplicated or lost.
- **SC-009**: 100% of interface text is available in both Vietnamese and English, and switching
  language takes effect without losing the current screen or session.
- **SC-010**: With 100 learners active at once and an account holding 20,000 cards and 3 years of
  review history, the home screen, path and dashboard each load within 2 seconds, and SC-001 still
  holds.
- **SC-011**: In usability testing, at least 80% of learners rate the review experience as fun or
  motivating, and at least 90% can find and start their due reviews without help.

## Assumptions

- Out of scope for the MVP, as stated: social features, friend and global leaderboards, and any
  community deck sharing or marketplace.
- Also out of scope for the MVP: cloze and reverse-card note types, image occlusion, typed-answer
  cards, importing Anki `.apkg` packages, importing media inside CSV/TSV files (media is added in the
  card editor), per-learner FSRS parameter optimisation (default FSRS parameters are used), push
  notifications, and paid features.
- CSV/TSV cells may contain Markdown; a cell may reference an image or audio by public URL, which is
  displayed but not copied into the app.
- Streak protection items (e.g. "streak freeze") and hearts/lives are not included; hearts would
  discourage honest "Again" grading, which the constitution forbids.
- A "day" for streaks, goals and due cards is the learner's local day starting at 04:00 by default.
- Target users are self-directed learners (language vocabulary, exam prep, professional knowledge)
  using a modern mobile or desktop browser.
- Media storage per learner is capped (default 500 MB) to keep the app responsive.
- MVP scale: up to 1,000 registered learners, up to 100 using the app at the same time, and up to
  20,000 cards per learner. Creating cards beyond 20,000 is blocked with a clear message.
- Sign-in uses email and password with email verification and password reset, plus Google sign-in.
  A session stays signed in on a device until the learner signs out.
- Deck order for path nodes is the order cards were added or imported. Manually reordering cards
  between nodes is not included in the MVP.

## Clarifications

### Session 2026-11-05

- Q: Local-only data or accounts with sync? → A: Accounts with sync across devices (FR-030,
  FR-030a, SC-008).
- Q: Interface language? → A: Vietnamese and English with a language switch (FR-031, SC-009).
- Q: How does a deck map to path nodes? → A: New cards are split automatically into nodes of ~10
  cards in deck order. Due reviews are never locked (User Story 3, FR-023).
- Q: When a learner starts a node while due cards exist, what does the session contain? → A: Up to
  10 due cards (most overdue first), then the node's 10 new cards only if no other due cards
  remain in the deck; otherwise due cards only, and the rest stay in "Review" (User Story 3
  scenarios 5–6, FR-023a). Amended after /speckit-analyze to satisfy constitution Principle I
  (due reviews take priority over new cards).
- Q: What can a learner do offline, and does media work offline? → A: Full review offline,
  including images and audio for today's due and new cards (downloaded in advance); creating,
  editing, deleting and importing require a connection (FR-017, Edge Cases).
- Q: What scale must the MVP support? → A: Up to 1,000 registered learners, 100 at once, 20,000
  cards per learner (Assumptions, SC-010).
- Q: Which group does each card fall into on the dashboard donut? → A: Five non-overlapping
  segments (New, Learning, Due, Not due, Suspended) adding up to the total; the centre shows
  today's workload (User Story 5, FR-028).
- Q: What unit is the daily streak goal measured in? → A: A daily XP goal chosen from 10/20/30/50
  (default 20). Finishing all of the day's available cards also counts (FR-025, User Story 4,
  Edge Cases).
