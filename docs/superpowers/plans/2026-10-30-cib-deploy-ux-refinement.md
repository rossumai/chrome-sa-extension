# CIB deploy UX refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-lay out the CIB deploy Console app as the approved one-column, five-step page, with no change to what it requests or writes.

**Architecture:** The pure view decisions (phase states, verdict split, which login panel to show) go in one DOM-free module, `src/cib/view.ts`, which is unit tested. Four small Preact components render from it. `App.tsx` keeps every effect, every engine call and all run state. It only gains a few UI-state fields and composes the new components.

**Tech Stack:** Preact + `preact/hooks`, CSS Modules, Vitest + jsdom, TypeScript (`npm run typecheck`).

**Spec:** `docs/superpowers/specs/2026-10-30-cib-deploy-ux-refinement-design.md`. The mockup it names, `.superpowers/brainstorm/27385-1793351575/content/cib-deploy-v7.html`, is the visual reference for every CSS step. Copy its spacing, radii and colours.

## Global Constraints

- Every request, its order and every engine call stay as they are. `cib.ts`, `engine.ts` and `release.ts` change in exactly three strings: "press Deploy" → "press Check and deploy" (2 in `cib.ts`, 1 in `App.tsx`).
- Colours come only from existing tokens. There is no `--accent-bg`; accent tints are `color-mix(in srgb, var(--accent) N%, var(--bg-card))`.
- All new styles go in `src/cib/components/App.module.css`. No bare single-letter class names.
- Never write `\uXXXX` in JSX text. Paste `›`, `↗`, `✓`, `·`, or wrap them as `{'…'}`.
- Component imports spell `.jsx`. Tests that render JSX are `.test.tsx`.
- Fixtures use only `acme` / `example` placeholders.
- Button labels are exactly **Check only** and **Check and deploy**. The check-function buttons are **Create check function** and **Remove check function**.
- Run `npm run format` before each commit, and `npm run format:check` after it. The first format of a file may need two passes.

## Review Focus

