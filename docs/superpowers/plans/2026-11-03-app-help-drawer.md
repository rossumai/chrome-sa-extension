# In-app Help Drawer (CIB deploy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Help button on the CIB deploy page opens a resizable, searchable drawer. Its
illustrations are the real CIB components, frozen, with numbered callouts.

**Architecture:** Geometry, zoom, clamping and search are pure functions in `src/help/geometry.ts`.
Shared Preact parts live in `src/help/`: `HelpFigure`, `HelpDrawer`, `HelpButton`, the width pref
and one CSS Module. CIB's inline step bodies 1, 2 and 4 move into components that App.tsx and the
help both render, with `data-help` hooks on their parts. CIB's content lives in `src/cib/help.tsx`.

**Tech Stack:** Preact 11 + `@preact/signals`, TypeScript, CSS Modules via esbuild, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-03-app-help-drawer-design.md` (read it first; the "approved
look" section holds every visual value).

## Global Constraints

- Preact 11 does NOT add `px` to numeric styles: every inline length is a string (`'480px'`).
- Width: default 480px, minimum 360px, maximum 900px. The handle is 6px wide on the drawer's left edge.
- Zoom: `min(1, (stageWidth − 32) / 712)`.
- Figure stage: `--bg-base` with a 14px dot grid, 1px `--border`, radius 12px, padding 16px, `overflow: hidden`.
- Pin: a 16px circle in the top-right corner of its part (`right: -8px; top: -8px`), white with an
  accent ring and an accent number. Hovered: outline 1.5px `--accent`, radius 7px; the veil is
  `color-mix(in srgb, var(--bg-base) 62%, transparent)`; other pins fade to opacity 0.35.
- Drawer header metrics: `8px 12px 8px 18px`, a 28×28 close button, title 15px/600. Body 13px/1.55, section titles 14px.
- Notes and `ul` share one 18px hanging indent on the body text's left edge.
- Use only tokens from `console.css`; add no colours. No bare short class names (CSS Modules only).
- Sample data uses placeholders only: `Acme Sandbox`, `123456`, `eu2`, `admin.example` / `Alex
  Example`, `https://example.coupahost.com`, `partner-sandbox.rossum.app`.
- Help makes no API call and works in the not-connected state.
- Every component import spells `.jsx`, as the rest of `src/` does.
- Gates before each commit: `npm run typecheck`, `npm test`, `npm run format:check`.

## Review Focus

1. **A renamed `data-help` hook** silently drops a callout. Task 4 adds a test that every CIB callout target resolves in its figure.
2. **A narrow window with a wide drawer** squeezes the form to nothing. The maximum is also capped at `innerWidth − 560`, never below 360 (`clampWidth` in Task 1).
3. **A stored width that is junk** (a string, `NaN`, 5000) shows a broken drawer. `loadHelpWidth` clamps it, or falls back to 480 (Task 3).
4. **A search with no match** shows an empty drawer. It shows `No help matches “<q>”.` (Task 3).
5. **Help while a deploy runs:** the CIB `<fieldset disabled={busy}>` must not disable the Help button or the drawer. Task 4 tests Help during a run.

---

### Task 1: Pure core — zoom, callout box, width clamp, search

**Files:**
- Create: `src/help/geometry.ts`
- Test: `tests/help-geometry.test.ts`

**Interfaces:**
- Produces:
  - `type Rect = { left: number; top: number; width: number; height: number }`
  - `NATURAL_WIDTH = 712`, `HELP_WIDTH = { def: 480, min: 360, max: 900 }`, `FORM_MIN = 560`
  - `fitZoom(stageWidth: number, natural = NATURAL_WIDTH): number`: returns `min(1, (stageWidth − 32) / natural)`, and never below 0.1
  - `calloutBox(target: Rect, stage: Rect, pad = 3): Rect`: the target relative to the stage, grown by `pad` on each side
  - `clampWidth(w: unknown, viewport: number): number`: a non-finite value gives 480. Otherwise the result lies in `[360, max(360, min(900, viewport − 560))]`
  - `type Searchable = { id: string; title: string; keywords: string }`
  - `matchSections<T extends Searchable>(sections: T[], q: string): T[]`: a trimmed, case-insensitive substring match on `title + ' ' + keywords`. An empty query returns everything.

