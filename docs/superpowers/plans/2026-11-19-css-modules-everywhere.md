# CSS Modules Everywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire `console.css`, `popup.css`, `panel.css` and `sidepanel.css` into CSS Modules, so no hand-written class can collide with an esbuild-minified module name.

**Architecture:** Phase 0 fixes the visible `.on` bug and lands a ratcheting guard. Phase 1 (serial) splits the monolith per area without changing the CSSOM, adds build plumbing for popup/side panel/DevTools module CSS, and moves cross-area primitives to `src/ui/`. Phase 2 converts each area in parallel in its own worktree. Every task is followed by an independent auditor (review + gates + live screenshots of `master` vs branch).

**Tech Stack:** Preact 11 JSX, esbuild 0.28 CSS Modules (`*.module.css`, `minify: true`), Vitest 5 + jsdom, Chrome for Testing 159 + `agent-browser --cdp`.

**Spec:** `docs/superpowers/specs/2026-11-19-css-modules-everywhere-design.md`

## Global Constraints

- esbuild's minified CSS names match `[A-Za-z_][A-Za-z0-9_]*` — never a hyphen. Every class that stays global, or that code puts in the DOM outside a module, must contain a hyphen (or be on the guard's allowlist).
- No visual change. Screenshots and computed styles of `master` and the branch must match, or every difference is explained and intended.
- `minify: true` stays; identifier minification stays ON.
- Every remaining global sheet starts with a header: global on purpose; do not expand unless a rule cannot live in a module (`:root` token, third-party or markdown-rendered DOM); new styles go in a `*.module.css` beside their component; any class added here must contain a hyphen.
- Stays global: `:root` tokens + dark-mode overrides + `html`/`body` base (one `tokens.css` per surface), `src/docs/theme.css`, `src/docs/print.css`, `github-markdown.css`, `hljs-github.css`, rules on third-party DOM (CodeMirror `.cm-*`) kept via `:global(...)` in the owning module or under a hyphenated owner class.
- Docs renderer output and goldens (`tests/fixtures/`) are not changed. Renderer/SpecView/doc-theme classes stay allowlisted permanently.
- Content-script styles (`rossum-sa-extension-*`) are out of scope.
- Org writes during audits: only test objects prefixed `zz-css-audit-`, created one at a time and deleted afterwards, listed in the report. Never modify/delete anything else; never CIB Deploy/Upgrade, rdc Write, Bulk update/delete, Academy Start over, Unlock, Revalidate.
- The sandbox token is passed only in agent prompts; never written to a file in the repo, a spec, a commit, a log, or a screenshot filename.
- CLAUDE.md conventions bind: emit-neutral types, `.jsx` import spelling, the dead-CSS traps, `format:check` may need two passes, tests query `'.' + styles.x` (pattern in `tests/mdh-search-index-panel.test.tsx`) or an existing `data-testid`.
- Commits go on local branches only. Nothing is pushed and no PR is opened without the owner.

## Review Focus

1. Cascade order: a rule moved from `console.base.css` into `app.css` now loads later and may win where it used to lose (or vice versa) — auditor computed-style diff over the area's elements, both colour schemes.
2. Dark mode: a module that drops a `@media (prefers-color-scheme: dark)` block, or a token override left behind in the wrong sheet — auditor screenshots in dark mode on every screen.
3. States only reachable by interaction (hover, open dropdowns, `:focus-visible`, drag in progress via `body.dragging`, modals, error banners) — auditor exercises each, not only the landing view.
4. A class removed from CSS but still asserted in a test or read by JS (`querySelector('.x')`, `closest('.x')`, `classList.contains`) in `src/` — each area task greps `src/` for its old class names before deleting a rule; the guard's stale-entry check catches leftovers.
5. Popup bundle emitting `dist/popup/popup.css` over the old copied sheet (same path) — Task 1.2 test asserts the built popup sheet contains both token and module rules.

---

## Auditor protocol (used after EVERY task)