1. **Typing a query that matches exactly one admin.** Today's auto-pick sets `owner`. The input must keep the typed text while it has focus, and show the label only after blur. Tested in Task 2.
2. **A run that throws during Check only, or a `listReleases` / check-function error.** No Resume button may appear. Tested in Task 5.
3. **The check function deleted elsewhere.** After the existing post-run re-sync sets `probe` to null while the radio says "organization", the panel must show "Create check function first", never "Ready". Tested in Task 3 (the panel is a pure function of `route` × `probe`).
4. **Switching to a v1.x release.** The Deploy tool field must still appear, and disappear again for v2.x. Tested in Task 5.
5. **The Organization ID edited away from the session value.** The "Filled from your session" hint must disappear. Tested in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/cib/view.ts` (create) | Pure: `PHASES`, `trackPhase`, `phaseStates`, `splitVerdict`, `loginPanel` |
| `src/cib/components/Step.tsx` (create) | Numbered step card (circle, connector line, title, subtitle, body, optional footer) |
| `src/cib/components/OwnerCombobox.tsx` (create) | Token-owner search-and-pick field |
| `src/cib/components/CoupaLoginStep.tsx` (create) | Step 3: radio cards and the one state panel |
| `src/cib/components/RunResult.tsx` (create) | Step 5: verdict, stats, blockers, notes, phases, details, log |
| `src/cib/components/App.tsx` (modify) | State and effects, unchanged; composes the above |
| `src/cib/components/App.module.css` (rewrite) | All styles |
| `src/cib/cib.ts:562,692` (modify) | Two strings |

---

### Task 1: Pure view module

**Files:**
- Create: `src/cib/view.ts`
- Test: `tests/cib-view.test.ts`

**Interfaces:**
- Consumes: `Progress` from `src/cib/engine.ts`.
- Produces:
  - `PHASES: [key: string, label: string, readOnly: boolean][]`, in this order and with these labels:
    `release` "Read the release" (ro), `checks` "Checks" (ro), `objects` "Create objects", `patches` "Secrets and hooks", `memorisation` "Memorisation collections", `imports` "Start Coupa imports", `restore` "Full first import", `datasets` "Wait for datasets".
  - `type PhaseLog = { counts: Record<string, { done: number; total: number }>; current: string | null }`
  - `trackPhase(log: PhaseLog, p: Progress): PhaseLog`
  - `type PhaseState = 'done' | 'now' | 'fail' | 'idle'`
  - `phaseStates(log: PhaseLog, end: 'running' | 'ok' | 'fail'): PhaseState[]` (one per `PHASES` entry)
  - `splitVerdict(text: string): { head: string; rest: string }`
  - `type LoginRoute = 'browser' | 'org'`
  - `loginPanel(route: LoginRoute, probe: boolean): 'browser-ready' | 'create' | 'org-ready' | 'stale'`

- [ ] **Step 1: Write the failing tests**

```ts
test('trackPhase keeps the last count of every phase and moves current', () => {
  let l: PhaseLog = { counts: {}, current: null };
  l = trackPhase(l, { phase: 'release', done: 3, total: 3 });
  l = trackPhase(l, { phase: 'objects', done: 5, total: 9 });
  expect(l.counts).toEqual({ release: { done: 3, total: 3 }, objects: { done: 5, total: 9 } });
  expect(l.current).toBe('objects');
});
test('phaseStates: earlier reported = done, current by end, unreported = idle', () => {
  const l = { counts: { release: {done:1,total:1}, checks: {done:0,total:6} }, current: 'checks' };
  expect(phaseStates(l, 'running').slice(0, 3)).toEqual(['done', 'now', 'idle']);
  expect(phaseStates(l, 'fail')[1]).toBe('fail');
  expect(phaseStates(l, 'ok')[1]).toBe('done');
  expect(phaseStates(l, 'ok')[6]).toBe('idle'); // restore never reported
});
test('splitVerdict splits at the first colon', () => {
  expect(splitVerdict('Blocked: nothing was written. Fix: x')).toEqual({ head: 'Blocked', rest: 'nothing was written. Fix: x' });
  expect(splitVerdict('No colon')).toEqual({ head: 'No colon', rest: '' });
});
test('loginPanel covers the four route × probe cases', () => {
  expect(loginPanel('browser', false)).toBe('browser-ready');
  expect(loginPanel('org', false)).toBe('create');
  expect(loginPanel('org', true)).toBe('org-ready');
  expect(loginPanel('browser', true)).toBe('stale');
});
```

- [ ] **Step 2: Run, expect FAIL** (module not found): `npx vitest run tests/cib-view.test.ts`
- [ ] **Step 3: Implement `src/cib/view.ts`** with the signatures above. Add a header comment: pure view decisions for the CIB page; no DOM.
- [ ] **Step 4: Run, expect PASS.** Then `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(cib): pure view helpers for the refined deploy page`

---

### Task 2: Token-owner combobox

**Files:**
- Create: `src/cib/components/OwnerCombobox.tsx`
- Modify: `src/cib/components/App.module.css` (append the combobox styles)
- Test: `tests/cib-owner-combobox.test.tsx`

**Interfaces:**
- Produces:
  - `type Owner = { username: string; name: string; email: string }`
  - `default function OwnerCombobox(props: { query: string; owner: string; label: string; owners: Owner[]; orgId: string; onQuery: (q: string) => void; onPick: (o: Owner) => void })`
  - `ownerLabel(o: Owner): string`, which returns `"username · name"`, or the username alone when the name is empty.

Behaviour:
- The input shows `query` while it has focus. After blur, it shows `label` when `owner` is set, else `query`.
- Typing calls `onQuery`.
- The listbox opens on focus and on input.
- Each row shows initials, the username, and `name · email`.
- The keys: ↑/↓ move the active row, Enter picks it, Escape closes the list.
- Mouse-down on a row picks it, using `preventDefault` so the input does not lose focus first.
- After a pick, the list closes and the input is blurred.
- Empty-list text: "No active admin matches. The hooks need an admin of this organization."
- Footer: "Up to 10 matches. Type to narrow."
- Hint: "The CIB hooks run as this user. Only active admins of organization {orgId} are listed."
- ARIA: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, and `role="listbox"` / `role="option"`.

- [ ] **Step 1: Write the failing tests**:
  - `typing calls onQuery with the text`.
  - `ArrowDown then Enter picks the first owner` asserts `onPick` was called with `owners[0]`.
  - `after a pick and blur the input shows the label`: re-render with `owner` and `label` set, blur, and check `input.value === 'jnovak · Jana Novak'`.
  - `while focused the input keeps the typed query even if owner is set` (Review Focus 1): render with `query: 'jan'`, `owner: 'jnovak'` and `label` set, focus, and check `input.value === 'jan'`.
  - `empty owners shows the no-match text`.
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/cib-owner-combobox.test.tsx`
- [ ] **Step 3: Implement** the component and its CSS, following the mockup's `.combo-*` / `.avatar` / `.input-wrap .lead` rules.
- [ ] **Step 4: Run, expect PASS.** Then `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(cib): one search-and-pick field for the token owner`

