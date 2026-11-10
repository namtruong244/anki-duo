# Contract: template filters and cloze markers

**Requirements**: FR-021..FR-023, FR-027, FR-031, FR-060..FR-062, FR-013 | **Research**: R1, R5,
R10, R11, R12 | **Code**: `packages/domain/src/notes/{template,cloze,furigana,sanitize}.ts`

This is the author-facing syntax of note type front/back templates. It extends the existing
`{{Field}}` and `{{text:Field}}` tags and follows Anki's filter-chain syntax.

## Tag grammar

```
tag      = "{{" [ filter { ":" filter } ":" ] field "}}"
filter   = name [ " " arg ]            ; only `tts` takes an arg (a language code)
field    = a field name of the note type (may contain spaces, never ":")
```

- Segments are split on `:`. The **last** segment is the field name; earlier ones are filters,
  applied **right to left** (`{{type:cloze:Text}}` clozes first, then marks a type-in).
- `{{Field}}` with no filter inserts the sanitized field HTML, as today.
- Renaming a field rewrites it inside every chain.

## Filters

| Filter | Input | Front | Back |
|---|---|---|---|
| `text` | any field | plain text (HTML stripped) | same |
| `cloze` | field with `{{cN::…}}` markers | for card N: each cN hidden as `<span class="cloze">[hint]</span>` or `[...]`; other numbers show their answer as plain content | each cN shown as `<span class="cloze">answer</span>` |
| `type` | field or `cloze` chain | the app's answer box (a `type` slot). Expected = field plain text, or for `type:cloze:` card N's answers joined with `", "` | diff of typed vs expected with verdict. Empty expected renders a normal reveal card |
| `hint` | field | `<details class="ad-hint">` with a "Show hint" summary when the field is non-empty; nothing when empty | same |
| `tts <lang>` | field | a speaker button (a `tts` slot) for the field's text. `lang` is BCP 47 (`en-US`) or Anki form (`en_US`). Disabled with a tooltip when no voice exists | same |
| `furigana` | text with `base[reading]` | `<ruby>base<rt>reading</rt></ruby>` | same |
| `kana` | same | the readings only | same |
| `kanji` | same | the bases only | same |
| `choice` | the **Correct** field of a `multiple_choice` type | option buttons (a `choice` slot), shuffled per display | same slot shows feedback; explanation comes from the Explanation field |
| `occlusion` | the Image field of an `image_occlusion` type | image with masks for the card's mask (a `occlusion` slot) | image with the target mask revealed |

Furigana syntax (Anki): `base[reading]`, where the base starts after a space or at the start
of the text, for example ` 日本語[にほんご]`.

Math is not a filter: `\( … \)` (inline) and `\[ … \]` (block) in any field are typeset after
sanitization; invalid math is shown as source text (FR-062).

## Cloze markers

```
cloze = "{{c" N "::" answer [ "::" hint ] "}}"      ; N = positive integer
```

- `answer` may contain formatting (HTML), other cloze markers (nesting) and `}}` only inside a
  nested marker. Type-in comparison uses the plain text of the answer.
- Card N exists for every distinct N found in fields the front template uses through `cloze`.
  Skipped numbers make no card (c1, c3 gives two cards). Maximum 100 cards per note.
- Repeated N: all occurrences of cN hide together on card N.
- **Nesting**: `{{c1::a {{c2::b}} c}}`. On card 1 the whole outer answer is hidden; on card 2
  only `b` is hidden and the outer answer shows as plain content. On the back of card 1 the outer
  answer is highlighted in full (its inner cloze rendered as its answer).
- **Malformed** markers (`{{c1::abc`, `{{c0::x}}`, `{{cx::x}}`, unmatched `}}`) stay as literal
  text and never produce a card. The editor warns through `findClozeProblems`. A cloze note with
  no valid marker cannot be saved (`cloze_required`).
- Text inside HTML tags (attributes) is never scanned.

## Reserved names

Authors cannot create app-owned elements. Before rendering, the sanitizer removes any `id` that
starts with `ad-` and any `class` token that starts with `ad-` from field content and templates
(`stripReservedAttrs`). Only the app emits `ad-slot-N` and `ad-hint`. Scripts, event handlers
and form controls are removed as in 001-R19 (FR-013).

## Validation errors (`validateNoteType`)

Errors block saving a note type; warnings do not.

| Kind | Message key | When |
|---|---|---|
| error | unknown field | a tag names a field that does not exist (existing) |
| error | unknown filter | a chain contains a name outside the table above |
| error | filter needs argument | `tts` without a language code |
| error | cloze filter on cloze-less type | `cloze` used in a template of a `standard` kind, or a `cloze` kind with no `cloze` use in the front |
| error | choice/occlusion misuse | `choice` or `occlusion` used outside its kind, or missing `options.roles` for `multiple_choice` |
| warning | extra type-in | more than one `{{type:…}}` in a template: only the first is interactive |
| warning | interactive tag on back only | `type`, `choice`, `occlusion` appear only on the back: shown as the answer, non-interactive |