A fresh agent that did not write the code, given the task text and the diff (`git diff master...<branch>`), not the author's summary.

1. Review the diff against the spec, this plan's Global Constraints and CLAUDE.md. Report every violation.
2. Run in the worktree: `npm run typecheck`, `npm test`, `npm run format:check`, `npm run build`. All must pass.
3. Build `master` into `/tmp/css-audit/<task>/base` (via `git worktree add` of `master`, `npm ci`, `npm run build`) and the branch into `/tmp/css-audit/<task>/head`.
4. For each build: launch `"$HOME/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" --user-data-dir=<fresh tmp dir> --load-extension=<dist> --disable-extensions-except=<dist> --remote-debugging-port=<free port> --no-first-run --window-size=1440,900`. Find the extension id in `<profile>/Default/Secure Preferences` → `extensions.settings[*].path == <dist>`. Drive with `agent-browser --cdp <port>`. Open `chrome-extension://<id>/console/console.html`, then `sessionStorage.setItem('consoleToken', <token>); sessionStorage.setItem('consoleDomain', 'https://elis.rossum.ai'); location.reload()`. For gated apps set `chrome.storage.local.set({experimentalUnlocked: true})` first.
5. Screenshot the task's screen list on both builds, light and dark (CDP `Emulation.setEmulatedMedia` `prefers-color-scheme`), and compare (pixel diff; any differing region is inspected). Also dump `getComputedStyle` for every element under the area's root and diff.
6. Popup/side panel: open `popup/popup.html` and `sidepanel/sidepanel.html` as tabs, next to a tab on the org's Rossum app where reachable; off-site and Console views need no session. DevTools: real panel via CDP if feasible, else one harness page loading the built `panel.js` + its sheets with a stub `chrome.devtools.inspectedWindow` returning the token and a fixed resource URL — the same harness for both builds.
7. Seed missing data only per Global Constraints (`zz-css-audit-` prefix), delete it at the end.
8. Verdict: PASS, or FAIL with each finding (file:line or screenshot pair + what differs). A FAIL goes back to the implementer; re-audit after the fix.

---

## Phase 0

### Task 0: Rename `on` to `is-on`, add the class-name guard

**Files:**
- Modify: every `src/**/*.tsx|ts` emitting the `on` class (12 × `' on'`, 4 × `? 'on'`; find with `grep -rnE "' on'|\? 'on'|\"on\"" src`) and every `.on` selector in `src/console/console.css`, `src/popup/popup.css`, `src/devtools/panel.css`, `src/sidepanel/sidepanel.css`
- Replace: `tests/css-class-collision-boundary.test.ts`
- Create: `tests/support/classNames.ts`

**Interfaces:**
- Produces: `tests/support/classNames.ts` exporting `sourceClassNames(root: string): Map<string, string[]>` (class → files) and `globalSheetClassNames(paths: string[]): Map<string, string[]>`, plus `ALLOWLIST: Record<string, { sheet: string; permanent?: true }>` in the test file. Phase 2 tasks remove entries from `ALLOWLIST`.

- [ ] **Step 1: Write the failing tests** in `tests/css-class-collision-boundary.test.ts`:
  - `every DOM class without a hyphen is allowlisted` — union of `sourceClassNames('src')` and `globalSheetClassNames` over the built `dist/console/console.base.css`, `dist/console/doc-theme.css`, `dist/console/print.css`, `dist/popup/popup.css`, `dist/devtools/panel.css`, `dist/sidepanel/sidepanel.css`; `expect(unlisted).toEqual([])` where unlisted = names without `-` not in `ALLOWLIST`.
  - `no allowlist entry is stale` — every `ALLOWLIST` key still occurs in the union.
  - `no DOM class equals a top-level selector in app.css` — the existing `topLevelSelectorClasses` over `dist/console/app.css` intersected with the union is `[]`.
  - `the on class is gone` — `expect(union.has('on')).toBe(false)`.
  The source scanner works on whole statements (newline-spanning regexes): `class=` / `className=` string literals, string pieces in `+` concatenations and template literals inside them, ternary branches, `classList.add|remove|toggle|contains(...)` string args. Tokenize on whitespace; ignore tokens containing `${`.