---

### Task 3: Coupa login step

**Files:**
- Create: `src/cib/components/CoupaLoginStep.tsx`
- Modify: `App.module.css` (append the `.route*`, `.setup*` styles from the mockup)
- Test: `tests/cib-login-step.test.tsx`

**Interfaces:**
- Consumes: `loginPanel` and `LoginRoute` from Task 1.
- Produces: `default function CoupaLoginStep(props: { route: LoginRoute; probe: string | null; probePage: string | null; busy: boolean; onRoute: (r: LoginRoute) => void; onCreate: () => void; onRemove: () => void })`. It renders the card BODY only; Task 5 wraps it in `Step`.

The copy is verbatim from spec §4.2 step 3: the question, the two radio cards, and the four panels. `probePage` is the hook-page URL used for the link in `org-ready`. The buttons have `type="button"` and are disabled while `busy`.

- [ ] **Step 1: Write the failing tests.**
  - One `it.each` over the four `(route, probe)` cases. It asserts the panel heading text:
    - "Ready. Nothing to set up."
    - "Create the check function first"
    - "Ready. Check logs in from the organization."
    - "A check function still exists in this org"
  - It also asserts which button exists:
    - none
    - "Create check function" calls `onCreate`
    - "Remove check function" calls `onRemove`
    - "Remove check function" calls `onRemove`
  - A test that clicking the second radio calls `onRoute('org')`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Use real `<input type="radio" name="cib-route">` inside each label card. Style the checked card with `:has(input:checked)`; Chrome supports it.
- [ ] **Step 4: Run, expect PASS.** Then `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(cib): explain the Coupa login test and show only the fitting action`

---

### Task 4: Run result

**Files:**
- Create: `src/cib/components/RunResult.tsx`
- Modify: `App.module.css` (append the `.verdict*`, `.stat*`, `.phase*`, `.issue*`, `.log` styles)
- Test: `tests/cib-run-result.test.tsx`

**Interfaces:**
- Consumes: `PHASES`, `PhaseLog`, `phaseStates` and `splitVerdict` from Task 1, and `verdict` from `cib.ts` (its return type).
- Produces:
  - `type RunView = { mode: 'check' | 'deploy'; running: boolean; failed: boolean; status: string; clock: string; detail?: string; phases: PhaseLog; outcome: { status: string; verdict: { tone: 'ok' | 'warn' | 'fail'; text: string }; blockers?: string[]; notes: string[]; details: string; stats?: { objects: number; started: number; invoked: number; pending: number } } | null; log: string; probeLeft: boolean }`
  - `default function RunResult(props: { run: RunView })`. It renders the step 5 card body, and the title through a named export `runTitle(run: RunView, version: string): string`, which returns one of:
    - "Deploying CIB {v}"
    - "Check result"
    - "Deploy result"
    - "Deploy stopped"

