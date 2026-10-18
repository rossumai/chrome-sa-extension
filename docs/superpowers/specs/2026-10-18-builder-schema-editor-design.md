# Builder — a queue-first schema editor in the Console

Status: design, prototype scope. Date: 2026-10-18.

## Intent

The Rossum dashboard is built for the people who review documents. A solution architect uses the
same screens to BUILD the solution: open queue settings, change fields, check extensions. In the
native UI that means one dialog per field, and you never see the parameters of all fields at once.

Builder is a seventh Console app (rail icon: a hammer). It starts where the dashboard starts — a
list of queues — but clicking a queue opens that queue's schema as one editable table. Every
change is staged locally. One **Save** writes the whole schema.

The owner considered and rejected the existing "field manager" approach (start from one field,
see every queue that has it). Builder is deliberately **single-queue**: one queue, all its fields.

## Goals (prototype)

1. Pick a queue from a list; its schema opens immediately as a table grouped by section.
2. Edit ID, label and the common flags directly in the table, with no dialogs.
3. Edit every other parameter of the selected field in a right-hand inspector, on the same screen.
4. Add fields, add line-item columns, add sections, delete any of them, and reorder.
5. Undo and redo every staged change. A deleted section must be fully recoverable.
6. Save writes the schema to the real org. The owner tests on a throwaway org.

## Non-goals (prototype)

- **References.** A field is treated as unconnected. Renaming or deleting an ID does NOT touch
  formulas, rules, hooks, MDH configs or export templates, and Builder does not warn about them.
  (Decided by the owner; see "Later" for why this is the hard part.)
- Showing rules and hooks per field. The inspector reserves a placeholder for it.
- Editing anything other than the schema: queue settings, hooks, rules, engines.
- Creating or deleting queues or schemas.
- Multi-queue or cross-queue views.

## Anti-goals

- A save that silently writes something different from what the screen showed.
- A save that leaves the schema invalid or empty.
- Losing staged work without the user choosing to (navigation, queue switch, tab close).

## Screen

Layout B from the brainstorm (grid + inspector), left to right:

1. **Console rail** — new hammer icon, app id `builder`.
2. **Queue list** — queues grouped by workspace, with a filter box. Selecting one loads its schema.
3. **Grid** — the schema's sections as group rows (label + section id), their children as rows.
   Line-item tables (multivalue → tuple) show as one row with their columns indented beneath it.
4. **Inspector** — every parameter of the selected row that the grid does not show.

Top bar: breadcrumb (workspace › queue · schema id), a staged-change counter, **Undo**, **Redo**,
**Discard**, **Save schema**.

### Grid columns

| Column | Schema attribute | Control |
|---|---|---|
| ID | `id` | click to edit inline |
| Label | `label` | click to edit inline |
| Type | `type` (string, number, date, enum, button) | dropdown |
| Source | `ui_configuration.type` (captured, data, manual, formula, reasoning) | dropdown |
| Required | `constraints.required` | switch |
| Visible | `hidden`, **inverted** — on means the reviewer sees the field | switch |
| Export | `can_export` | switch |

