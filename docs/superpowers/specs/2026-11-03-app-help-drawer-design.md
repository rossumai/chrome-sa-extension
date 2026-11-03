# In-app help drawer, CIB deploy as the proof of concept

Date: 2026-11-03. Status: approved design, not yet planned.

## Intent

Every Console app gets a help section. It explains what the app does and how to use it, and the
reader can search it. It opens **inside the app, while the reader works**, not on a separate page.

Help does not use screenshots. Each illustration is the **real component**, rendered with sample
data, frozen, with numbered callouts on its parts. A screenshot goes stale the moment the UI
changes. A real component changes with the UI, and it can point at its own parts.

CIB deploy is the proof of concept. This document designs the shared drawer and the CIB content.
Other apps follow later, each one as a separate change.

## Goals

- A **Help** button in the CIB connection bar opens a drawer on the right of the CIB page. The
  form stays usable beside it.
- **Help is always available** (owner, 2026-11-03), including when the page is not connected.
  Help makes no API call, so nothing should stop it from working. The not-connected bar in
  App.tsx gets the same Help button, so the drawer and its width state sit ABOVE App.tsx's
  `if (!connected)` early return.
- The drawer explains CIB deploy: what it does, what you need before you start, each of the five
  steps, and what to do when something goes wrong.
- Search filters the help to the sections that match.
- Figures are the real CIB components, frozen, with numbered callouts.
- The drawer and figure parts are shared, so the next app adds only its content.

## Non-goals

- No help for any other app in this change.
- No guided tour or overlay on the live form. Figures are separate, frozen copies.
- No interactive figures. A reader cannot type into or click a figure.
- No help content fetched from the network. Help ships in the bundle.
- No cross-app search yet. The search covers the open app's help only.

## Anti-goals (a failure even if it works)

- **A figure that is not the real component.** If the help rebuilds a step's markup by hand, it
  drifts from the UI. That is the screenshot problem again, only harder to see. The throwaway
  mockup did exactly this for steps 1, 2 and 4, because App.tsx writes those step bodies inline.
  The build must not.
- **A figure that sends a request or changes state.** Figures run with fixed props and no store.
- **Help text that describes CIB wrongly.** Every claim in the help is checked against
  `src/cib/` before it ships (see Content).
- **A change to what the CIB page does.** Extracting components for reuse must not change the
  page's behaviour or its requests.

## The approved look (from the mockup)

The owner reviewed a high-fidelity mockup that rendered the real CIB components (2026-11-03).
They chose the drawer over a full-page variant and asked for two changes, both made and accepted:
a resizable drawer and quieter callouts. The mockup was a throwaway bundle under the gitignored
`.superpowers/`. This section records what it settled.

**Opening it.** The CIB connection bar gets a pill button on its right end: a filled accent circle
with `?`, then the word `Help`. It shows its pressed state (accent border and text) while the
drawer is open.

**The drawer.**

- It docks on the right of the CIB page as a flex sibling of `.main`. It does not float over the
  form: the form gets narrower.
- Its default width is 480px. A 6px handle on its left edge drags it between 360px and 900px. The
  handle shows `--accent` on hover and while dragging, like `.sidebar-resizer`. While dragging,
  the whole page shows the `col-resize` cursor and text selection is off.
- Its header is `CIB deploy help` with a close button, in the shared modal header's metrics
  (`8px 12px 8px 18px`, a 28×28 close target, title 15px/600).
- Under the header: a search field ("Search CIB help", with a magnifier icon), then a row of
  chips, one per section, that jump to it (`Step 1` … `Step 5` for the steps).
- Under those: one scrolling column of sections, body text 13px on line height 1.55, section
  titles 14px.

**Sections, in order:** What CIB deploy does · Before you start · Step 1 · Target and token owner
· Step 2 · Coupa credentials · Step 3 · Test the Coupa login (optional) · Step 4 · Deploy ·
Step 5 · Read the result · When something goes wrong.

**A figure.**

- The real component sits on a dotted stage (`--bg-base` with a 14px dot grid, 1px `--border`,
  radius 12px, padding 16px).
- The component is `inert`, with `pointer-events: none` and no text selection.
- It scales with CSS `zoom` to fit the stage width: `min(1, (stageWidth − 32) / 712)`. 712px is
  the step's width on its own page. Resizing the drawer re-fits every figure and re-measures its
  callouts.
