# Contract: `anki-duo-export` v1 (deck export / restore)

**Requirements**: FR-014, constitution "Platform Constraints" (open, documented export format) |
**Endpoints**: `GET /api/v1/decks/{deckId}/export`, `POST /api/v1/decks/restore`

The file is UTF-8 JSON, named `{deck-name}.anki-duo.json`. Readers MUST check `format` and
`version` before reading anything else.

```jsonc
{
  "format": "anki-duo-export",
  "version": 1,
  "exportedAt": "2026-11-05T09:30:00Z",
  "scheduler": {
    "algorithm": "fsrs-6",
    "implementation": "ts-fsrs@<exact version>",
    "desiredRetention": 0.9,
    "maximumIntervalDays": 36500,
    "parameters": [/* the 21 FSRS weights used */]
  },
  "deck": { "id": "uuid", "name": "Từ vựng N3", "newCardsPerDay": 20, "createdAt": "…" },
  "cards": [
    {
      "id": "uuid",
      "position": 0,
      "nodeIndex": 0,
      "front": "Markdown",
      "back": "Markdown",
      "tags": ["n3", "verb"],
      "suspended": false,
      "createdAt": "…",
      "fsrs": {                         // current state (cache, see data-model.md)
        "state": "review", "due": "…", "stability": 12.3, "difficulty": 5.1,
        "learningSteps": 0, "reps": 7, "lapses": 1, "lastReview": "…"
      },
      "media": [
        { "id": "uuid", "side": "front", "kind": "image", "mime": "image/png", "bytes": 48213,
          "url": "https://…signed…", "sha256": "hex" }
      ]
    }
  ],
  "reviews": [                          // full history, ordered by (reviewedAt, id)
    {
      "id": "uuid", "cardId": "uuid", "kind": "review", "grade": 3,
      "reviewedAt": "…", "durationMs": 5400,
      "wasNew": false, "wasDue": true, "studyAhead": false,
      "schedulerVersion": "ts-fsrs@…/fsrs-6",
      "revokedAt": null
    }
  ]
}
```

## Rules

- **Grades**: 1 Again, 2 Hard, 3 Good, 4 Easy. `kind: "reset"` has `grade: null`.
- **Times**: ISO 8601 UTC.
- **Media**:
  - `url` is a signed link valid for 7 days, so media can be downloaded alongside the export.
  - `sha256` lets a restore verify the bytes.
  - Markdown refers to media as `media:{id}` (images) or `[[audio:{id}]]` (audio).
- **Restore**:
  - Creates a **new** deck with new ids and rewrites media references.
  - Copies media into the learner's storage when the URLs are still valid; otherwise the media is
    marked missing and shown as a placeholder.
  - Replays `reviews` through the scheduler with the exported `scheduler` settings. The resulting
    `fsrs` state MUST equal the exported `fsrs` for every card. If it doesn't, restore fails with
    `export_invalid` and creates nothing.
- **Limits**: restore applies the same limits as import (≤ 20,000 cards per learner, media quota).
- **Compatibility**: later versions MAY add fields; v1 readers ignore unknown fields. Removing or
  changing the meaning of a field requires `version: 2`.
