# Anki Duo Constitution

## Core Principles

### I. Learning-Science Fidelity (NON-NEGOTIABLE)

Anki Duo exists to produce durable long-term retention. Engagement features serve that goal and
MUST NOT compete with it.

- Review scheduling MUST use an established, published spaced-repetition algorithm (e.g. FSRS or
  SM-2). Any deviation from the reference algorithm MUST be documented with its rationale and a
  cited source.
- The scheduler MUST be an isolated, deterministic module: given the same card history, review
  grade, and timestamp, it MUST return the same next-due date and state. It MUST NOT read the
  clock, randomness, or UI state directly; these are passed in.
- Gamification (streaks, XP, levels, leagues, rewards) MUST NOT alter scheduling outcomes. It MUST
  NOT reward behaviour known to harm retention, such as reviewing cards before they are due for
  extra points, skipping due reviews in favour of new cards, or grading dishonestly.
- Due reviews MUST take priority over new-card introduction. Daily new-card limits MUST exist and
  be user-configurable.
- A user's review history (card, grade, timestamp, interval) MUST be persisted losslessly so
  scheduling state can be recomputed or migrated to another algorithm.

**Rationale**: Gamified learning apps tend to optimise for daily activity over memory. Keeping the
scheduler pure, deterministic, and walled off from rewards keeps the learning outcome intact,
testable, and auditable.

### II. Test-First (NON-NEGOTIABLE)

- Every behaviour change MUST begin with a test that fails for the right reason. Implementation
  follows only after the failing test exists (Red → Green → Refactor).
- The scheduling algorithm MUST have unit tests covering every grade path, first review,
  lapses/relearning, interval bounds, and fuzz/rounding rules. Where the reference algorithm
  publishes test vectors, those vectors MUST be included.
- Bug fixes MUST include a regression test that reproduces the bug before the fix.
- Persistence and data-migration code MUST have tests proving review history survives the
  migration unchanged.
- Tests MUST be deterministic: no reliance on wall-clock time, network, or test execution order.

**Rationale**: Scheduling bugs are silent. Cards that come due too early or too late are invisible
to the learner until retention drops weeks later. Test-first development is the main defence.

## Platform Constraints

- Anki Duo is a Progressive Web App. It MUST be installable (valid web app manifest and service
  worker) and usable on mobile viewports first, desktop second.
- Core review sessions MUST remain usable on intermittent connectivity. Reviews completed offline
  MUST NOT be lost and MUST sync without corrupting history.
- User learning data MUST be exportable in an open, documented format.
- Interactive review controls MUST be operable by keyboard and touch, and MUST meet WCAG 2.2 AA
  colour-contrast requirements.
- Technology stack choices are made per feature in `/speckit-plan` and MUST be recorded in the
  plan. New runtime dependencies MUST be justified in the plan's Complexity Tracking section.

## Development Workflow & Quality Gates

- Features follow the Spec Kit flow: specify → (clarify) → plan → tasks → implement. The plan's
  Constitution Check MUST pass before implementation begins, or each violation MUST be justified in
  Complexity Tracking.
- Self-review is permitted (solo project). Before merging, the author MUST confirm compliance with
  Principles I and II.
- CI (or an equivalent local pre-merge script) MUST pass linting, type-checking, and the full test
  suite. A merge with a failing gate is not permitted.
- No minimum coverage percentage is enforced. The scheduler and persistence modules are the
  exception: every public function there MUST be exercised by tests.

## Governance

- This constitution supersedes other project practices and guidance. Where a spec, plan, or task
  conflicts with it, the constitution wins until it is amended.
- Amendments are made by editing this file (via `/speckit-constitution`). Each amendment MUST
  record its rationale in the commit message and update the version and Last Amended date.
- Versioning follows semantic versioning:
  - MAJOR: a principle is removed or redefined in a backward-incompatible way.
  - MINOR: a principle or section is added, or guidance is materially expanded.
  - PATCH: clarifications, wording, or typo fixes with no change in meaning.
- Compliance is reviewed at every plan (Constitution Check gate) and at every merge (self-review
  against Principles I and II). Unjustified complexity or violations MUST be fixed before merge.

**Version**: 1.0.0 | **Ratified**: 2026-11-05 | **Last Amended**: 2026-11-05
