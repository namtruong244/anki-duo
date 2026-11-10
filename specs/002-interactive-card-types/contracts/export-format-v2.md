# Contract: `anki-duo-export` v2 (delta from v1)

**Requirements**: FR-015, SC-004 | **Research**: R13 | **Base**: 001
`contracts/export-format.md` | **Code**: `packages/domain/src/export/schema.ts`
(`EXPORT_VERSION` 1 → 2) | **Endpoints**: `GET /api/v1/decks/{deckId}/export`,
`POST /api/v1/decks/restore` (unchanged paths)

Everything in v1 holds except the fields below. The writer emits `"version": 2`.

## New fields

```jsonc
{
  "format": "anki-duo-export",
  "version": 2,
  "deck": { "id": "uuid", "name": "Biology", "newCardsPerDay": 20, "createdAt": "…",
            "mcPractice": false },                        // NEW, default false
  "noteTypes": [{
    "id": "uuid", "name": "Cloze", "css": "…", "fields": [/* … */], "templates": [/* … */],
    "kind": "cloze",                                       // NEW: standard|cloze|image_occlusion|multiple_choice
    "options": { "typeIgnoreCase": true, "typeIgnoreDiacritics": false },   // NEW
    "builtinKey": "cloze"                                  // NEW, nullable
  }],
  "notes": [{
    "id": "uuid", "noteTypeId": "uuid", "fields": { "f_text": "{{c1::ATP}} powers {{c2::cells}}" },
    "tags": [], "createdAt": "…",
    "extra": null                                          // NEW; occlusion notes:
    // "extra": { "occlusion": { "mode": "hide_all",
    //   "masks": [{ "n": 1, "shape": "rect", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1, "label": "Nucleus" }] } }
  }],
  "cards": [{
    /* v1 fields … */
    "noteId": "uuid", "noteTypeId": "uuid", "templateId": "t_1",
    "ordinal": 2,                                          // NEW, default 0
    "answerText": "cells",                                 // NEW, default ""
    "interaction": { "v": 1, "slots": [], "answer": null } // NEW, informational only
  }]
}
```

The `Interaction` shape is defined in [data-model.md](../data-model.md).

## Rules

- **Validation** (`parseExport`): `version` must be 1 or 2. v2 additionally checks `kind`,
  `ordinal` (integer ≥ 0), `extra` shape and mask ranges (0..1, unique `n`), and `mcPractice`
  boolean. Unknown fields are still ignored (v1 compatibility rule).
- **v1 files**: accepted. Missing fields default: `kind="standard"`, `options={}`,
  `builtinKey=null`, `extra=null`, `ordinal=0`, `answerText=""`, `mcPractice=false`.
- **`interaction` is recomputed on import, never trusted.** Restore re-renders every note's
  cards on the server (`renderCard`) and discards any stored `interaction`, `front`/`back` of
  note cards and `answerText` from the file. The exported `interaction` exists so other tools can
  read it without a template engine. A hand-crafted file therefore cannot inject interaction data.
- **Card matching on import**: cards are matched to slots by `(noteId, templateId, ordinal)`.
  A file card whose slot no longer exists after re-rendering is skipped with a warning count.
  Slots without a file card (should not happen) get a new card.
- **Scheduling integrity** is unchanged: `fsrs` is verified by replaying `reviews`; a mismatch
  fails restore with `export_invalid` and creates nothing.
- **Round trip (SC-004)**: export → restore into a fresh account yields the same card count per
  note and identical rendered front/back and interactions.
- **Built-ins**: restore creates note types as new rows (new ids). A `builtinKey` is only kept
  when the account has no live type with that key; otherwise it is set to null to respect the
  unique index.
- **Writers** emit v2 only. **Readers** of v1 (old clients) ignore the new fields but cannot
  read `version: 2` files: bumping the version is intentional so they fail loudly.