- [ ] **Step 1: Write the failing tests** in `tests/help-geometry.test.ts`:
  - `fitZoom(744)` → `1`; `fitZoom(480)` → `448/712`; `fitZoom(2000)` → `1`; `fitZoom(0)` → `0.1`
  - `calloutBox({left:110,top:220,width:50,height:20},{left:100,top:200,width:400,height:300})` → `{left:7,top:17,width:56,height:26}`
  - `clampWidth(480, 1440)` → `480`; `clampWidth(100, 1440)` → `360`; `clampWidth(5000, 1440)` → `880`; `clampWidth(5000, 2000)` → `900`; `clampWidth('x', 1440)` → `480`; `clampWidth(NaN, 1440)` → `480`; `clampWidth(700, 800)` → `360`
  - `matchSections` over `[{id:'a',title:'Step 1',keywords:'token owner'},{id:'b',title:'Deploy',keywords:'resume'}]`: `'TOKEN'` → `['a']`; `'  '` → both; `'zzz'` → `[]`
- [ ] **Step 2: Run** `npx vitest run tests/help-geometry.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/help/geometry.ts`, with no DOM and no imports.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run all three gates (the dead-code guard will flag the exports until Task 3 imports them; if it fails only on these exports, carry the commit into Task 3 instead).
- [ ] **Step 5: Commit** `feat(help): pure geometry, width clamp and search for the help drawer`.

### Task 2: Extract CIB steps 1, 2 and 4 into reusable components (behaviour-neutral)

**Files:**
- Create: `src/cib/components/TargetStep.tsx`, `CredentialsStep.tsx`, `DeployStep.tsx`
- Modify: `src/cib/components/App.tsx` (the three inline `<Step n={1|2|4}>` blocks, about lines 411–481, 482–557 and 578–638)
- Test: `tests/cib-steps.test.tsx`; `tests/cib-app.test.tsx` must pass UNCHANGED

**Interfaces:**
- Consumes: `Step`, `OwnerCombobox` (+ `Owner`), `Target` from `cib.ts`, `styles` from `App.module.css`.
- Produces (the builder picks the prop names; these are the contract):
  - `TargetStep`: the release, resume release, target, target errors, the owner combobox's props and the `state`. It renders step 1 exactly as App.tsx does now.
  - `CredentialsStep`: the three values, `onInput(key)`, `showSecret` + its toggle, and `state`.
  - `DeployStep`: run ID, allow, their setters, `ready`, `busy`, `state`, and the `deployRef`/`resumeRef` refs, passed through as props of type `Ref<HTMLButtonElement>` / `Ref<HTMLDetailsElement>`.
  - `data-help` hooks: on step 1, `release`, `org`, `region` on the three `<dl>` rows and `owner` on the combobox's wrapper; on step 2, `coupa-url`, `client-secret` on the `.field` divs and `secret-note` on the footer content; on step 4, `check`, `deploy` on the buttons and `resume` on the `<details>`. In `CoupaLoginStep.tsx`, `route-browser` and `route-org` on the two route labels. In `RunResult.tsx`, `verdict` on the verdict div(s) and `phases` on the phase list. The `missing` stat already has `data-stat="missing"`; the help targets that.

- [ ] **Step 1: Write the failing test** `tests/cib-steps.test.tsx`. It renders each extracted step with sample props and asserts that every hook above exists once: `root.querySelectorAll('[data-help="release"]').length === 1`, and so on. A second test asserts that `TargetStep` with `resumeRelease='v2.0.0'` and `release='v2.1.0'` shows `From checkpoint` and no `latest` tag, as App.tsx does today.
- [ ] **Step 2: Run** `npx vitest run tests/cib-steps.test.tsx`. Expected: FAIL (modules missing).
- [ ] **Step 3: Move the JSX.** Move each inline step into its component word for word, keeping class names and element order. App.tsx keeps all state and effects and passes them down. Add the `data-help` attributes.
- [ ] **Step 4: Verify.** Run `npx vitest run tests/cib-steps.test.tsx tests/cib-app.test.tsx tests/cib-login-step.test.tsx tests/cib-run-result.test.tsx`. Expected: all PASS, with `cib-app.test.tsx` not edited.
- [ ] **Step 5: Check that the emit is unchanged.** Build before and after (`git stash` for the before), then diff the UNMINIFIED CIB markup. The only difference allowed is the added `data-help` attributes. Use a non-minified scratch esbuild of `src/console/index.tsx` and collapse whitespace first. Record the result in the commit body.
- [ ] **Step 6: Run the gates and commit** `refactor(cib): extract steps 1, 2 and 4 so help can render them`.