- **Callouts at rest:** only a small pin at the top-right corner of each part. The pin is a 16px
  circle, white with an accent ring and an accent number. There is no outline and no tint.
- **Callouts on hover:** hovering a note, or its pin, outlines that part in `--accent` (1.5px,
  radius 7px). It dims the rest of the stage with a 62% `--bg-base` veil (a large spread
  `box-shadow`, clipped by the stage's `overflow: hidden`). That pin fills with accent, and the
  other pins fade to 35%.
- **Notes** sit under the stage as a numbered list. Each note is grey text with its term in bold
  `--text-primary`, and the hovered note gets an accent tint. Numbers are accent, bold, and on the
  same left edge as body text and bullet markers. Wrapped lines align with the first line's text
  (an 18px hanging indent shared with `ul`).

**Callout targets** are measured with `getBoundingClientRect` relative to the stage, after zoom.
Positions are strings with `px`: this repo is on **Preact 11, which no longer adds `px` to a
numeric style** (the mockup's callouts were invisible until this was fixed).

## Content

The help text for CIB is written for a solution architect who opens CIB deploy for the first time.
The mockup's text is a **draft**: it was written from the UI's own strings, and nobody has checked
it against the engine. Before it ships, check each claim against `src/cib/cib.ts`, `engine.ts`,
`release.ts` and `view.ts`, and against the CIB specs (`2026-11-02-cib-deploy-auto-target-design.md`,
`2026-10-30-cib-deploy-ux-refinement-design.md`). Mark any claim the code does not support, and
fix it or drop it. Two draft claims are already settled (my calls, see below):

- **Scopes are not listed.** Each release names its own `requiredScopes` in its `deploy/`
  settings (`release.ts`), so a typed list would go stale at the next release. The help says the
  client needs "the scopes the release requires", and that Check names any missing scope.
- **"Datasets still missing … it fills in by itself" is dropped.** The code proves only that the
  run stops waiting for the datasets after 180 s (`waitImports` in `cib.ts`). What the import does
  on the server after that is not established. The help says that the run stopped waiting, and
  that the reader can see whether the dataset has appeared in Dataset Management.

Figures, with their callouts:

| Section | Figure (real component, sample props) | Callouts |
|---|---|---|
| Step 1 | step 1, complete, owner picked | Release · Organization · Region · Token owner input |
| Step 2 | step 2, filled (secret masked) | Coupa URL · Client secret · the secret note in the footer |
| Step 3 | `CoupaLoginStep`, route `browser`, no check function | This browser · The Rossum organization |
| Step 4 | step 4, ready | Check only · Check and deploy · Resume and re-run |
| Step 5 | `RunResult`, a finished deploy with one missing dataset | Verdict · the missing-datasets stat · the phase list |

The "What it does", "Before you start" and "When something goes wrong" sections are text only.

Sample data uses only the repo's placeholders: an org `Acme Sandbox` with id `123456`, region
`eu2`, user `admin.example` · `Alex Example`, Coupa `https://example.coupahost.com`, host
`partner-sandbox.rossum.app`. The step 5 verdict comes from the real `verdict()` in `cib.ts`, fed a
sample result, so its wording cannot drift.

## Constraints from the repo

- **Reusing real components means extracting them.** Steps 1, 2 and 4 are inline JSX in
  `src/cib/components/App.tsx`. They have to become components that App.tsx renders AND help
  renders, with their state passed in as props. `Step`, `OwnerCombobox`, `CoupaLoginStep` and
  `RunResult` are already reusable. The extraction is a refactor and must not change behaviour:
  the existing CIB tests are the check, and the page must keep the same requests.
- **Stable callout targets.** Point callouts at `data-help="<name>"` attributes on the real
  components, not at CSS Module class names, which minify to short generated names.
- **Pure core, impure glue.** The callout geometry (target rect → outline and pin position) and
  the zoom formula are pure functions with unit tests. jsdom has no layout, so the measuring itself
  needs a real browser check.
- **The dead-code guard** (`tests/dead-code.test.ts`) fails on an unused export. Every new export
  needs an importer.
- **CSS** goes in CSS Modules. No bare short class names (see the collision guard).
- **Event handlers that read the drag position** own their window listeners and remove them on
  mouse-up and on unmount (a listener belongs to the effect that owns the element).

## Decisions made by me (the designer), for the owner to check

- **Where the code lives:** the shared drawer, figure, callouts and search go in `src/help/`. Each
  app's content goes beside the app, as `src/cib/help.tsx`, exporting its sections.
- **Width is remembered** in `chrome.storage.local` as a new global pref, `helpDrawerWidth`. It is
  added to the boot read list and to CLAUDE.md's Global prefs. Open or closed is not remembered:
  the drawer starts closed.
- **No usage event** for opening help in this change. Adding one would mean an `EVENT_NAMES`
  entry and a `PRIVACY.md` line, and it can come with the second app.
- **Search** is a plain case-insensitive match on each section's title and text. A section with no
  match is hidden. Empty search shows everything. No index and no ranking.
- **The drawer is CIB's own** for now: it lives in the CIB page, not in `Console.tsx`. That fits
  CIB staying mounted while hidden. Moving it up to the shell is for when a second app needs it.
- **Scopes and the missing-datasets claim:** settled as described under Content, so the help says
  only what the code supports.
- **Escape closes the drawer.** The chips scroll the drawer's own scroller with the repo's tween
  (`src/mdh/smoothScroll.ts`), not `behavior: 'smooth'`.

## Left to the builder

- Prop names and the split of the extracted step components.
- How a section declares its searchable text (for example, a plain `keywords` string beside the JSX).
- Test structure, beyond the pure-core tests and the behaviour-neutral refactor named above.
- Dark mode: use only the tokens; no new colours.

## Done means

- The CIB page has a Help button in both the connected and the not-connected state, and the drawer opens, closes, resizes and keeps its width.
- Every figure is rendered from the same component the CIB page uses. No help file contains a
  hand-copied step body.
- The help text was checked against the code, and the check is recorded in the commit or PR.
- `npm run typecheck`, `npm test` and `npm run format:check` pass.
- A real-browser check at 1440px confirms that callouts land on their parts at the default width
  and at both resize limits.

## Delta, 2026-11-03: a floating window instead of the drawer

The owner reviewed a second high-fidelity mockup: the real help code from the branch inside a
movable, resizable frame. They chose it over the drawer: "open the window a bit below the top
bar". This section replaces the drawer parts of "The approved look". The figures, callouts, notes,
search, chips, content and "always available" rule are unchanged.

- **A floating window** over the whole Console, rail included, with no backdrop, so the page stays
  usable around it. It is not modal: no focus trap.
- **Its header is the title bar.** Dragging the header moves the window; its buttons do not start
  a move. The cursor is `grab`, and `grabbing` while moving.
- **Resize from all four edges and all four corners.** The hit areas are 8px on the edges and 14px
  on the corners, centred on the border. A small grip is drawn in the bottom-right corner. While
  dragging, the size shows as `<w> × <h>` in the bottom-right corner, and the frame takes an
  accent ring.
- **Minimum 360×320.** The window always stays wholly inside the viewport with a 12px margin, at
  any size. It re-clamps when the browser window resizes.
- **The default opens a bit below the top bar:** 480px wide, docked right (`x = vw − 480 − 12`),
  `y = 48`, so the Help button in the connection bar stays visible, and `h = vh − 48 − 12`.
- **Stacking:** `z-index: 150`, above every page layer (≤ 100) and below the modals (200). A modal
  the page opens covers the help.
- **Memory:** the rectangle is saved as `helpWindowRect` (`{ x, y, w, h }`) when a move or resize
  ends, not on every mouse move. A stored value is clamped on load, and junk falls back to the
  default. `helpDrawerWidth` is dropped: it never shipped.
- **While dragging,** a transparent full-viewport shield sits under the pointer, so text cannot be
  selected and nothing under the window reacts. It is removed on mouse-up and on unmount.
- **Escape** closes the help only when the window is visible (CIB stays mounted while hidden), and
  only if no other handler already used the key (`defaultPrevented`): Escape in the owner
  combobox closes its suggestions, not the help.
- **Fixed with it:** paragraphs inside a help section get the body's paragraph spacing; the built
  content showed none.
