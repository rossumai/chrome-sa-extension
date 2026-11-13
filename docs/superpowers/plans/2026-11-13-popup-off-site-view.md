# Popup off Rossum, NetSuite and Coupa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the popup's "This tab isn't supported" view with a tab launcher (unrelated
tabs), a Console-tab view (org, token, app list that switches that tab), and an unlock
notice that never joins the footer row.

**Architecture:** Pure helpers (`src/popup/offSite.ts`, `src/console/boot.ts`) carry every
decision; two thin components (`OffSite.tsx`, `ConsoleView.tsx`) render them. The popup
reaches a Console tab through `chrome.extension.getViews({ type: 'tab', tabId })` and
switches its app with a `CustomEvent` the Console listens for. The rail's app list moves to
one CSS-free module both surfaces import.

**Tech Stack:** Preact + `@preact/signals`, TypeScript, esbuild, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-13-popup-off-site-view-design.md`

## Global Constraints

- **`getViews` is proven** (2026-11-13, Chrome for Testing 150, unpacked `dist/`): from
  `popup.html`, `chrome.extension.getViews({ type: 'tab', tabId })` returned the Console
  window; `sessionStorage.getItem('consoleToken')` read back, and a `CustomEvent`
  dispatched on that window reached the Console's listener. `consoleActiveApp` is only
  written when the Console has credentials, so it can be absent. The spec's fallback is
  not needed.
- The shared app module imports NO CSS (`build.js` copies `src/popup/popup.css` to
  `dist/popup/popup.css`; a CSS Module in the popup bundle would emit at the same path).
- `src/popup/tab-readers.ts` functions are serialized into the page: no imports, no
  closures.
- Popup styles go in `src/popup/popup.css` only; no bare one- or two-letter class names.
- No new usage events. Token copy reuses `sa_popup_copy_token`.
- JSX text: no `\uXXXX` in raw text; use `{'…'}` or the literal character.
- Copy, verbatim: "Nothing to do on this tab. Jump to an open Rossum tab:" · "No Rossum tab
  is open. Pick up where you left off:" · "Open Rossum tabs" / "most recent first" ·
  "Recent organizations" · "Also works on NetSuite and Coupa." · "Switch app in this tab" ·
  "This Console is connected to" · "Rossum tab" · "Experimental features unlocked" ·
  "Academy, rdc added" · "Experimental features hidden" · "switched to Data".
- App descriptions, verbatim: mdh "Dataset Management", audit "Audit Log Viewer", cib
  "Coupa baseline deploy", builder "Schema Builder", inspector "Annotation Inspector",
  fabry "Mr. Fabry chat", galaxy "Org as a 3D graph", academy "Onboarding training", rdc
  "Deployments between orgs".
- Do NOT commit: the owner commits. Work on a branch if one is asked for.

## Review Focus

1. **A Console tab with no credentials** (opened without auth, or after its session
   expired): no org card, Copy token disabled, the app list still switches. → Task 6 test
   `console view without a token`.
2. **A digit key while focus is in a text input** — there is none in these views today,
   but a key handler on `document` must ignore events whose target is an input/textarea
   so a future field does not jump tabs. → Task 5 test `ignores digits typed into an input`.
3. **A Rossum tab whose org cache belongs to an old token** — `writeCache` keeps one entry
   per tab, but the reader must still reject an expired or malformed entry (`cachedOrg`
   returns null) and fall back to the title. → Task 5 test `falls back to the title on an expired cache`.
4. **Two Console tabs** — the popup must read and switch the ACTIVE Console tab (`tab.id`),
   never the first view `getViews` returns. → Task 3 test `reads the view for the given tab id`.
5. **Unlock while the Console is on a gated app** — the notice says "switched to Data" only
   when the Console's app actually was `academy` or `rdc`. → Task 7 test.

---

### Task 1: One app list for the rail and the popup

**Files:**
- Create: `src/ui/fabryStar.ts`, `src/console/apps.tsx`
- Modify: `src/ui/FabryMark.tsx` (import `STAR_PATH` from `fabryStar.ts`),
  `src/console/components/Rail.tsx` (import `APPS`; delete its local icons and list)
- Test: `tests/console-apps.test.ts`; `tests/console-rail.test.tsx` must pass unchanged

**Interfaces:**
- Produces:
  - `export const STAR_PATH: string` in `src/ui/fabryStar.ts`.
  - `export type ConsoleApp = { id: AppId; label: string; title: string; description: string; icon: preact.JSX.Element; beta?: boolean; exp?: boolean; gated?: boolean; muted?: boolean }`
  - `export const APPS: readonly ConsoleApp[]` — rail order: mdh, audit, cib, builder,
    inspector, fabry, galaxy, academy, rdc. Labels, titles, flags exactly as `Rail.tsx` has
    them today; descriptions from Global Constraints. The fabry `icon` is a plain
    `<svg viewBox="0 0 24 24" fill="currentColor"><path d={STAR_PATH} /></svg>` at 20px.
  - `export function visibleApps(unlocked: boolean): ConsoleApp[]` — drops `gated` unless unlocked.
- The Rail keeps rendering `<FabryMark size={20} animated={false} />` for fabry (its test
  asserts that); every other icon comes from `APPS`.

- [ ] **Step 1: Write `tests/console-apps.test.ts`**
  - `visibleApps(false).map(a => a.id)` equals `['mdh','audit','cib','builder','inspector','fabry','galaxy']`.
  - `visibleApps(true).map(a => a.id)` ends with `['academy','rdc']`, length 9.
  - every app has a non-empty `description`; `APPS.find(a => a.id==='builder').beta === true`;
    academy and rdc have `exp` and `gated`.
  - `readFileSync('src/console/apps.tsx')` and `src/ui/fabryStar.ts` contain no `.css` import
    (regex `/import[^;]*\.css['"]/`).
- [ ] **Step 2: Run** `npx vitest run tests/console-apps.test.ts` — FAIL (module missing).
- [ ] **Step 3: Create the two modules and switch `Rail.tsx` and `FabryMark.tsx` to them.**
- [ ] **Step 4: Run** `npx vitest run tests/console-apps.test.ts tests/console-rail.test.tsx tests/ui-fabry-mark.test.tsx` — PASS.
- [ ] **Step 5: Run** `npm run typecheck && npx vitest run tests/dead-code.test.ts` — PASS.

### Task 2: Pure popup helpers

**Files:**
- Create: `src/popup/offSite.ts`
- Test: `tests/popup-off-site-helpers.test.ts`

**Interfaces:**
- Consumes: `annotationIdFromPath` (`src/rossum/annotationUrl.ts`), `ViewedEntry` (`src/inspector/viewed.ts`).
- Produces:
  - `tabPlace(url: string): string | null` — `Document <id>` when `annotationIdFromPath`
    matches; `Queue <id>` for a path starting `/queues/<digits>`; `Settings` for a path
    starting `/settings`; else `null`.
  - `recentOrigins(viewed: unknown): { origin: string; at: number }[]` — distinct origins,
    first (newest) `at` of each, in list order; non-array or malformed entries ignored.
  - `relativeTime(at: number, now: number): string` — `just now` (< 1 min), `N min ago`,
    `N h ago` (< 24 h), `yesterday` (< 48 h), else `N d ago`.
  - `rowForKey(e: { key: string; target?: EventTarget | null; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }, count: number): number | null`
    — `Enter` → 0 when count > 0; `'1'..'9'` → index when < count; `null` for anything
    else, for any modifier, and when `target` is an `input`, `textarea`, `select` or
    contenteditable element.

- [ ] **Step 1: Write the tests.** Cases: `tabPlace('https://acme.rossum.app/document/9104377')` → `'Document 9104377'`;
  `…/queues/3311/all` → `'Queue 3311'`; `…/settings/extensions` → `'Settings'`; `…/documents` → `null`.
  `recentOrigins([{id:'1',origin:'https://a',at:3},{id:'2',origin:'https://b',at:2},{id:'3',origin:'https://a',at:1}])`
  → `[{origin:'https://a',at:3},{origin:'https://b',at:2}]`; `recentOrigins(null)` → `[]`.
  `relativeTime(now - 2*3600e3, now)` → `'2 h ago'`; `now - 30*3600e3` → `'yesterday'`.
  `rowForKey({key:'Enter'}, 3)` → 0; `{key:'3'}`,3 → 2; `{key:'4'}`,3 → null;
  `{key:'1', metaKey:true}`,3 → null; **`ignores digits typed into an input`**:
  `{key:'1', target: document.createElement('input')}`,3 → null (file is `// @vitest-environment jsdom`).
- [ ] **Step 2: Run** `npx vitest run tests/popup-off-site-helpers.test.ts` — FAIL.
- [ ] **Step 3: Implement** `src/popup/offSite.ts`.
- [ ] **Step 4: Run** the same command — PASS.

### Task 3: Reaching a Console tab, and the Console's listener

**Files:**
- Create: `src/popup/consoleTab.ts`
- Modify: `src/console/boot.ts` (pure additions), `src/console/index.tsx` (listener in `boot()`)
- Test: `tests/popup-console-tab.test.ts`, `tests/console-boot.test.ts` (add cases)

**Interfaces:**
- Produces, in `src/console/boot.ts`:
  - `export const SET_APP_EVENT = 'sa-console-set-app'`
  - `export function requestedApp(detail: unknown, unlocked: boolean): AppId | null` —
    `null` unless `isValidApp(detail)` and (not gated or unlocked).
- Produces, in `src/popup/consoleTab.ts`:
  - `export type ConsoleTabState = { token: string | null; domain: string | null; app: AppId | null }`
  - `readConsoleTab(tabId: number): ConsoleTabState | null` — `null` when no view; reads
    `consoleToken`, `consoleDomain`, and `consoleActiveApp` (JSON-encoded; invalid → `null`).
  - `setConsoleApp(tabId: number, app: AppId): boolean` — dispatches
    `new view.CustomEvent(SET_APP_EVENT, { detail: app })` on the view; `false` when no view.
  - Both wrap `chrome.extension?.getViews` in try/catch and treat a throw as "no view".
- In `index.tsx` `boot()`, before the no-credentials early return:
  `window.addEventListener(SET_APP_EVENT, (e) => { const app = requestedApp((e as CustomEvent).detail, experimentalUnlocked.value); if (app) activeApp.value = app; })`.

- [ ] **Step 1: Write the tests.** boot: `requestedApp('builder', false)` → `'builder'`;
  `('rdc', false)` → null; `('rdc', true)` → `'rdc'`; `('nope', true)` → null.
  consoleTab, with `chrome.extension.getViews` stubbed to return a fake window
  `{ sessionStorage: <Map-backed>, CustomEvent, dispatchEvent: vi.fn() }` only when
  `tabId === 7`: **`reads the view for the given tab id`** — `readConsoleTab(7)` returns
  token, domain and `app: 'audit'` from `'"audit"'`, and `getViews` was called with
  `{ type: 'tab', tabId: 7 }`; `readConsoleTab(8)` → null; `consoleActiveApp` = `'garbage'` →
  `app: null`; `setConsoleApp(7,'galaxy')` → true and `dispatchEvent` got an event with
  `type === 'sa-console-set-app'` and `detail === 'galaxy'`; `getViews` throwing → null / false.
- [ ] **Step 2: Run** `npx vitest run tests/popup-console-tab.test.ts tests/console-boot.test.ts` — FAIL.
- [ ] **Step 3: Implement** both modules and the listener.
- [ ] **Step 4: Run** the same command — PASS. Then `npm run typecheck`.

### Task 4: Per-tab readers and `openConsoleTab` in the tab's window

**Files:**
- Modify: `src/popup/tab-readers.ts`, `src/popup/utils.ts:75-92`
- Test: `tests/popup-tab-readers.test.ts`, `tests/popup-utils.test.ts`

**Interfaces:**
- Produces:
  - `readOrgCache(prefix: string): string | null` in `tab-readers.ts` — the raw value of
    the first `sessionStorage` key starting with `prefix`, else `null`. Self-contained.
  - `openConsoleTab(tab: { index: number; windowId?: number } | undefined, authData, app)` —
    adds `windowId` to `chrome.tabs.create` when the tab has one. Existing callers unchanged.

- [ ] **Step 1: Write the tests.** `readOrgCache('rossum-sa-extension-org:')` returns the
  stored string, and `null` with no such key. `openConsoleTab({index: 4, windowId: 9}, {…}, 'mdh')`
  creates with `{ url, index: 5, windowId: 9 }`; `openConsoleTab({index: 4}, …)` has no `windowId`.
- [ ] **Step 2: Run** `npx vitest run tests/popup-tab-readers.test.ts tests/popup-utils.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command — PASS.

### Task 5: Unrelated-tab view (spec views A and B)

**Files:**
- Create: `src/popup/components/OffSite.tsx`
- Modify: `src/popup/components/App.tsx` (render `OffSite` when `!site && !isConsole`;
  delete `UnsupportedSite`), `src/popup/popup.css` (new classes; delete `.unsupported-*`,
  `.supported-site*`, `.rossum-tab-*`, including their rules inside the dark-mode block
  near line 1332 — see the CSS traps in CLAUDE.md)
- Test: replace `tests/popup-unsupported-site.test.tsx` with `tests/popup-off-site.test.tsx`

**Interfaces:**
- Consumes: Task 2 helpers; `readOrgCache`, `readAuthInfo`; `cachedOrg`, `ORG_CACHE_PREFIX`,
  `orgNameOn`; `VIEWED_KEY`; `runInTab`, `activateTab`, `openConsoleTab`; `track`.
- Produces: `OffSite({ tabs, viewed, orgNameEnabled, orgEnvEnabled, notice }: { tabs: chrome.tabs.Tab[] | null; viewed: unknown; orgNameEnabled: boolean; orgEnvEnabled: boolean; notice: UnlockNotice | null })`
  where `UnlockNotice = { unlocked: boolean; fellBack: boolean }` is exported from
  `src/popup/offSite.ts` (Task 7 fills `fellBack`).
- App reads `VIEWED_KEY` from `chrome.storage.local` alongside its other keys.

Behaviour (from the spec, view A/B): rows newest first, row 1 ringed; title = org name +
id (+ chip when `orgEnvEnabled`) from `cachedOrg(raw, Date.now())`, and the name only when
`orgNameEnabled`; else `tab.title || host`. Second line `tabPlace(url)` + `·` + host.
Console button → `runInTab(row.id, readAuthInfo)` then `openConsoleTab(row, auth, 'mdh')`
and `window.close()`; key → clipboard, `sa_popup_copy_token`, "Copied" for 1.6 s. Errors use
the existing `.tool-notice` markup and wording. Keys via `rowForKey` on a `keydown`
listener owned by the component's effect; Escape → `window.close()`. With no tabs: recent
origins, each opening `chrome.tabs.create({ url: origin })`; Enter/1–9 open them. The note
line is replaced by the notice while `notice` is set (Task 7 styles it).

- [ ] **Step 1: Write `tests/popup-off-site.test.tsx`** (render `OffSite` directly; stub
  `chrome.scripting.executeScript` per tab id):
  - shows "Nothing to do on this tab" and never "isn't supported";
  - row title is "Acme Corp" + "482113" from a fresh cache entry; no `.pv-env`-style chip
    unless `orgEnvEnabled` (assert on the chip's class you choose);
  - **`falls back to the title on an expired cache`** (`at` 25 h ago) and with
    `orgNameEnabled: false`;
  - second line contains "Document 9104377" and the host;
  - Console click → `chrome.tabs.create` called with `windowId` of that row;
  - key click → `navigator.clipboard.writeText(token)` for that row's tab;
  - `keydown` `'2'` → `chrome.tabs.update(row2.id, { active: true })`; `Enter` → row 1;
  - no tabs + viewed for two origins → two rows, in order, and no "Works on Rossum" text;
    "Also works on NetSuite and Coupa." present.
- [ ] **Step 2: Run** `npx vitest run tests/popup-off-site.test.tsx` — FAIL.
- [ ] **Step 3: Implement `OffSite.tsx`, wire it in `App.tsx`, add CSS.** Spacing per the
  mockup (16px side gutter, 18px between sections, 8px between rows, 10–12px row padding).
- [ ] **Step 4: Run** `npx vitest run tests/popup-off-site.test.tsx tests/popup-copy-token.test.tsx` — PASS.

### Task 6: Console-tab view (spec view C)

**Files:**
- Create: `src/popup/components/ConsoleView.tsx`
- Modify: `src/popup/components/App.tsx` (render it when `isConsole`; header actions for
  the Console: key + "Rossum tab ↗"), `src/popup/popup.css`
- Test: `tests/popup-console-view.test.tsx`

**Interfaces:**
- Consumes: `visibleApps`, `readConsoleTab`, `setConsoleApp`, `rowForKey`, `loadOrg`,
  `orgLabel`, `fetchJson` (`src/popup/mdh-provenance.ts`), `findRossumTabs`, `activateTab`.
- Produces: `ConsoleView({ tabId, unlocked, orgNameEnabled, orgEnvEnabled, notice })`.
  The header's two buttons live in `App.tsx` and use `readConsoleTab(tab.id)` too.

Behaviour (spec view C): org card loaded by `loadOrg({ get: (p) => fetchJson(domain + p, token), withLocation: true, show })`
only when token, domain and `orgNameEnabled`; shows the host alone until then; chip by
`orgEnvEnabled`. List = `visibleApps(unlocked)`, numbered, current app marked "here".
Click / digit → `setConsoleApp(tabId, id)` then `window.close()` (current app: close only).
Copy token from `readConsoleTab` (records `sa_popup_copy_token`, "Copied" for 1.6 s);
disabled without a token. Rossum tab ↗ →
`activateTab` on the newest Rossum tab with `new URL(t.url).origin === domain`, else
`chrome.tabs.create({ url: domain })`; hidden without a domain.

- [ ] **Step 1: Write the tests** (stub `getViews` as in Task 3, `fetch` for `/api/v1/organizations`):
  - 7 numbered rows in rail order with "Dataset Management" etc.; 9 when `unlocked`;
  - row for `app` from the session is marked "here";
  - click "Galaxy" → `dispatchEvent` with detail `'galaxy'`;
  - org card shows "Example" and "517920" after the fetch resolves; with `orgNameEnabled: false`
    no fetch is made and the host shows;
  - **`console view without a token`**: no fetch, no org card name, key button disabled,
    clicking an app still dispatches;
  - Rossum tab ↗ activates the matching tab, or creates `{ url: domain }` when none matches.
- [ ] **Step 2: Run** `npx vitest run tests/popup-console-view.test.tsx` — FAIL.
- [ ] **Step 3: Implement and wire.**
- [ ] **Step 4: Run** the same command — PASS.

### Task 7: The unlock / hide notice (spec view D)

**Files:**
- Modify: `src/popup/components/App.tsx` (`onVersionClick`, footer), `OffSite.tsx`,
  `ConsoleView.tsx`, `src/popup/popup.css`
- Test: `tests/popup-training-gate.test.tsx` (existing notice test must still pass),
  `tests/popup-unlock-notice.test.tsx` (new)

**Interfaces:**
- `App` state `unlockNotice: UnlockNotice | null`, set for 2500 ms. `fellBack` is true only
  when hiding while `readConsoleTab(tab.id)?.app` is `academy` or `rdc`.
- The notice element keeps the class `unlock-notice` (the existing test queries it).

Copy: unlocked → `[exp] Experimental features unlocked` + `Academy, rdc added`; hidden →
`Experimental features hidden` (+ `switched to Data` when `fellBack`). On the Console it
replaces the list's label; on `OffSite` it replaces the note line; on Rossum / NetSuite /
Coupa it replaces the content of `.footer-left`. While unlocked-notice shows on the
Console, academy and rdc rows carry a "new" class.

- [ ] **Step 1: Write `tests/popup-unlock-notice.test.tsx`:** after 5 version clicks on an
  unrelated tab, `.footer` contains no `.unlock-notice` and the note line does; on a
  Rossum tab, `.footer-left` holds the notice and `.footer` has exactly two children;
  on the Console with app `rdc`, hiding shows "switched to Data", with app `audit` it does not.
- [ ] **Step 2: Run** `npx vitest run tests/popup-unlock-notice.test.tsx tests/popup-training-gate.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command — PASS.

### Task 8: Gates, a real browser, and the docs

**Files:**
- Modify: `CLAUDE.md` (Popup bullet under Other surfaces; spec under "Where the design
  detail lives"), `src/popup/popup.css` (only if the browser check finds something)

- [ ] **Step 1: Run** `npm run format && npm run format:check && npm run typecheck && npm test` —
  all PASS (run `format` twice if `format:check` still fails; see CLAUDE.md).
- [ ] **Step 2: Build and check in Chrome for Testing:** `npm run build`, then
  `agent-browser --executable-path "$HOME/.agent-browser/browsers/chrome-150.0.7871.24/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" --extension "$PWD/dist" open chrome-extension://pdgmdipnanfpcihafpcdpcennnoaickh/console/console.html`.
  Set `consoleToken`/`consoleDomain` in its `sessionStorage`, open `popup/popup.html` in a
  tab, and in that tab call `setConsoleApp(<console tab id>, 'galaxy')` through
  `getViews`; the Console must switch to Galaxy. Screenshot `popup.html` light and dark
  and compare against the mockup (`.superpowers/brainstorm/*/content/off-site-popup-v6.html`).
  Note: a popup opened as a tab sees ITSELF as the active tab, so the Console view itself
  can only be eyeballed by loading the popup from the toolbar — ask the owner to.
- [ ] **Step 3: Grep built CSS** `grep -c "unsupported-\|rossum-tab-" dist/popup/popup.css` → `0`.
- [ ] **Step 4: Update `CLAUDE.md`** — Popup bullet: off-site launcher, Console view via
  `getViews`, unlock notice placement; add the spec under "Popup".