- [ ] **Step 2: Run** `npm run build && npx vitest run tests/css-class-collision-boundary.test.ts` — Expected: FAIL; `unlisted` lists ~70 names and `on` is present.
- [ ] **Step 3: Fill `ALLOWLIST`** with every current hyphen-less name except `on`, each with its sheet; mark `permanent: true` for names emitted by `src/docs/**` or `src/fabry/architect/**` SpecView and styled by `theme.css`.
- [ ] **Step 4: Rename** `on` → `is-on` in JSX/TS and in the four sheets. Grep `tests/` for `.on` / `'on'` assertions and update.
- [ ] **Step 5: Mutation-check the scanner**: temporarily add `class={'x ' + (a ? 'zz' : '')}` and a wrapped multi-line `classList.add(\n'qq')` to one component; the first test must list `zz` and `qq`. Revert.
- [ ] **Step 6: Run** `npm run build && npm test && npm run typecheck && npm run format:check` — Expected: all PASS.
- [ ] **Step 7: Commit** on branch `fix/css-on-collision`: `fix(console): rename the on class; guard every DOM class name`.

Auditor screens: Dataset Management Data tab with List/Table/Stages each active (the square must be gone on master→branch diff — this is the ONE intended difference), Stats tab mode switch, CSV import wizard segments, Fabry toggles, rail.

---

## Phase 1 (serial, on branch `refactor/css-modules` from Task 0)

### Task 1.1: Split `console.css` into per-area global partials (CSSOM-identical)

**Files:**
- Create: `src/console/tokens.css`, `src/console/legacy/shared.css`, `src/{fabry,inspector,mdh,console,galaxy,audit,cib,builder,help,rdc,academy,agent}/legacy.css` (only those that receive rules; `src/console/legacy.css` takes the rest of the Console shell)
- Modify: `build.js` (concatenate in the original rule order into `dist/console/console.base.css`), delete `src/console/console.css`
- Test: `tests/console-css-split.test.ts`

**Interfaces:**
- Produces: `CONSOLE_GLOBAL_PARTS: string[]` exported from `build.js` (ordered list of partial paths) — note the dead-code guard derives entries from `build.js`; keep it a plain array literal.

- [ ] **Step 1: Before splitting**, capture the CSSOM: load the current `dist/console/console.html` in Chrome for Testing and dump `[...document.styleSheets].find(s => s.href.endsWith('console.base.css')).cssRules` → `cssText` per rule to `/tmp/css-split/before.txt`.
- [ ] **Step 2: Assign each rule** to an area by which `src/` directory emits its classes (grep); a rule whose classes come from two or more areas → `legacy/shared.css`. Rules stay in their original relative order; because the build concatenates partials, an assignment that would reorder two rules whose selectors can match the same element is not allowed — such a rule goes to `shared.css` instead.
- [ ] **Step 3: Write `tests/console-css-split.test.ts`**: `build output equals the concatenation of CONSOLE_GLOBAL_PARTS` and `tokens.css holds only :root / html / body / @media (prefers-color-scheme) rules`.
- [ ] **Step 4: Build and dump** the CSSOM again to `after.txt`; `diff before.txt after.txt` — Expected: empty. If the concatenation order made any rule move, the diff shows it.
- [ ] **Step 5: Add the header comment** (Global Constraints wording) to `tokens.css`, each `legacy.css` (plus "temporary — deleted by its area's Phase 2 task"), `src/docs/theme.css`, `src/docs/print.css`.
- [ ] **Step 6: Run gates** (typecheck, test, format:check, build) — PASS. **Commit**: `refactor(console): split console.css into per-area partials`.