Any other Source is shown **read-only**: MDH lookup fields (`ui_configuration.type: "lookup"`,
with a `matching` config on the datapoint — see `src/popup/mdh-provenance.ts`) and datapoints
with no `ui_configuration` at all. Builder does not switch a field to or from `lookup`, and
leaves `matching` untouched; the inspector shows it as read-only JSON. *(Builder's call.)*

Type and Source are two separate columns. The owner looked at combining them in one cell and chose
to keep both visible. Rows for sections, multivalues and tuples show only the columns that apply
to them.

Visual state per row: edited cells are highlighted (yellow in the mockups), new rows are marked
NEW (green), deleted rows stay in place struck through until Save, with a one-click restore.

### Adding and removing

- Each section ends with a **+ Add field** row. It inserts an empty row in place; the user types
  the ID and label and picks the type without a dialog.
- Each line-item table ends with a **+ Add column** row.
- **+ Add section** at the bottom of the grid.
- Delete is available per row (field, column, table, section). Deleting a section deletes its
  children as **one** undo step.
- Reorder by drag handle, within a section and across sections, and sections among themselves.
  *(Builder's call from the mockup; the owner did not object.)*

### Inspector

Shows the selected row's remaining parameters. Proposed content, per kind — the owner has not
reviewed this list in detail, so treat it as a starting point:

| Kind | Fields |
|---|---|
| every datapoint | `description`, `ui_configuration.edit`, `rir_field_names`, `default_value`, `score_threshold`, `disable_prediction`, `width` |
| string | `constraints.length` (min/max/exact), `constraints.regexp.pattern` |
| number, date | `format` |
| enum | `options` (value + label; add, remove, reorder), `enum_value_type` |
| Source = formula | `formula` in a CodeMirror editor (already a dependency) |
| Source = reasoning | `prompt`, `context` |
| button | `popup_url`, `can_obtain_token` |
| multivalue | `min_occurrences`, `max_occurrences`, column `aggregations` |
| section | `id`, `label` only |

Bottom of the inspector: a placeholder box "Rules and hooks for this field (later)".

Every inspector edit goes onto the same undo stack as grid edits.

## Editing model

- On queue open: `GET` the queue, then its schema. Keep the loaded `content` as the **base**.
- Every user action is one entry on a linear history stack and produces a new working copy of
  `content`. Undo/redo move along the stack; a new action after an undo drops the redo tail.
  Keyboard: ⌘Z / ⇧⌘Z (Ctrl on other platforms).
- **Discard** returns to the base and clears the stack.
- The change counter and the row highlights come from diffing working copy against base, not
  from the stack, so an edit undone by hand also clears its highlight.
- Switching queue, or closing/reloading the tab, with staged changes asks for confirmation.
- Field identity across renames: rows need an internal key that does not change when `id` is
  edited, so highlights and "restore" follow the row.

This is DOM-free logic and belongs in a unit-tested pure module (repo convention "Pure core,
impure glue"): history, apply-action, diff-vs-base.

## Save

1. Show a short summary of the diff: added, edited, deleted (with child counts for sections), and
   reordered. The user confirms.
2. Build the full `content` from the working copy, **cleaning attributes that a Source change made
   illegal**: drop `formula` when Source is no longer `formula`; drop `prompt` and `context` when
   Source is no longer `reasoning`. The API rejects leftovers.
3. `POST /v1/schemas/validate` with `{content, id}`. **It returns HTTP 200 even when the schema
   is invalid** — the body is `{}` when valid and an error tree otherwise. The tree is positional
   (section index → child index → attribute); map it back to rows and show the errors in the
   grid. Do not save.
4. Refuse locally, before validate: duplicate `id`s anywhere in the schema, an empty `id`, and an
   empty `content`. `content: []` is accepted by the API and empties the schema.
5. `PATCH /v1/schemas/{id}` with `{content}`.
6. Re-`GET` the schema and compare it with what was sent. `PATCH` silently drops unknown or
   misspelled keys with HTTP 200. Report any difference other than the defaults the API injects
   (`rir_field_names`, `default_value`, section `icon`). The re-fetched schema becomes the new base.

On a 429, stop and show a retryable error; never retry automatically (repo rule, see
`src/net/rateLimit.ts`).

## Constraints

- **Stays on a feature branch; never merged to `master` in this form** (owner's decision). The
  Release workflow publishes `master` to every Chrome Web Store user, and Builder writes live
  schemas. So no `gated` flag, no write-boundary test, and no usage event or `PRIVACY.md` entry
  in the prototype — all three are decided again if it is ever proposed for `master`.
- Lives in this repo as a Console app. Adding an app touches `Rail.tsx` APPS, `Console.tsx`
  render switch, `boot.ts` `AppId`/`isValidApp`, and `console/index.tsx` (titles, usage event,
  init).
- Preact + `@preact/signals`; per-app `api.ts`, `store.ts`, `index.tsx`, `components/`, following
  Galaxy (`src/galaxy/api.ts` is the closest REST client to copy).
- Auth comes from the Console's existing staging flow; no new auth.
- CSS in `*.module.css`; tokens from `console.css`; no bare single-letter class names.
- The repo is public: fixtures and tests use placeholder names only (`acme`, `example`).
- `npm run typecheck`, `npm test` (including the dead-code guard) and `npm run format:check` pass.

## Known risks to surface in the UI

- **A schema can be shared by several queues.** Editing it "from one queue" changes all of them.
  Show "used by N queues" in the top bar when N > 1.
- **Engine-bound queues.** Switching a field's Source to `captured` on a queue bound to a custom
  engine requires a matching engine field; validate will reject it. The validate error is enough
  for the prototype.
- **Concurrent edits.** Someone may change the schema between load and Save. Before PATCH, compare
  the schema's `modified_at` with the base and warn if it moved. *(Builder's call.)*

## Left to the builder

- Exact component split, store shape, and history-entry representation.
- Inline-edit keyboard behaviour (Enter/Esc/Tab between cells).
- Drag-and-drop implementation.
- How validate errors are drawn on rows.
- How workspaces and queues are listed (one paged list call each is enough for the prototype).

## Later (not in this prototype)

- **Per-field rules and hooks** in the inspector, built from one index computed when a queue opens:
  the queue's hooks and rules scanned for each field id.
- **Rename and delete with references.** The same index would drive it. Structured references are
  safe to rewrite automatically: formulas in the schema (`field.<id>`), rule `trigger_condition`,
  rule actions naming a `schema_id`, MDH mapping targets. Free-text references need per-hit
  confirmation: hook Python, MDH query placeholders, export templates, Request Processor JSON.
  Out of reach: ERP-side mappings and values on existing annotations. These writes span several
  objects and are not atomic, so a half-applied rename must be detectable and reportable.
- Verify whether removing or renaming a datapoint drops its values from existing annotations —
  not yet checked.
