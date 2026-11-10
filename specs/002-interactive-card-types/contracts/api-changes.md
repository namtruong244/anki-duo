# Contract: REST API changes (`/api/v1`)

**Requirements**: FR-002, FR-003, FR-005, FR-008, FR-015, FR-024, FR-044, FR-045, FR-054 |
**Source**: `packages/contract/src/{common,decks,notes,me}.ts` (zod + openapi)

Everything not listed is unchanged. All additions are backward compatible: new request fields are
optional with defaults, new response fields are always present. Error bodies are
`application/problem+json` with a stable `code` (as `note_type_in_use` today).

**Path note**: the existing note edit route is `PATCH /notes/{noteId}` (`patchNoteRoute`), not
`PUT`. This delta keeps `PATCH`.

## Schema additions

| Schema | Added fields |
|---|---|
| `Card` (common.ts) | `ordinal: int ≥ 0`, `interaction: Interaction \| null`, `answerText: string` |
| `Deck` (common.ts) | `mcPractice: boolean` |
| `NoteType` (common.ts) | `kind: 'standard'\|'cloze'\|'image_occlusion'\|'multiple_choice'`, `options: NoteTypeOptions`, `builtinKey: string \| null` |
| `Note` (common.ts) | `extra: NoteExtra \| null`; `cards` items become `{ id, templateId, ordinal }` |
| `Settings` (`SettingsFields`) | `autoGrade: boolean` |

`Interaction`, `Slot`, `Answer`, `Mask`, `NoteExtra`, `NoteTypeOptions` are shared zod schemas in
`common.ts`; shapes are in [data-model.md](../data-model.md). `Interaction` is output-only: no
request schema accepts it (FR-013).

## Changed endpoints

| Endpoint | Request additions | Notes |
|---|---|---|
| `POST /decks` | `mcPractice?: boolean` (default false) | |
| `PATCH /decks/{deckId}` | `mcPractice?` | Counts as a field for the "at least one" rule. Does not re-render or reschedule (FR-047) |
| `PATCH /me/settings` | `autoGrade?` | |
| `POST /note-types` | `kind?` (default `standard`), `options?` | `kind=multiple_choice` requires `options.roles`; validated by `validateNoteType` |
| `PATCH /note-types/{noteTypeId}` | `kind?`, `options?`, `confirmRemoval?: boolean` | Changing templates/kind may remove cards, see 409 below |
| `POST /decks/{deckId}/notes` | `extra?: NoteExtra`, `cardIds?` keyed by `templateId` for ordinal 0, and `"templateId:ordinal"` otherwise | Creates one card per slot from `listCardSlots`. 422 codes below |
| `PATCH /notes/{noteId}` | `extra?`, `confirmRemoval?: boolean` | Reconciles cards (R3). 409 and 422 below |
| `GET /note-types` | none | Tops up missing built-ins (R14) before listing |
| `GET /sync/pull` | none | `cards`, `decks`, `settings`, `noteTypes` carry the new fields; no new collection |
| `GET /decks/{deckId}/export`, `POST /decks/restore` | none | Format becomes v2, see [export-format-v2.md](./export-format-v2.md) |

`POST /sync/push` is unchanged: review events carry only the grade (FR-010).

## New problem responses

**409 `cards_would_be_removed`**: on `PATCH /notes/{noteId}` and `PATCH /note-types/{noteTypeId}`
only when a vanished card is reviewed (`reps > 0` or has a `review_log` row) and `confirmRemoval`
is not `true`; unreviewed vanished cards are soft-deleted without confirmation. Nothing is saved.

```jsonc
{ "type": "…", "title": "Cards would be removed", "status": 409,
  "code": "cards_would_be_removed",
  "count": 2,
  "cards": [ { "id": "uuid", "templateId": "t_1", "ordinal": 3, "reps": 4 } ] }
```

`cards` lists only the reviewed vanished cards.

The client resends the same body with `confirmRemoval: true` after the learner confirms (FR-003).
The editor pre-computes the vanished set with `listCardSlots` and warns only when a vanished card's
`reps` (from Dexie) is above 0; the 409 is the
server-side guarantee against stale clients. With `confirmRemoval: true` and nothing to remove the
flag is ignored.

**422** on `POST /decks/{deckId}/notes` and `PATCH /notes/{noteId}`:

| `code` | When | FR |
|---|---|---|
| `too_many_cards` | the note would have more than 100 live cards | edge case |
| `cloze_required` | cloze-kind note with no valid `{{cN::…}}` marker | FR-024 |
| `wrong_answers_required` | multiple-choice note with no wrong answers and the note's deck has `mcPractice=false` | FR-045 |
| `occlusion_masks_required` | occlusion note without an image field value or without masks | FR-054 |

The existing 422 for invalid templates (unknown field/filter) keeps its code; its detail now also
lists unknown filters ([template-syntax.md](./template-syntax.md)).

## Idempotency and sync

- Card ids for new ordinals may be client-supplied through `cardIds`; replays of the same note id
  stay idempotent (001-R6).
- Soft-deleted cards propagate through pull as tombstones (`deletedAt` set), as today.
- Contract tests (`pnpm test:contract`) cover the new schemas and the openapi diff.