### Task 3: Shared help UI — figure, drawer, button, width pref

**Files:**
- Create: `src/help/HelpFigure.tsx`, `src/help/HelpDrawer.tsx`, `src/help/HelpButton.tsx`, `src/help/width.ts`, `src/help/Help.module.css`
- Test: `tests/help-figure.test.tsx`, `tests/help-drawer.test.tsx`

**Interfaces:**
- Consumes: everything from Task 1; `animateScrollTop` from `src/mdh/smoothScroll.ts`.
- Produces:
  - `type Callout = { target: string; note: ComponentChildren }`, where `target` is a `data-help` name or, for an existing hook, a full selector starting with `[` (for `[data-stat="missing"]`)
  - `HelpFigure({ callouts: Callout[]; children: ComponentChildren })`
  - `type HelpSection = Searchable & { chip: string; body: ComponentChildren }`
  - `HelpDrawer({ title: string; placeholder: string; sections: HelpSection[]; onClose: () => void })`
  - `HelpButton({ open: boolean; onToggle: () => void; class?: string })`
  - `width.ts`: `HELP_WIDTH_KEY = 'helpDrawerWidth'`, `helpWidth = signal(480)`, `loadHelpWidth(): void` (once, like `loadPanelWide` in `src/builder/components/panels.ts`), `setHelpWidth(px: number): void` (clamps, sets the signal, writes storage)

**HelpFigure behaviour:** it wraps `children` in an `inert` div. In a `useLayoutEffect` with a
`ResizeObserver` on the stage, it sets `zoom = fitZoom(stage.clientWidth)` on that div, then
measures each callout target with `calloutBox`. A callout whose target is missing renders no pin and
logs nothing. Pins render as soon as targets are found; in jsdom every rect is 0, which is fine.
`hot: number` (−1 by default) is shared by the pins and the notes. On the figure root it sets a
`data-hot` attribute while something is hovered, so the CSS can fade the other pins.

**HelpDrawer behaviour:** the header (title and close), the search input, chips for the matched
sections, then the sections or the empty message `No help matches “<q>”.` A chip calls
`animateScrollTop(body, section.offsetTop − body.offsetTop)`. Escape on `document` calls `onClose`,
through a listener the drawer's own effect adds and removes. Resizing: `mousedown` on the handle adds
window `mousemove`/`mouseup` listeners, and `setHelpWidth(clampWidth(innerWidth − clientX, innerWidth))`
runs on each move. The listeners are removed on mouseup AND on unmount. While dragging, a body class
from the CSS Module sets the `col-resize` cursor and `user-select: none`. The width comes from
`helpWidth.value` as a `px` string.

- [ ] **Step 1: Write the failing tests.**
  - `help-figure.test.tsx`:
    - A child holding `data-help="a"` and `data-help="b"`, with callouts `a`, `b`, `missing`, renders 2 pins and 3 notes, and the frozen wrapper has the `inert` attribute.
    - `mouseenter` on note 2 marks pin 2 as hot and sets `data-hot` on the root; `mouseleave` clears both.
  - `help-drawer.test.tsx`:
    - Typing `token` leaves only the matching section.
    - Typing `zzz` shows `No help matches “zzz”.`.
    - Escape calls `onClose`, and after unmount Escape no longer does.
    - A drag from `clientX` 1000 to 700 with `innerWidth` 1440 calls `chrome.storage.local.set` with `{ helpDrawerWidth: 740 }`.
    - A mousemove after unmount changes nothing.
    - `loadHelpWidth` with a stored `'x'` gives `helpWidth.value === 480`; a stored `5000` gives the clamped value.
