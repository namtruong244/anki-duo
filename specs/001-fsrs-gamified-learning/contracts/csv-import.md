# Contract: CSV/TSV Import

**Requirements**: FR-013, Story 2 scenarios 4–6, SC-002, SC-006 | **Endpoint**:
`POST /api/v1/decks/{deckId}/import` ([openapi.yaml](./openapi.yaml))

## Accepted input

| Property | Rule |
|---|---|
| File types | `.csv`, `.tsv`, `.txt` |
| Encoding | UTF-8, with or without a BOM. Other encodings are rejected (`import_bad_encoding`) before any card is created |
| Size | ≤ 10 MB and ≤ 10,000 data rows (`import_too_large`) |
| Delimiter | Auto-detected among `,` `;` `\t` `\|`. The learner can override it in the preview |
| Quoting | RFC 4180: fields in double quotes may contain delimiters, newlines and `""` escapes |
| Header row | Detected when the first row's cells match known names (case/diacritic-insensitive): `front`, `back`, `tags`, `question`, `answer`, `mặt trước`, `mặt sau`, `thẻ`. The learner can toggle "first row is header" |
| Columns | At least 2, unless the learner maps only Front (a 1-column file is rejected with `single_column`, edge case) |

## Column mapping

The learner maps file columns to:

- **Front** (required), **Back** (optional) and **Tags** (optional);
- Tags are split on whitespace or `;`.

Unmapped columns are ignored. Cell values are taken as Markdown as-is. URLs to `https` images or
audio inside Markdown are displayed but not copied (spec Assumptions).

## Preview

The preview shows the first 10 parsed rows as cards rendered with the real card component, plus:

- the total row count;
- how many rows are already invalid;
- an estimated duplicate count, computed on the device against the deck's cards in IndexedDB.
  The server's count at import time is authoritative and appears in the final report.

## Row validation (per row)

| Reason code | Condition |
|---|---|
| `empty_front` | Front is empty after trimming |
| `front_too_long` / `back_too_long` | Over 10,000 chars |
| `too_many_tags` / `tag_invalid` | Over 20 tags, or a tag over 50 chars |
| `malformed_row` | Unbalanced quotes or wrong field count that cannot be recovered |
| `duplicate_skipped` | Duplicate and mode is `skip` |
| `card_limit_reached` | Importing would exceed 20,000 cards for the learner |

Valid rows are imported; invalid rows are skipped and reported with their 1-based line number in
the source file (Story 2 #5).

## Duplicate handling (Story 2 #6)

A duplicate is a row whose normalised Front (lower-case, NFC, trimmed, whitespace collapsed) equals
an existing non-deleted card's `front_norm` in the **same deck**, or an earlier row in the same
import.

| Mode | Effect |
|---|---|
| `skip` | Row is not imported, and is reported as `duplicate_skipped` |
| `update` | Existing card's Back and Tags are replaced. Scheduling state is unchanged. Counted as `updated` |
| `keep_both` | A new card is created |

## Chunking and idempotency

- The client sends rows in chunks of up to 1,000 with the same `jobId` and an increasing
  `chunkIndex`.
- Re-sending a chunk index that was already applied returns the stored result and creates nothing
  again.
- The final chunk has `isLast: true`. The server then sets `completed_at` and returns cumulative
  totals.
- New cards get `position`/`node_index` in file order, so the learning path follows the file order
  (Story 3 #1).

## Result report

When the import finishes, the UI shows the imported, updated and skipped counts, plus a table of
skipped rows (line number and translated reason) that can be downloaded as CSV.
