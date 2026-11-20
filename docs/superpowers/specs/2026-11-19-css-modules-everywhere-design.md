# CSS Modules everywhere — retire the global stylesheets

Date: 2026-11-19. Status: proposed.

## Why

On 2026-11-19 the List button of Dataset Management's results switch showed an empty bordered
square. Cause: `Academy.module.css`'s `.legendItem::before` (a 10px legend swatch) was minified by
esbuild to the global class `.on`, and `on` is also the hand-written "active" class on ~13
components (`view-seg-opt on`, `csv-seg-opt on`, Fabry toggles, the rail pin, …). Every active
control in the Console drew the swatch.

esbuild guarantees minified CSS Module names unique only AMONG MODULES. It knows nothing about the
hand-written classes in the global sheets, so any short global class is a target, and which one
gets hit changes from build to build. `tests/css-class-collision-boundary.test.ts` missed this
one because it only sees a static bare `class="x"`, not `'view-seg-opt' + ' on'`.

The owner's decision (2026-11-19): stop relying on hand-written global classes. Move every global
stylesheet we own into CSS Modules, as far as possible.

## Verified facts this design rests on

- esbuild's CSS name minifier uses `a-zA-Z_` for the first character and `a-zA-Z0-9_` after it
  (read from the esbuild 0.28 binary; the current `dist/console/app.css` has no generated name
  with a hyphen). **A class name containing a hyphen can never collide with a minified module
  name.** This is the invariant the remaining global CSS keeps.
- Turning identifier minification off would also fix it (`<File>_<local>` names) but costs
  +774KB raw / +109KB gzip on `app.js`, because the switch is shared with JS identifiers.
  Rejected for that reason; see Approaches.

## Scope

Moves to CSS Modules, next to the components that use the rules:

| Sheet | Lines | Shipped as |
|---|---|---|
| `src/console/console.css` | 9,977 | `dist/console/console.base.css` (copied) |
| `src/popup/popup.css` | 1,795 | `dist/popup/popup.css` (copied; side panel links it first) |
| `src/devtools/panel.css` | 636 | `dist/devtools/panel.css` (copied) |
| `src/sidepanel/sidepanel.css` | 99 | `dist/sidepanel/sidepanel.css` (copied) |

Stays global, because no component of ours emits these classes or they must apply to `:root`:

- design tokens — every `:root` variable and its `prefers-color-scheme: dark` override, plus the
  `html`/`body` base — collected into one small `tokens.css` per surface (Console; popup + side
  panel share one; DevTools);
- `src/docs/theme.css`, `src/docs/print.css`, `github-markdown.css`, `hljs-github.css` — they
  style markdown-it / highlight.js output, not JSX;
- rules that target third-party DOM (CodeMirror `.cm-*`, three.js canvas, MUI-free) — kept
  global but scoped under a hyphenated owner class, or wrapped in `:global(...)` inside the
  owning module, whichever keeps the selector unchanged.

**Every global sheet that remains says so at its top** (owner, 2026-11-19): a header comment
stating that the file is global on purpose, must not be expanded unless a rule genuinely cannot
live in a CSS Module (a `:root` token, a third-party or markdown-rendered DOM), that new styles go
in a `*.module.css` beside their component, and that any class added here must contain a hyphen
(see the invariant above). CLAUDE.md's CSS Architecture section is rewritten to say the same and
to describe the new layout.

Out of scope: content scripts' injected styles (`rossum-sa-extension-*`, injected into Rossum's
page from `init()` — a different document); any visual change; renaming classes beyond what the
move requires.

## Goals, non-goals, anti-goals

- Goal: no hand-written global class without a hyphen anywhere in the built output, enforced by a
  test against the BUILT sheets; the four sheets above deleted.