- [ ] **Step 2: Run** `npx vitest run tests/help-figure.test.tsx tests/help-drawer.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the four modules and `Help.module.css`, using the values in Global Constraints and the spec's "approved look" section.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run the gates.
- [ ] **Step 5: Commit** `feat(help): shared help drawer, frozen figure with callouts, remembered width`.

### Task 4: CIB help content, wired into the CIB page

**Files:**
- Create: `src/cib/help.tsx`
- Modify: `src/cib/components/App.tsx` (both connection bars; the drawer becomes a sibling of `<main>` inside `.app-root`, above the `if (!connected)` early return so both states render it)
- Test: `tests/cib-help.test.tsx`, plus two new cases in `tests/cib-app.test.tsx`

**Interfaces:**
- Consumes: Tasks 2 and 3; `verdict` and `PHASES` for the step 5 sample.
- Produces: `export const CIB_HELP: HelpSection[]`, with ids `what`, `before`, `step1` … `step5`, `trouble`.

**Content:** start from the spec's sections and figure table. **Check every sentence against the
code** (`cib.ts`, `engine.ts`, `release.ts`, `view.ts`) and the two CIB specs. List each claim with
the line that supports it in the commit body. Drop any claim with no supporting line. Keep the spec's
two settled points: no scope list (point to the release's required scopes and to Check naming what
is missing), and no "fills in by itself" (say the run stopped waiting after 180 s, and point to
Dataset Management).

- [ ] **Step 1: Write the failing tests.**
  - `cib-help.test.tsx`: for every section of `CIB_HELP` with figures, render its body and assert that every callout's target resolves inside its figure (the pin count equals the callout count). Assert that the page text contains no hostname other than `partner-sandbox.rossum.app` / `example.coupahost.com`.
  - `cib-app.test.tsx`, added cases (existing cases untouched):
    - The Help button opens the drawer titled `CIB deploy help`, and clicking it again closes it.
    - With `connected={false}`, the Help button exists and opens the drawer.
    - While a deploy is in flight (`deployCib` pending), the Help button is enabled and opens the drawer.
- [ ] **Step 2: Run** `npx vitest run tests/cib-help.test.tsx tests/cib-app.test.tsx`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** `src/cib/help.tsx` and the App.tsx wiring. App.tsx owns `helpOpen` state and calls `loadHelpWidth()` once.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run the gates.
- [ ] **Step 5: Commit** `feat(cib): in-app help drawer for CIB deploy`, with the claim-to-code list in the body.

### Task 5: Real-browser check and docs

**Files:**
- Modify: `CLAUDE.md` (Global prefs: add `helpDrawerWidth`; under Console apps, one paragraph on help: where it lives, that figures are real components with `data-help` hooks, and that a renamed hook fails `tests/cib-help.test.tsx`)

- [ ] **Step 1:** Run `npm run build`, load `dist/` unpacked in Chrome, open the Console from a Rossum tab, and open CIB at a 1440px window. If no org is available, use the not-connected state: help must work there.
- [ ] **Step 2:** Check the drawer at widths 360, 480 and the maximum. Every pin should sit on the top-right corner of its part. Hovering should outline only that part, and the drag should stop at its limits. Reload the page and check that the width is kept. Check dark mode (`prefers-color-scheme: dark`). Record what you saw in the commit body.
- [ ] **Step 3:** Update CLAUDE.md and run the gates.
- [ ] **Step 4: Commit** `docs: record the help drawer and its width pref`.

---

## Follow-up: the floating window (spec delta, 2026-11-03)

Tasks 1–5 built the drawer. The owner then chose a floating window instead (spec, "Delta,
2026-11-03"). These tasks replace the drawer's frame and keep everything inside it.

### Task 6: Floating help window

**Files:**
- Modify: `src/help/geometry.ts` (replace `HELP_WIDTH`, `FORM_MIN` and `clampWidth` with the window geometry below), `tests/help-geometry.test.ts`
- Rename: `src/help/HelpDrawer.tsx` → `src/help/HelpPanel.tsx` (the content: header, search, chips, sections, empty message; no frame, no resizer). Rename `tests/help-drawer.test.tsx` → `tests/help-panel.test.tsx`.
- Create: `src/help/HelpWindow.tsx` (the frame: position, move, resize, shield, Escape), `tests/help-window.test.tsx`
- Rename: `src/help/width.ts` → `src/help/rect.ts`
- Modify: `src/help/Help.module.css`, `src/cib/components/App.tsx`, `src/cib/help.tsx` if a type name moves, `tests/cib-app.test.tsx` (only the help cases)

**Interfaces:**
- `geometry.ts`:
  - `type WinRect = { x: number; y: number; w: number; h: number }`
  - `type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'`
  - `defaultRect(vw: number, vh: number): WinRect`: `{ x: vw − 480 − 12, y: 48, w: 480, h: vh − 48 − 12 }`, then clamped
  - `clampRect(r: unknown, vw: number, vh: number): WinRect`: a non-object, or any non-finite field, gives `defaultRect`. Otherwise `w ∈ [360, vw − 24]` and `h ∈ [320, vh − 24]`, with x and y pulled so the rect lies inside `[12, vw − 12] × [12, vh − 12]`. When the viewport is smaller than the minimum, the minimum wins and x = y = 12.
  - `moveRect(r0: WinRect, dx: number, dy: number, vw: number, vh: number): WinRect`
  - `resizeRect(r0: WinRect, edge: Edge, dx: number, dy: number, vw: number, vh: number): WinRect`: a west or north edge keeps the opposite edge fixed, also at the minimum size
  - `matchSections` and `fitZoom` unchanged