Auditor: CSSOM identity is re-verified by the auditor itself; screenshots of every Console app landing view, light + dark.

### Task 1.2: Module CSS for popup, side panel and DevTools

**Files:**
- Create: `src/popup/tokens.css`, `src/devtools/tokens.css`, `src/popup/legacy.css` (rest of `popup.css`), `src/devtools/legacy.css`, `src/sidepanel/legacy.css`
- Modify: `build.js` (stop copying `popup.css`/`panel.css`/`sidepanel.css`; copy `tokens.css` to `dist/popup/tokens.css` and `dist/devtools/tokens.css`; concatenate the legacy partials into `dist/popup/legacy.css` etc.), `src/popup/popup.html`, `src/sidepanel/sidepanel.html`, `src/devtools/panel.html` (link order: `tokens.css`, `legacy.css`, then the esbuild-emitted bundle sheet), delete the three old sheets
- Test: `tests/surface-stylesheets.test.ts`

- [ ] **Step 1: Failing test** `tests/surface-stylesheets.test.ts`: for each of `popup/popup.html`, `sidepanel/sidepanel.html`, `devtools/panel.html` in `dist/`, every `<link rel=stylesheet>` href exists on disk; the side panel links `../popup/tokens.css` and `../popup/legacy.css` first; the popup bundle's emitted sheet (`dist/popup/popup.css`, from esbuild) exists once any module is imported — add one trivial module import (`src/popup/components/App.module.css` with the popup root rule moved into it) to make it real.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the build/html changes. Remove CLAUDE.md's rule that `src/console/apps.tsx` must import no CSS only if the popup now emits a sheet (it does); update `tests/popup-usage-strip-css.test.ts` paths.
- [ ] **Step 4: CSSOM identity** as in Task 1.1 for popup, side panel and panel pages (concatenated rule text of all their sheets, in link order, before vs after). **Step 5: Gates**; **commit** `build: module CSS for popup, side panel and DevTools`.

Auditor screens: popup off-site view, Console view, Rossum-tab view; side panel; DevTools panel (real or harness).

### Task 1.3: Cross-area primitives into `src/ui/`

**Files:**
- Create: `src/ui/controls.module.css` (buttons `.btn*`, `.icon-btn`, `.dropdown-btn`), `src/ui/Segmented.module.css` (`.view-seg*`, `.csv-seg*`, `.seg-tabs`, `.seg-quiet` variants), others as found — one module per primitive family
- Modify: every consumer; `src/console/legacy/shared.css` loses the moved rules
- Test: the consumers' existing tests, rewritten to `'.' + styles.x`

**Interfaces:**
- Produces: `import ctl from '../../ui/controls.module.css'` → `ctl.btn`, `ctl.btnSm`, `ctl.btnSuccess`, `ctl.iconBtn`, …; `import seg from '../../ui/Segmented.module.css'` → `seg.root`, `seg.opt`, `seg.on`, `seg.tabs`, `seg.quiet`, `seg.csvOpt`. camelCase keys of the old hyphenated names. Phase 2 tasks import these, never re-declare them.

- [ ] **Step 1:** List every class in `shared.css` and the areas using it (grep `src/`). Classes used by ONE area go back to that area's `legacy.css` (respect Task 1.1's ordering rule).
- [ ] **Step 2:** Per primitive family: move the base rule AND every area rule naming it (`.seg-tabs .csv-seg-opt.is-on`) into its module as modifier classes; rewrite consumers; rewrite tests. Remove the family's names from `ALLOWLIST`.
- [ ] **Step 3: Gates** after each family; **commit** per family: `refactor(ui): <family> as a CSS Module`.

Auditor screens: one screen per consumer area for every moved family, hover and active states, light + dark.

---

## Phase 2 (parallel; each task in its own worktree off the Phase 1 head)

One task per area. All share this shape; only the area and its screen list differ.

