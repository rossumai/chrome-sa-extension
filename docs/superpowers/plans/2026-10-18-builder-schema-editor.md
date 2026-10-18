# Builder Schema Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seventh Console app, Builder, that opens one queue's schema as an editable grid + inspector, stages every change with undo/redo, and saves the whole schema in one validated PATCH.

**Architecture:** A pure, unit-tested core (`model.ts` tree edits on a keyed working copy, `history.ts` undo stack, `save.ts` save pipeline) under thin Preact glue (`store.ts` signals, `components/`). REST through a Galaxy-style client in `api.ts`.

**Tech Stack:** TypeScript, Preact + @preact/signals, CSS Modules, Vitest + jsdom, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-18-builder-schema-editor-design.md`

## Global Constraints

- Branch `builder-prototype`, created from `api-call-hygiene` HEAD (it needs `src/net/rateLimit.ts`). Never merged to `master` in this form.
- No `gated` flag, no write-boundary test, no usage event, no `PRIVACY.md` entry.
- Grid columns, in order: ID, Label, Type, Source, Required, Visible, Export. Visible = `!hidden`. Required = `constraints.required`. Source = `ui_configuration.type`.
- Editable Source values: `captured`, `data`, `manual`, `formula`, `reasoning`. Any other value (e.g. `lookup`) or a missing `ui_configuration` is shown read-only and never changed.
- Type values: `string`, `number`, `date`, `enum`, `button`.
- On a 429: show a retryable error, never retry automatically (`isRateLimited`, `rateLimitMessage` from `src/net/rateLimit.ts`).
- Fixtures and tests use placeholder names only (`acme`, `example`, `x`).
- CSS in `src/builder/components/Builder.module.css`, colours via `console.css` tokens, no bare single-letter class names.
- Done means `npm run typecheck`, `npm test`, `npm run format:check`, `npm run build` all pass.
- Prototype call: the formula and prompt editors are monospace `<textarea>`s, not CodeMirror.

## Review Focus

1. A multivalue whose `children` is a single object (the API shape), not an array → flatten, edit and save must keep it an object.
2. A field renamed to an ID that already exists elsewhere (also inside a table) → Save is blocked with the duplicate named.
3. Switching Source from `formula`/`reasoning` to anything else → `formula` / `prompt` / `context` are absent from the PATCH body.
4. Unsaved changes + switching queue or closing the tab → the user is asked first.
5. `validate` returns HTTP 200 with an error tree → nothing is PATCHed, and errors land on the right rows even when soft-deleted rows were dropped from the sent content.

---

### Task 1: Keyed working copy and tree edits (`model.ts`)

**Files:**
- Create: `src/builder/model.ts`
- Test: `tests/builder-model.test.ts`

**Interfaces:**
- Produces:
  - `type Node = Record<string, any>` — a schema node plus internal `__key: string` and optional `__deleted: true`.
  - `type Kind = 'section' | 'datapoint' | 'multivalue' | 'tuple'`
  - `type Row = { key: string; kind: Kind; depth: number; node: Node; parentKey: string | null; deleted: boolean }` — `deleted` is true when the node OR an ancestor is soft-deleted.
  - `withKeys(content: any[]): Node[]` — deep copy, assigns `__key` (`k1`, `k2`, … in document order).
  - `stripForSave(nodes: Node[]): any[]` — deep copy without `__key`, dropping `__deleted` nodes, then applying `cleanAttrs`.
  - `cleanAttrs(node)`: remove `formula` unless Source is `formula`; remove `prompt` and `context` unless Source is `reasoning`. Applied to every datapoint.
  - `flatten(nodes: Node[]): Row[]` — sections depth 0, their children depth 1, a multivalue's tuple depth 2, tuple columns depth 3. `children` may be an array or a single object.
  - `findByKey(nodes, key): Node | null`
  - `setAttr(nodes, key, path: string[], value: unknown): Node[]` — `value === undefined` deletes the attribute; creates intermediate objects (`['constraints','required']`).
  - `addField(nodes, parentKey, field: Node): Node[]` — appends to a section's or tuple's children.
  - `addSection(nodes, section: Node): Node[]`
  - `setDeleted(nodes, key, deleted: boolean): Node[]`
  - `move(nodes, key, targetParentKey: string | null, index: number): Node[]` — `null` parent = top level (sections only).
  - `newDatapoint(key: string, id: string, label: string, type: string): Node` — `{category:'datapoint', id, label, type, rir_field_names: [], constraints: {required: false}, hidden: false, can_export: true, ui_configuration: {type: 'manual', edit: 'enabled'}}`; enum adds `options: []`.
  - `newSection(key, id, label): Node` — `{category:'section', id, label, children: []}`.
  - `nextKey(nodes): string` — a key not used in the tree.
  - `localErrors(nodes): { key: string | null; message: string }[]` — empty `id`; duplicate `id` among non-deleted nodes (one error per duplicate node, message names the id); no non-deleted section (`key: null`, "The schema would be empty").
  - `rowStatus(base: Node[], work: Node[]): Map<string, 'new' | 'edited' | 'deleted'>` and `changeSummary(base, work): { added: number; edited: number; deleted: number; moved: number }` — compare nodes by `__key`, ignoring `children` when deciding "edited"; "moved" = same key, different parent or index.
  - Every edit returns a new tree; inputs are never mutated.

- [ ] **Step 1: Write failing tests**, including at least:
  - `withKeys` + `stripForSave` round-trips a fixture (2 sections, one with a multivalue whose `children` is a tuple OBJECT holding 2 datapoints) to deep-equal the input.
  - `flatten` returns kinds and depths `[section 0, datapoint 1, multivalue 1, tuple 2, datapoint 3, datapoint 3, section 0, …]`.
  - `setAttr(…, ['constraints','required'], true)` on a field without `constraints` sets it; the original tree is unchanged.
  - `stripForSave` drops `formula` from a field whose Source was switched to `data`, and `prompt`/`context` from one switched off `reasoning`.
  - `setDeleted` on a section marks every descendant row `deleted: true`; `stripForSave` omits the section.
  - `localErrors` reports a renamed table column that duplicates a header field id; ignores a duplicate that is soft-deleted.
  - `rowStatus` marks an added field `new`, a relabelled one `edited`, a soft-deleted one `deleted`; `changeSummary` counts a moved field as moved, not edited.
- [ ] **Step 2: Run** `npx vitest run tests/builder-model.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `src/builder/model.ts`.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat(builder): keyed schema model with pure tree edits`.

### Task 2: Undo/redo stack (`history.ts`)

**Files:**
- Create: `src/builder/history.ts`
- Test: `tests/builder-history.test.ts`

**Interfaces:**
- Produces: `type History<T> = { past: T[]; present: T; future: T[] }`; `initHistory<T>(v: T): History<T>`; `push<T>(h, v: T): History<T>` (clears `future`); `undo<T>(h)`; `redo<T>(h)`; `canUndo(h): boolean`; `canRedo(h): boolean`. Undo/redo at the end of the stack return `h` unchanged.

- [ ] **Step 1: Write failing tests:** push/undo/redo sequence; a push after undo empties `future`; undo on empty past returns the same object.
- [ ] **Step 2: Run** `npx vitest run tests/builder-history.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(builder): undo/redo history`.

### Task 3: REST client (`api.ts`)

**Files:**
- Create: `src/builder/api.ts`
- Test: `tests/builder-api.test.ts`

**Interfaces:**
- Produces: `init(domain, token)`; `get(pathOrUrl, opts?)`; `listAll(pathOrUrl, opts?)`; `whoami()`; `listWorkspaces()`; `listQueues()` (both `page_size=100`, full pagination); `getSchema(id: number)`; `validateSchema(id: number, content: any[]): Promise<any>` (POST `/api/v1/schemas/validate` with `{id, content}`, returns the body as is); `patchSchema(id: number, content: any[]): Promise<any>` (PATCH `/api/v1/schemas/{id}` with `{content}`).
- Same error behaviour as `src/galaxy/api.ts`: 30 s timeout, 401 → session-expired message naming Builder, 403 → `featureUnavailable`, 429 → `rateLimitError`. Copy its `get`/`listAll`/`combinedSignal`; add one `send(method, path, body)` with `Content-Type: application/json`. A non-2xx PATCH throws with the API's `detail` or the JSON body text.

- [ ] **Step 1: Write failing tests:** `validateSchema` POSTs the exact URL and JSON body; `patchSchema` uses method `PATCH` and body `{content}`; a 400 PATCH rejects with `status: 400`; a 429 is recognised by `isRateLimited`.
- [ ] **Step 2: Run** `npx vitest run tests/builder-api.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(builder): REST client for queues and schemas`.

### Task 4: Save pipeline (`save.ts`)

**Files:**
- Create: `src/builder/save.ts`
- Test: `tests/builder-save.test.ts`

**Interfaces:**
- Consumes: `stripForSave`, `localErrors` (Task 1); `getSchema`, `validateSchema`, `patchSchema` (Task 3) — injected as `deps` for tests.
- Produces:
  - `mapValidateErrors(tree: any, sentNodes: Node[]): { key: string | null; message: string }[]` — walk the positional tree (`content[i].children[j]`…, including a multivalue's object `children` and a tuple's array) against the NON-deleted nodes in sent order, and return each leaf message as `"<attr>: <message>"` on that node's key; unresolvable positions get `key: null`.
  - `landedDiff(sent: any[], got: any[]): string[]` — paths whose values differ, ignoring keys the API injects when absent from `sent`: `rir_field_names`, `default_value`, and section `icon`.
  - `type SaveResult = { ok: true; schema: any; warnings: string[] } | { ok: false; stage: 'local' | 'stale' | 'validate' | 'patch'; errors: { key: string | null; message: string }[] }`
  - `saveSchema({ schemaId, baseModifiedAt, work, force }: {…}, deps): Promise<SaveResult>` — order: `localErrors` → re-GET and compare `modified_at` with `baseModifiedAt` (mismatch and `!force` → `stage: 'stale'`) → `validateSchema` (non-empty body → `stage: 'validate'`) → `patchSchema` → re-GET → `landedDiff` into `warnings`. 429s propagate as thrown errors.

- [ ] **Step 1: Write failing tests:**
  - local duplicate id → `{ok:false, stage:'local'}` and `validateSchema` never called.
  - validate body `{content:[{}, {children:{'1':{label:['bad']}}}]}` → `stage:'validate'`, error on the key of section 2's second child, message `label: bad`; `patchSchema` never called.
  - same, with section 1 soft-deleted in `work` → the error still lands on the right node.
  - `modified_at` changed → `stage:'stale'`; with `force: true` it saves.
  - happy path → `patchSchema` called once with content equal to `stripForSave(work)`; `landedDiff` ignores an injected `rir_field_names: []` but reports a dropped `labell` typo key.
- [ ] **Step 2: Run** `npx vitest run tests/builder-save.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(builder): validated save pipeline`.

### Task 5: Store, init and Console wiring

**Files:**
- Create: `src/builder/store.ts`, `src/builder/index.tsx`, `src/builder/components/App.tsx` (placeholder that renders the queue list only; Task 6 fills it)
- Modify: `src/console/boot.ts` (`AppId`, `isValidApp`), `src/console/components/Rail.tsx` (HAMMER_ICON, APPS entry `{ id: 'builder', label: 'Builder', title: 'Schema Builder', icon: HAMMER_ICON }` placed right after `audit`), `src/console/components/Console.tsx` (render branch), `src/console/index.tsx` (`builderInited`, `ensureInited`, TITLES `builder: 'Builder — Rossum SA'`, no APP_EVENTS entry, `builderApi.init`, store domain/token, `builderStore.connected.value = false` in the no-credentials branch)
- Modify tests: `tests/console-rail.test.tsx` (count 5 → 6), `tests/console-boot.test.ts` (`isValidApp('builder')` true)

**Interfaces:**
- Produces in `store.ts`: `domain`, `token`, `connected: Signal<boolean | null>`, `workspaces`, `queues` (raw arrays), `loading`, `error: Signal<string | null>`, `retryable`, `selectedQueueId: Signal<number | null>`, `schema: Signal<any | null>` (the loaded raw schema), `base: Signal<Node[]>`, `history: Signal<History<Node[]>>`, `selectedKey: Signal<string | null>`, `rowErrors: Signal<Map<string, string[]>>`, `saving: Signal<boolean>`; computed `work` (= `history.present`), `dirty` (= `changeSummary` non-zero), `sharedCount` (queues whose `schema` URL equals the selected queue's).
- Produces in `index.tsx`: `initBuilder()` (whoami, then `loadQueues()`), `loadQueues()`, `openQueue(id: number)` (asks `confirm()` when `dirty`; GETs schema; sets `base`, `history = initHistory(base)`), `apply(next: Node[])` (= push), `undoChange()`, `redoChange()`, `discard()`, `save(force?: boolean): Promise<SaveResult>`. A `beforeunload` listener blocks while `dirty`.

- [ ] **Step 1: Update** the two console tests to expect the Builder; run `npx vitest run tests/console-rail.test.tsx tests/console-boot.test.ts` — expect FAIL.
- [ ] **Step 2: Implement** the store, index, placeholder App and wiring.
- [ ] **Step 3: Run** `npx vitest run tests/console-*` and `npm run typecheck` — expect PASS.
- [ ] **Step 4: Commit** `feat(builder): add the Builder app to the Console rail`.

### Task 6: Screen — queue list, grid, inspector, toolbar, save dialog

**Files:**
- Create: `src/builder/components/QueueList.tsx`, `Grid.tsx`, `Inspector.tsx`, `Toolbar.tsx`, `SaveDialog.tsx`, `Builder.module.css`; fill `App.tsx`
- Test: `tests/builder-components.test.tsx`

**Interfaces:**
- Consumes: Task 1 model functions, Task 5 store and actions.
- Behaviour pinned by the spec and mockup `layout-v2`:
  - QueueList: queues grouped under workspace name, filter input (case-insensitive on queue name).
  - Toolbar: breadcrumb `workspace › queue · schema #id`, "used by N queues" when `sharedCount > 1`, counter `"<edited> edited · <added> new · <deleted> deleted · <moved> moved"` (zero parts omitted), Undo, Redo, Discard, Save schema (disabled unless `dirty`). ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Shift+Z redo — not while focus is in an input/textarea.
  - Grid: rows from `flatten(work)`; section rows show label + id; ID and Label are click-to-edit text inputs (Enter or blur commits one history entry, Esc cancels); Type and Source are `<select>`s (Source read-only text when outside the five values); three switches; status classes for new/edited/deleted; deleted rows struck through with a Restore button; per-row Delete; "+ Add field" after each section's last child, "+ Add column" inside a tuple, "+ Add section" at the end. New field = `newDatapoint(nextKey, 'new_field_<n>', 'New field', 'string')`, its ID input focused. Native HTML5 drag handle moves datapoints within/between sections and tuples, and sections among sections. Row errors from `rowErrors` shown under the row.
  - Inspector: for the selected row, the attribute groups of the spec's inspector table; enum options editor (value + label, add, remove, up/down); `formula` and `prompt`/`context` textareas only for those Sources; `matching` as read-only `<pre>` JSON; placeholder "Rules and hooks for this field (later)". Each committed input = one history entry.
  - SaveDialog: shows `changeSummary`, Confirm calls `save()`; on `stage:'stale'` offers "Save anyway" (`save(true)`); on `validate`/`local` closes and fills `rowErrors`; shows `warnings` after a successful save.

- [ ] **Step 1: Write failing component tests** (store primed with a keyed fixture, `index` actions spied where they hit the network):
  - renders one row per `flatten` row, with the 7 header columns in order.
  - editing a label and pressing Enter adds one history entry and marks the row edited; clicking Undo restores the label.
  - Delete on a section strikes through the section and its fields; Restore clears it.
  - the Source select is absent (read-only text `lookup`) for a lookup field.
  - "+ Add field" adds a new row marked new.
- [ ] **Step 2: Run** `npx vitest run tests/builder-components.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement** the components and CSS.
- [ ] **Step 4: Run** the full gate: `npm run typecheck && npm test && npm run format && npm run format:check && npm run build` — expect all PASS (the dead-code guard included).
- [ ] **Step 5: Commit** `feat(builder): grid, inspector, undo and save UI`.

### Task 7: Hand-off for a live check

- [ ] **Step 1:** `npm run build`; confirm `dist/console/console.js` contains `Schema Builder`.
- [ ] **Step 2:** Ask the owner to reload the unpacked extension from `dist/`, open the Console from a throwaway-org tab, and try: rename a label, delete a section, undo, redo, save; then reload the queue and confirm the change landed.