- `rect.ts`: `HELP_RECT_KEY = 'helpWindowRect'`, `helpRect = signal<WinRect | null>(null)` (null means not loaded yet; the window uses `defaultRect`), `loadHelpRect(): Promise<void>` (once; clamps), `saveHelpRect(r: WinRect): void`
- `HelpPanel({ title, placeholder, sections, onClose, titleBarProps? })`: `titleBarProps` is spread onto the header div, so the window can attach `onMouseDown` and the cursor class
- `HelpWindow({ title, placeholder, sections, onClose })`: renders `HelpPanel` inside the frame

- [ ] **Step 1: Write the failing tests.**
  - `help-geometry.test.ts`, at `vw=1440, vh=900`:
    - `defaultRect` → `{ x: 948, y: 48, w: 480, h: 840 }`
    - `clampRect({ x: 2000, y: -50, w: 480, h: 840 })` → `{ x: 948, y: 12, w: 480, h: 840 }`
    - `clampRect('x')` → `defaultRect`; `clampRect({ x: 0, y: 0, w: NaN, h: 1 })` → `defaultRect`
    - `clampRect({ x: 100, y: 100, w: 5000, h: 5000 })` → `{ x: 12, y: 12, w: 1416, h: 876 }`
    - `resizeRect(r, 'w', -100, 0)` on `{ x: 500, y: 100, w: 480, h: 500 }` → `{ x: 400, w: 580 }` with y and h unchanged
    - `resizeRect(r, 'nw', 500, 500)` on the same r → `{ x: 620, y: 280, w: 360, h: 320 }` (the minimum, with the opposite corner fixed)
    - `moveRect` past the right edge stops at `x = vw − w − 12`
    - At `vw=300, vh=200`: `clampRect` → `{ x: 12, y: 12, w: 360, h: 320 }`
  - `help-window.test.tsx`:
    - Opens at `defaultRect` when nothing is stored.
    - Opens at the stored rect when one is stored (clamped).
    - A mousedown on the header, a window mousemove of (−100, +50), then mouseup, moves the frame by that much. `chrome.storage.local.set` is called once, at mouseup, with `{ helpWindowRect: … }`.
    - A mousedown on the header's close button starts no move.
    - A drag on the `se` handle resizes the frame.
    - The shield exists during a drag, and is gone after mouseup and after an unmount mid-drag.
    - A mousemove after an unmount mid-drag changes nothing, flushed with `act`, deterministic: run the test with `--repeat 20` once and record the result.
    - Escape calls `onClose`. Escape with `preventDefault()` already called does not. Escape while the window's wrapper has `display: none` does not.
    - A browser-window `resize` event re-clamps the frame.
  - `help-panel.test.tsx`: the old drawer tests, minus resize and width. Add: two `<p>` in one section have a non-zero `margin` rule (assert the class hook the CSS uses).
  - `cib-app.test.tsx`: the three help cases now find the window. Add: Escape typed in the owner combobox leaves the help open.
