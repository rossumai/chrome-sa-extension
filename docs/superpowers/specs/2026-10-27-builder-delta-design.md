# Builder — what was built beyond the first spec

Date: 2026-10-27
Delta on: `docs/superpowers/specs/2026-10-18-builder-schema-editor-design.md` (that document
stays the record of the grid, the editing model and the schema Save; this one records what was
built after it and which of its decisions no longer hold). A record, not a tutorial: the code
and CLAUDE.md are the current documentation.

## 1. Decisions of the first spec that no longer hold

- **Release.** The first spec kept the Builder on a feature branch, never merged, with no
  gate, no usage event and no `PRIVACY.md` entry. It is now meant for `master` as a **public
  app with a `beta` badge**. The owner first gated it behind `experimentalUnlocked` (`4fb3249`),
  then reversed that (`f7998e0`): it is NOT gated. Its opens send `sa_console_app_builder`,
  listed in `EVENT_NAMES` and `PRIVACY.md`. There is no Builder-specific write-boundary test:
  its Mr. Fabry turns send no `mcpMode`, so `tests/fabry-write-boundary.test.ts`, which scans
  all of `src/`, already covers them.
- **Non-goals now built**: rules, hooks and engines are edited; workspaces, queues and schemas
  are created, and queues and schemas deleted. Multi-queue views are still out.
- **"A seventh Console app"**: the rail now has nine.
- **Column widths** are not resizable, and `builderColumnWidths` never shipped. The layout is
  fixed for a 13" screen (1440px): `fitColumns` sizes the columns to the space, and the grid
  drops columns while a right panel is open. The one stored preference is `builderPanelWide`.
- **"Rules and hooks for this field (later)"** became the field panel's list of the rules and
  MDH configurations that use the field, plus the grid's Rules, Matching and Hooks columns.
- **References are shown, not rewritten.** A rename or delete still changes no formula, rule,
  hook or MDH config; the first spec's "Later" section on that stands.

## 2. What writes, and when

Only the schema draft is staged. Every other write happens on its own click.

| Action | Requests | Notes |
|---|---|---|
| Save | GET schema (stale check) → POST/PATCH `engine_fields` → `schemas/validate` → PATCH schema → GET → DELETE `engine_fields` | The API refuses a datapoint without its engine field, and the delete of one a saved schema uses. A failed stage keeps the delete marks. |
| Create workspace | POST `workspaces/` | Organization: the existing workspaces', else `currentOrg`. |
| Create queue | POST `schemas/` (copy of the SAVED schema, or one empty section; none when shared), POST `queues/` | If the queue fails, the new schema stays, listed without a queue, and the error says so. |
| Create schema | POST `schemas/` | A schema no queue uses. |
| Delete queue | DELETE `queues/{id}`, or with `?delete_after=0` | Dialog: "Delete in 24 h" (Rossum's default; listed as Deleting while `deletion_requested`) or "Delete now" (permanent). |
| Delete schema | GET, then DELETE `schemas/{id}` | No grace window. `{ name, content }` of the last deleted schema stays in memory; Undo POSTs it back under a new ID. Lost on reload. |
| Rule Save | GET rule, then PATCH `rules/{id}` or POST `rules/` | Refuses when `modified_at` moved. A new rule is attached to the open queue. |
| Hook Save | GET hook, then PATCH `hooks/{id}` `{ settings }` | Refuses when `modified_at` moved; the PATCH replaces the whole `settings`. |
| Revalidate | POST `start` (only from `to_review`), POST `content/validate`, POST `cancel` | Formulas, hooks and rules run as on a reviewer's edit. |
| Rule preview | POST `internal/rules/evaluate_rules` | Internal, undocumented; evaluates the unsaved draft and writes nothing. |

## 3. What was added

- **Rules.** A Rules column (rules per field), a rule filter, and rule mode: the grid turns
  read-only, gains a Rule column and a whole-document row, and the right panel edits one
  native Rule (name, description, enabled, condition, and `show_message`,
  `add_automation_blocker` and `show_hide_field` actions; other action types are kept as
  sent). The open rule is evaluated on the picked annotation, 400 ms after the last change.
- **MDH hooks.** A Matching column, and hook mode per configuration: which configuration
  matches on a field and which fills it, the settings editor jumping to that configuration, and
  the hook's own Save.
- **Other hooks.** A Hooks column: a whole-word search for the field id in a function hook's
  code and in any hook's settings (a webhook's settings only), opened read-only at each mention.
  It points at places to look; it does not prove a use.
- **Engines.** An engine panel for the queue's custom engine. Engine-field edits are staged on
  the schema node (`__engine`, stripped on save), so undo covers them. On the generic engine
  the field panel adds `rir_field_names` from the pretrained catalog. A captured field that is
  hidden gets a warning.
- **The picked annotation.** Revalidate, and a validation panel with two tabs: Rules (messages
  placed on their fields, fired rules) and Provenance (the popup's MDH replay, one line per
  configuration).
- **Mr. Fabry.** Four assistants — a rule, a field (its formula included), an MDH hook's
  settings, the whole schema (a list of changes applied as one validated edit). Each is a
  read-only agent turn; the reply lands in the draft as one undoable edit, and a reply that
  arrives after its target is gone is dropped.
- **Formula editor.** CodeMirror with Python highlighting, and a Format button running Ruff as
  WebAssembly. `ruff.wasm` is 10.9MB raw and 3.8MB of the 5.4MB Web Store zip (measured
  2026-10-27, `zip -9`, without rdc's optional wasm); the owner accepted that cost. Compiling
  it relies on the manifest's `'wasm-unsafe-eval'`, which the rdc app added.
- **Rate limits.** A 429 on a side list (schemas, annotations, rules, hooks, catalog) shows a
  banner whose Retry reloads the lists that failed; other failures leave the list empty.