Rules (spec §4.2 step 5):
- The verdict box shows the `splitVerdict` head in bold and the rest below it.
- The stats tiles appear only when `stats` is set. The "missing" tile uses the warning colour when `pending > 0`.
- The blockers heading is "Blockers" with a count. The notes heading is "Notes, not blocking" when there are blockers, else "Notes".
- When `probeLeft` is true and `outcome.status === 'done'`, add the note "The Coupa check function is still deployed. Remove it in step 3."
- The phases are shown as an 8-segment bar plus a two-column list. Each phase's count is `done/total` from `phases.counts`.
- Details (JSON) is shown only when `details !== '{}'`.
- The log is a `<details>` that starts open only when `failed`. It has a Copy button that calls `navigator.clipboard.writeText(log)`; guard it for jsdom.

- [ ] **Step 1: Write the failing tests.**
  - A blocked check renders "Blocked" in bold and both blockers verbatim, under "Notes, not blocking".
  - A finished deploy with `pending: 1` renders the three stats and gives the missing tile the warning class.
  - `probeLeft` adds the check-function note only for `done`.
  - While running, the current phase has the `now` state and the verdict box is absent.
  - The log starts open only when failed.
  - `runTitle` returns each of its four strings.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** Then `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(cib): readable run result with phases`

---

### Task 5: Compose the page in App.tsx

**Files:**
- Create: `src/cib/components/Step.tsx`
- Modify: `src/cib/components/App.tsx`, `App.module.css` (page, hero, step, field, action styles; delete the rules nothing uses any more), `src/cib/cib.ts:562,692`
- Test: `tests/cib-app.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `Step(props: { n: string | number; state?: 'complete' | 'current' | 'optional'; title: ComponentChildren; sub?: ComponentChildren; meta?: string; footer?: ComponentChildren; children })`.

App changes. Keep every existing effect and call in place, and their order.
- **New state:**
  - `ownerLabel`
  - `route: LoginRoute` (set once, to `'org'`, when the load-time `findCoupaProbes` finds a hook)
  - `phases: PhaseLog` (reset at run start; fed by `trackPhase` inside the existing `progress` callback)
  - `mode: 'check' | 'deploy' | null` (set at run start)
  - `canResume` (set to `!checkOnly` in `run`'s catch; cleared at the start of `run` and of `probeAction`)
  - `sessionOrg` (the id the org effect prefilled)
- **`owners`** now hold `{ username, name, email }` from the same users response. The single-match auto-pick also sets `ownerLabel`. `onQuery` sets `ownerQuery`, and clears `owner` and `ownerLabel`.
- **The form** is wrapped in `<fieldset disabled={busy}>` with its border reset, so every control locks during a run. The Resume button sits outside the fieldset.
- **The submit buttons** keep `name="check"` / `name="deploy"`, so the existing `onSubmit` is unchanged.
- **The error box** sits at the top of the column. It shows **Resume deploy** only when `canResume`, and that button calls `run(false)`. The error suffix becomes "— press Check and deploy again with the same run ID to resume".
- **The page:**
  - The hero has the title, the sentence and the repo link `https://github.com/${CIB_REPO}`.
  - Step 1:
    - The version hint links `https://github.com/${CIB_REPO}/releases/tag/${v.version}`.
    - The org hint "✓ Filled from your session" shows only when `v.org === sessionOrg`.
    - The tool-ref field keeps its v1.x condition.
  - Step 2: Coupa URL on its own row; ID and secret side by side, with a Show/Hide toggle on the secret; the lock footer.
  - Step 3 is `CoupaLoginStep`.
  - Step 4:
    - a `<details>` "Resume and re-run · run ID {run}" holding the Run ID field and the checkbox, with the spec's hints
    - then the divider
    - then **Check only** / **Check and deploy**
  - Step 5 is `RunResult`, rendered only after the first run. It calls `scrollIntoView({ block: 'start' })` when a run starts; guard it for jsdom.