- [ ] **Step 2: Run** `npx vitest run tests/help-geometry.test.ts tests/help-window.test.tsx tests/help-panel.test.tsx tests/cib-app.test.tsx`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.**
  - The frame is `position: fixed; z-index: 150`, radius 12px, `var(--glass-shadow)` plus a 1px `--border` ring. While dragging, the ring is `--accent`.
  - Edge hit areas are 8px, corner areas 14px. The `se` grip and the `<w> × <h>` size label follow the mockup at `.superpowers/brainstorm/mock-src/win.css` (throwaway; copy the values, not the selectors).
  - The window has `role="dialog"` and `aria-label={title}`, and is not modal.
  - Save on mouseup only. Remove every listener and the shield in a `useLayoutEffect` cleanup, through a stop ref, as the drawer does.
  - The Escape listener checks `e.defaultPrevented` and whether the frame is visible (`getClientRects().length > 0`). `OwnerCombobox`'s Escape handler must call `preventDefault()` if it does not already.
  - Add `.sec > p { margin: 0 0 8px }`, or whatever matches the body's rhythm; check it in the browser in Task 7.
- [ ] **Step 4: Run** the same command, then the full gates (`npm test`, `npm run typecheck`, `npm run format:check`). Everything must be green, including `tests/dead-code.test.ts`.
- [ ] **Step 5: Commit** `feat(help): a movable, resizable help window instead of the drawer`.

### Task 7: Measured browser check and docs

**Files:**
- Modify: `CLAUDE.md`. Rewrite the "Help drawer" paragraph as "Help window". Correct its two errors: figures are the REAL components frozen, not screenshots; and a missing `data-help` target renders NO pin (only its note), which `tests/cib-help.test.tsx` catches. Replace `helpDrawerWidth` with `helpWindowRect` in Global prefs.

- [ ] **Step 1:** `npm run build`. Launch `agent-browser --extension "$PWD/dist"` at 1440×900 and open the Console's CIB page (not-connected is enough).
- [ ] **Step 2: Measure, in numbers, through `agent-browser eval`.**
  - The window opens at `{ x: 948, y: 48, w: 480, h: 840 }`.
  - At window widths 360, 480 and 900, every pin's centre is within 3px of its target's top-right corner.
  - Hovering a note outlines only its own box.
  - A move and a resize through the mouse land at the expected rect, and a reload restores it.
  - The window stays inside the viewport when the viewport shrinks to 1024×700.
  - A modal (open one if the page has one; otherwise note that) covers the window.
  - Paragraph spacing shows.
  - Take a dark-mode screenshot.
  Put the numbers in a table.
- [ ] **Step 3:** Update CLAUDE.md, then run the gates.
- [ ] **Step 4: Commit** `docs: record the help window`, with the measurement table in the body.

### Task 8: Pink callout numbers (owner request, 2026-11-03)

**Files:** Modify `src/console/console.css` (tokens, in `:root` and in the FIRST `@media (prefers-color-scheme: dark)` `:root` block), `src/help/Help.module.css`.

- Add `--help-pin: #db2777; --help-pin-on: #ffffff;` in light mode and `--help-pin: #f472b6; --help-pin-on: var(--bg-card);` in dark mode. Contrast measured: #db2777 on white is 4.60:1, and #f472b6 on the dark card is 6.24:1.
- In the figure only, replace `--accent` with `--help-pin`:
  - the pin's ring and number at rest;
  - the hovered pin's fill, with `--help-pin-on` as its text colour;
  - the hovered box outline;
  - the note number;
  - the hovered note tint, as `color-mix(in srgb, var(--help-pin) 8%, var(--bg-card))`.
- The Help button, the window's drag ring and the search keep `--accent`.
- [ ] Gates green; a real-browser check (agent-browser, extension loaded) reads `getComputedStyle` of a pin, a hovered pin and a note number in light and dark mode, and records the values.
- [ ] Commit `feat(help): pink callout numbers`.