- Goal: pixel- and computed-style-identical UI on every surface.
- Non-goal: redesign, token changes, consolidating duplicated rules across areas (record them,
  don't fix them).
- Anti-goal: a migration that passes tests but shifts the cascade. Moving a rule between sheets
  changes its source order and can change which rule wins; jsdom cannot see that. Only a real
  browser can, which is why every area has an auditor with screenshots.

## Approaches

1. **CSS Modules everywhere + hyphen invariant for what stays global** (chosen). Fixes the class
   of bug by construction, and is the direction CLAUDE.md already names for `console.css`.
   Cost: large — ~3,000 rules and ~1,200 class-selector queries in 120 test files.
2. **Turn identifier minification off.** One line, collision-proof, but +774KB raw on `app.js`
   and leaves the 12,500 lines of global CSS in place.
3. **Rename + widen the test only.** Cheapest; keeps the hazard and relies on the test forever.
   Kept as Phase 0 regardless, because it fixes the visible bug now.

## Plan of work

### Phase 0 — the visible fix (one small PR, first)

Rename the hand-written `on` class to `is-on` everywhere (JSX and CSS) — only the classes that
are actually hit. Implementing the guard found a second one, so `up` became `is-up` too
(2026-11-19): a module rule had been minified to `.up`, and the Architect's menu, when opened
upward, took its danger-banner styling. Then add the guard, as a ratchet:

- **What it checks.** The bug needs a module rule and a DOM class with the same name; the class
  needs no global rule. So the guard collects every class name our code can put in the DOM —
  every class in the built global sheets AND every class string in `src/**/*.tsx`/`*.ts`
  (`class=`, `className=`, concatenated and template-literal pieces, `classList.add/toggle`,
  e.g. `document.body.classList.add('dragging')`) — and requires each to contain a hyphen. A
  scanner over whole statements, not lines (see the CLAUDE.md trap on line scanners). It also
  keeps the direct check: no such name may equal a top-level selector in the built `app.css`.
- **The ratchet.** Today ~70 hyphen-less classes exist (`active`, `open`, `hidden`, `card`,
  `btn`, …). They go on an allowlist in the test, each with the sheet it lives in. The list may
  only shrink: Phase 2 removes entries as their sheets are deleted, and the test fails if an
  allowlisted name no longer occurs (so a stale entry cannot linger).
- **Permanent entries.** Classes emitted by the document renderer, SpecView and the doc theme
  (`active`, `anchor`, `toc`, `wide`, `copied`, …) are NOT renamed: renaming changes rendered
  HTML and the docs goldens, which this work must not touch. They stay allowlisted for good,
  marked permanent, and are protected by the direct `app.css` check instead. Builder's call.

### Phase 1 — plumbing and shared primitives (one agent, serial)

- `build.js` and the HTML: the popup, side panel and DevTools bundles start emitting their own
  `*.css` from imported modules; link them after the surface's `tokens.css`. Drop the CLAUDE.md
  rule that `src/console/apps.tsx` must import no CSS once popup CSS is emitted (re-check it: the
  popup then emits a sheet anyway).
- Cross-area primitives — classes used by more than one area (`.btn*`, `.view-seg*`,
  `.csv-seg*`, `.icon-btn`, `.dropdown-btn`, badges, empty states, …; the agent finds them by
  grep) — move into modules under `src/ui/`. Every consumer imports them.
- Order inside Phase 1 (builder's call): the pure split below FIRST, proven by CSSOM identity;
  only then the primitives. A primitive moves into its `src/ui/` module together with every
  area rule that names it (`.seg-tabs .csv-seg-opt.on`, `.seg-quiet …`), rewritten as modifier
  classes or props of the primitive, because a global rule cannot name a module class. That
  step is verified by the auditor's screenshots, not by CSSOM identity.
- Split what remains of `console.css` mechanically into one GLOBAL file per area
  (`src/<area>/legacy.css`), concatenated by `build.js` in the original order. Proof of a pure
  split: Chrome's CSSOM (`sheet.cssRules` text) is identical before and after. This is what lets
  Phase 2 agents work without touching a shared file.

### Phase 2 — areas in parallel (one agent per area, each in its own git worktree)

Fabry · Inspector · Dataset Management (MDH) · rest of the Console (rail, Audit, Galaxy, CIB,
Builder leftovers, help, rdc, Academy, agent) · popup + side panel · DevTools panel.

Each agent: moves its `legacy.css` rules into `*.module.css` beside the components, rewrites
`class=` to `styles.x`, rewrites its tests to query `'.' + styles.x` (the pattern
`tests/mdh-search-index-panel.test.tsx` already uses) or an existing `data-testid`, deletes its
`legacy.css`, and keeps typecheck, tests, `format:check` and build green. Follows the CLAUDE.md
dead-CSS traps; a rule no code emits is reported, not silently dropped.

### Phase 3 — independent audit (one auditor per area; required before merge)

The auditor did not write the code and gets the diff, not the author's summary. It:

1. reviews the diff against this document and CLAUDE.md;
2. runs `npm run typecheck`, `npm test`, `npm run format:check`, `npm run build` itself;
3. builds `master` and the branch, loads each `dist/` unpacked into Chrome for Testing
   (`--load-extension`, a throwaway `--user-data-dir`, `--remote-debugging-port`), connects
   `agent-browser --cdp`, opens `chrome-extension://<id>/console/console.html` and authenticates by
   setting `sessionStorage.consoleToken` / `consoleDomain` and reloading (verified 2026-11-19);
4. screenshots the same screens and states on both builds at 1440×900, light and dark, and
   compares them; also compares `getComputedStyle` over the area's elements;
5. passes only when nothing differs, or every difference is explained and intended.

Surfaces other than the Console (builder's call, try in this order and say which was used):

- **Popup and side panel**: open `popup/popup.html` and `sidepanel/sidepanel.html` as tabs in
  the same browser, next to a tab on the org's Rossum app (the popup reads the active Rossum tab
  through `executeScript`). The off-site and Console views need no Rossum session.
- **DevTools panel**: drive the real panel through CDP if feasible; otherwise a harness page that
  loads the built `panel.js` + its sheets with a stub `chrome.devtools.inspectedWindow` returning
  the sandbox token and a fixed resource URL. Both builds use the same harness, so the
  comparison stays fair.
- Gated apps (Academy, rdc): the auditor may set `experimentalUnlocked: true` in the throwaway
  profile's `chrome.storage.local` — local browser state, not the org. The rdc wasm is installed
  locally, so rdc is in the build.

**Org writes (owner, 2026-11-19): test data allowed, nothing else.** To reach a screen the org
has no data for, the auditor may create test objects in the sandbox org — every one named with
the prefix `zz-css-audit-` — and must delete exactly those afterwards and list them in its report.
It never modifies or deletes an object it did not create, and never runs a bulk or
whole-configuration action: no CIB Deploy/Upgrade, no rdc Write, no Bulk update/delete, no
Academy Start over, no Unlock, no Revalidate. Seeding goes through the API (curl) or the UI's
own create forms, one object at a time. Both builds are screenshotted against the same data. The live org is a sandbox test org supplied by the owner; its token is passed
to agents in their prompts only, never written to the repo, a spec, a commit or a log file.

### Merge

Area branches merge one at a time into an integration branch; after the last one a final auditor
runs the full-surface screenshot pass. Nothing is pushed or opened as a PR without the owner's go.

## Left to the builder

Which classes count as cross-area; file names of the new modules; whether a third-party override
uses `:global()` or a hyphenated wrapper; the exact screen/state list per area (at minimum every
tab and panel the area has, with data loaded, plus empty and error states that are reachable
read-only).