- **Step ticks:**
  - Step 1 is `complete` when version, org, region and owner are all set.
  - Step 2 is `complete` when all three credentials are set.
  - Step 3 is `optional`.
  - The first incomplete required step is `current`.
- **`cib.ts`:** in the two strings, `press Deploy` becomes `press Check and deploy`.
- **`outcome.stats`** is computed in `run` from the `deployCib` result, the same way `verdict()` does: `objects = Object.keys(idmap ?? {}).length`, `started` = invoked with a 2xx status, `invoked = invoked.length`, `pending = pendingImports.length`. Set it only when `status === 'done'`.
- **Step cards** must NOT use `overflow: hidden`, or the combobox dropdown is clipped.

- [ ] **Step 1: Write the failing tests.**
  - Mock `../src/cib/release.js` (`listReleases` → `['v2.1.0', 'v1.4.2']`), the `makeClient` export of `../src/cib/engine.js` (a `call`/`list` fake: `organizations` → one org with id `123456`, `groups` → `[]`, `users` → one admin), and the `findCoupaProbes` / `deployCib` exports of `../src/cib/cib.js`. Set `connected`, `domain` and `token` in `../src/cib/store.js`.
  - `Check only failure shows no Resume button` (Review Focus 2): `deployCib` rejects, click "Check only", the error shows, and no "Resume deploy" button exists.
  - `Check and deploy failure shows Resume, which runs a deploy again`: `deployCib` rejects once, then resolves `{ status: 'done', … }`. After the click, `deployCib` has 2 calls and the second has `checkOnly: false`.
  - `the form is locked while a run is in flight`: `deployCib` returns a pending promise, and the fieldset is `disabled`.
  - `a v1.x version shows the Deploy tool field` (Review Focus 4).
  - `editing the org id hides the session hint` (Review Focus 5).
  - `the buttons are labelled Check only and Check and deploy`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the changes above. Remove the old `.formCard`/`.stepBadge*`/`.credRow`/`.actionCard`/`.checkRow` rules. The dead-code test does not see dead CSS, so grep each class name in `src/cib` before deleting its rule.
- [ ] **Step 4: Run, expect PASS**:
  - `npx vitest run tests/cib-*.test.ts* tests/console-shell.test.tsx`
  - `npm test` (with the dead-code and css-collision guards)
  - `npm run typecheck`
  - `npm run format:check`
- [ ] **Step 5: Build and diff the request path.**
  - Run `npm run build`.
  - Then run `git diff master -- src/cib/cib.ts src/cib/engine.ts src/cib/release.ts`. Expected: only the two string changes.
- [ ] **Step 6: Commit** `feat(cib): one-column deploy page with numbered steps`

---

### Task 6: Visual check in a real browser

jsdom has no layout, so this task closes what tests cannot.

- [ ] **Step 1:** Run `npm run build`. Load `dist/` unpacked, open a Rossum tab on a test org, and open the Console's CIB app. Do not press Check and deploy.
- [ ] **Step 2:** Compare the page with the v7 mockup in light and dark mode. Check:
  - the step line and circles
  - the combobox dropdown, which must not be clipped by the card
  - the radio cards
  - step 4's order
  - nothing wider than the column at a 1280px window
- [ ] **Step 3:** Press **Check only** with dummy credentials. Expect step 5 to appear, scroll into view, and show the blocked verdict and phases. Nothing is written.
- [ ] **Step 4:** Fix whatever differs, re-run `npm test`, and commit `fix(cib): visual polish after browser check`.