**Files (per area):** delete `src/<area>/legacy.css`; create `*.module.css` beside each component that uses its rules; modify those components and their tests; remove the area's entries from `ALLOWLIST`; remove the partial from `CONSOLE_GLOBAL_PARTS` (or the surface's legacy concatenation).

- [ ] **Step 1:** For every rule in the partial, find the emitting component(s). A rule no code emits → list it in the report and delete it only after the CLAUDE.md dead-CSS checks (grouped selectors, compound dead classes, comment splicing).
- [ ] **Step 2:** Move rules into the component's module; classes become camelCase keys; third-party DOM targets use `:global(.cm-…)` under a module class; `@media (prefers-color-scheme: dark)` blocks move with their rules.
- [ ] **Step 3:** Rewrite `class=` usage to `styles.x` (keep `.jsx` import spelling); for JS that reads classes (`querySelector`, `closest`, `classList.contains`) use `'.' + styles.x` or a `data-*` hook.
- [ ] **Step 4:** Rewrite the area's tests the same way.
- [ ] **Step 5:** Delete the partial, update `build.js`, remove `ALLOWLIST` entries; the stale-entry test proves none were missed.
- [ ] **Step 6: Gates** (typecheck, test, format:check — twice if needed —, build). **Commit**: `refactor(<area>): CSS Modules instead of the global sheet`.

| Task | Area (`src/…`) | Auditor screens (light + dark; hover/open/modal/error states reachable) |
|---|---|---|
| 2.1 | `fabry` (chat + Architect) | chat list, a thread with tool steps, composer, Architect spec view, version history, rail, filters. Seed a `zz-css-audit-` chat/deliverable if none |
| 2.2 | `inspector` | empty state, a Diagnosis Report for a real annotation, evidence panel, export panel |
| 2.3 | `mdh` | Data (List/Table/Stages), Indexes, Search Indexes, Stats (both modes), Overview charts, Operation Logs, import wizard (to the confirm step, no import), export wizard (to the confirm step), record editor modal, bulk menus (open only) |
| 2.4 | `console` shell + `audit` + `galaxy` + `cib` + `builder` + `help` + `rdc` + `academy` + `agent` | rail, connection bars, Audit with filters, Galaxy graph, CIB form + Check upgrade (read-only) + help window, Builder grid + each panel, rdc steps up to Review (no Write), Academy mission list |
| 2.5 | `popup` + `sidepanel` | off-site list, Console view, Rossum-tab view with provenance card, reviewing-lock banner if reachable, side panel |
| 2.6 | `devtools` | panel tabs, request bar, version rail diff, soft-wrap toggle |

Task 2.4 may be split further by the orchestrator (one agent per sub-area) as long as each sub-area owns disjoint files; `src/console/legacy.css` stays with the shell.

---

## Phase 3: Integration and close-out

### Task 3: Merge, delete leftovers, document

**Files:**
- Modify: `CLAUDE.md` (CSS Architecture: the new layout, the hyphen invariant, the global-sheet header rule, the auditor-proven workflow; Formatting: the copied-sheet list), `build.js` comments, `tests/css-class-collision-boundary.test.ts` header
- Delete: `src/console/legacy/shared.css` if empty, `CONSOLE_GLOBAL_PARTS` if only `tokens.css` remains

- [ ] **Step 1:** Merge Phase 2 branches one at a time into `refactor/css-modules`; run gates after each merge.
- [ ] **Step 2:** `ALLOWLIST` must contain only `permanent` entries; `src/console/console.css`, `src/popup/popup.css`, `src/devtools/panel.css`, `src/sidepanel/sidepanel.css` and every `legacy.css` no longer exist (`git ls-files '*.css'` check).
- [ ] **Step 3:** Update CLAUDE.md and comments. **Gates**. **Commit**: `docs: CSS Modules everywhere`.
- [ ] **Step 4: Final auditor**: the full screen list of every Phase 2 task against `master`, light + dark; the only intended difference is the removed square from Task 0. Verify all `zz-css-audit-` objects are gone from the org.
