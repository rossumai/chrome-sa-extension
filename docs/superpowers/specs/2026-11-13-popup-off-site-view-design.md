# Popup off Rossum, NetSuite and Coupa — design

Date: 2026-11-13. Replaces the popup's "This tab isn't supported by the extension." view
(`UnsupportedSite` in `src/popup/components/App.tsx`).

## Intent

The owner thinks users do not use this view. Two situations reach it, and they want
different things:

1. **An unrelated tab.** The popup was opened by mistake. The view should get the user to
   a Rossum tab in one click or one key, and say nothing more than that.
2. **The Console tab.** SAs often open the popup while in the Console. Today it says
   "You're on the Rossum Console." and offers only the Rossum tab list. It should be about
   THIS Console tab: which org it is connected to, and its apps.

Plus one bug the owner found: the "Experimental features unlocked / hidden" notice (5
clicks on the version hash) is inserted into the footer row as a third item, and at 380px
the footer wraps onto several lines.

## Goals

- Unrelated tab with Rossum tabs open: one quiet line, then the open Rossum tabs, each named
  by its organization, each with Console and Copy-token actions. Enter and 1–9 switch.
- Unrelated tab with no Rossum tab: the organizations the user recently visited, each
  opening in a new tab.
- Console tab: the connected org, Copy token, a button to the org's Rossum tab, and the
  Console's apps as a keyboard list in the rail's order, which switches THIS Console tab.
- The unlock / hide notice never joins the footer row.
- Airy and clean (owner's words): generous spacing, few elements.

## Non-goals (owner decided, 2026-11-13)

- No recently viewed annotations anywhere in this view.
- No feature toggles in the Console view (the Org info toggle was considered and dropped),
  and no collapsed "Rossum page settings" row.
- No "Works on Rossum, NetSuite and Coupa." line under the tab list.

## Anti-goals

- An alarming look. Being on an unrelated tab is normal; the amber warning box goes.
- A popup that grows toward Chrome's 600px cap.
- A second copy of the rail's app list that can drift from it.

## Approaches

- **App switcher on the Console** — four were mocked up: the rail's icon grid in two rows,
  a named two-column list, a single-row dock strip, and a keyboard list. The owner picked
  the **keyboard list**, because it keeps the rail's order (so 1–9 map to the rail top to
  bottom) and matches the numbered tab list on unrelated tabs. It is the tallest of the
  four; at 9 apps the Console view is still about 470px.
- **Unlock notice** — a floating toast was tried first; once the view got shorter it
  covered the app list. Chosen: for 2.5 s the notice replaces the label line under the
  header, so it covers nothing.
- **How the popup reaches the Console tab** — see Console state below. Chosen:
  `chrome.extension.getViews({ type: 'tab', tabId })`, which returns the Console tab's
  `window` (same extension origin). The alternative, a `chrome.runtime` message the
  Console answers, needs a listener in every Console tab and has to filter out the service
  worker's own listeners; getViews needs neither.

## The views

Mockup (local, git-ignored): `.superpowers/brainstorm/*/content/off-site-popup-v6.html`.
The sketches below are the approved state.

### A · Unrelated tab, Rossum tabs open

```
[SA] Rossum SA
(i) Nothing to do on this tab. Jump to an open Rossum tab:

OPEN ROSSUM TABS                               most recent first
┌[1] Acme Corp 482113 (Production)        [Console] [key]┐  ← ringed: Enter target
│    Document 9104377 · acme.rossum.app                  │
└────────────────────────────────────────────────────────┘
 [2] Acme Corp 482113 (Production)        [Console] [key]
     Queue 3311 · acme.rossum.app
 [3] Example 517920 (Sandbox)             [Console] [key]
     Settings · partner-sandbox.rossum.app
 ↵ switch to 1   1–9 switch   esc close
f3a91c0 · Usage data on                     Support & feedback ↗
```

- Order: most recently accessed first (`findRossumTabs`, unchanged). The first row is
  ringed: it is what Enter switches to.
- **Title line**: the organization's name, its id and an environment chip, from the org
  cache the `org-name` feature keeps in that tab's `sessionStorage`
  (`rossum-sa-extension-org:<hash>`, one entry per tab, parsed with `cachedOrg`). The chip
  shows only when the user has `orgEnvEnabled` on, the same switch that draws it in the
  Rossum header, and uses the same colours. When the tab has no cache entry (the feature
  is off, the tab never loaded it, or it expired), the line falls back to the tab title,
  then the host — what the row shows today.
  The name also follows `orgNameOn` (builder's call): `org-name.ts` writes the cache when
  only `orgEnvEnabled` is on, so with Org info off the row shows the fallback title (and
  the chip, if `orgEnvEnabled` is on), as view C does.
- **Second line**: where the tab is, from its URL, then the host. Document / annotation
  URLs read as `Document <id>` (via `annotationIdFromPath`), `/queues/<id>` as
  `Queue <id>`, `/settings…` as `Settings`, anything else as nothing (host only). No API
  call: the mockup's queue NAME is not shown.
- **Console** opens the Console for that tab's session (`readAuthInfo` in that tab, then
  `openConsoleTab(tab, auth, 'mdh')`). "Without switching" means the user need not go to
  the Rossum tab first: the Console opens as a new, focused tab next to that Rossum tab,
  in that tab's window (which is often not the current one), and the popup closes.
  `openConsoleTab` gains an optional `windowId` read from the passed tab, so its existing
  callers keep working (builder's call). **Key** copies that tab's
  token, with the same "Copied" feedback and the same `sa_popup_copy_token` event as the
  header's key. Both reuse the header's error notices (reload the tab / sign in /
  clipboard).
- **Keys**: Enter switches to row 1, digits 1–9 switch to that row, Escape closes the
  popup. A digit beyond the list does nothing.

### B · Unrelated tab, no Rossum tab

```
(i) No Rossum tab is open. Pick up where you left off:
RECENT ORGANIZATIONS
 [1] acme.rossum.app                        2 h ago   [Open ↗]
 [2] partner-sandbox.rossum.app             yesterday [Open ↗]
Also works on NetSuite and Coupa.
```

- The distinct origins in `rossumViewedAnnotations`, newest visit first (that list is
  already newest-first and capped at 12). Each row opens the origin in a new tab; Enter and
  1–9 do the same. The relative time is from the entry's `at`.
- With no history, only the note and "Also works on NetSuite and Coupa." remain. The owner
  removed the "Works on…" line only from view A; whether to drop this one too was asked
  and not answered — kept for now.

### C · Console tab

```
[SA] Rossum SA                              [key] [Rossum tab ↗]
┌ Example 517920 (Sandbox)                                       ┐
│ This Console is connected to partner-sandbox.rossum.app · eu2  │
└────────────────────────────────────────────────────────────────┘
SWITCH APP IN THIS TAB
 [1] ▣ Data       Dataset Management                     HERE
 [2] ▤ Audit      Audit Log Viewer
 [3] ◈ CIB        Coupa baseline deploy
 [4] ⚒ Builder    Schema Builder                         BETA
 [5] ⌕ Inspector  Annotation Inspector                   BETA
 [6] ✦ Fabry      Mr. Fabry chat                         BETA
 [7] ⊛ Galaxy     Org as a 3D graph
 [8] ⌂ Academy    Onboarding training      (unlocked)    EXP
 [9] ↻ rdc        Deployments between orgs (unlocked)    EXP
```

- **Reaching the tab**: `chrome.extension.getViews({ type: 'tab', tabId: tab.id })[0]`.
  From that window the popup reads `sessionStorage` `consoleToken`, `consoleDomain` and
  `consoleActiveApp` (JSON, written by `writeTabState`). When there is no view (a
  discarded tab) or no token, the Console view shows the app list without the org card
  and with Copy token disabled; the Rossum tab button still works from the domain if one
  is known, else it is hidden.
- **Org card**: loaded by the popup with the Console's token, through `loadOrg` (the
  loader the header and the Console already share), so it names the org the same way.
  Name, id and the location (`eu2`) as `orgLabel` builds them; the Sandbox / Production
  chip follows `orgEnvEnabled` as in view A; the host is `consoleDomain`. Not cached, as the
  Console's own load is not. While loading, the card shows the host alone. It follows
  `orgNameOn` like the Console's connection bars: with Org info off, the card shows the
  host alone.
- **Key** copies the Console tab's token (`sa_popup_copy_token`).
- **Rossum tab ↗** switches to the most recent open Rossum tab whose origin equals
  `consoleDomain`, or opens `consoleDomain` in a new tab when none is open.
- **App list**: the rail's apps, in the rail's order, with the rail's icons, short labels
  and beta / exp badges, and a one-line description per app. Gated apps only when
  `experimentalUnlocked`. The current app (`consoleActiveApp`) is marked "here". A click or
  digit 1–9 switches THAT Console tab to the app and closes the popup; switching to the
  current app only closes it.
  - **Switching**: the popup dispatches an event on the Console's window
    (`view.dispatchEvent(new CustomEvent('sa-console-set-app', { detail: appId }))`); the
    Console listens for it in `boot`, validates with `isValidApp` and the gate (as
    `pickInitialApp` does), and sets `activeApp`. Nothing else in the Console changes, so
    usage counting (`APP_EVENTS`) and `writeTabState` work as for a rail click.
- **Labels and descriptions** (descriptions are new copy; the mockup's): Data · Dataset
  Management; Audit · Audit Log Viewer; CIB · Coupa baseline deploy; Builder · Schema
  Builder; Inspector · Annotation Inspector; Fabry · Mr. Fabry chat; Galaxy · Org as a 3D
  graph; Academy · Onboarding training; rdc · Deployments between orgs.

### D · Unlock / hide notice

- Today: `.unlock-notice` in the footer row (the bug).
- New: for 2.5 s, the label line under the header is replaced by the notice, in the
  `--exp` violet: "[exp] Experimental features unlocked · Academy, rdc added" or
  "Experimental features hidden". On the Console the line is the app list's label; when
  the Console was on a gated app, the hidden notice adds "· switched to Data" (the
  Console's existing `appAfterGateChange` effect does the switch). On views A and B it is
  the one-line note.
- After unlocking on the Console, Academy and rdc are marked with a violet left edge for
  the same 2.5 s.
- On Rossum, NetSuite and Coupa tabs, which have no such line, the notice replaces the
  footer's left group (version + usage button) for the same 2.5 s, so it never adds a
  third item. (Builder's call; not mocked up.)

## Constraints

- **One list of apps.** `Rail.tsx`'s `APPS` and icons move to a shared module that both
  the rail and the popup import. That module must import **no CSS**: `build.js` copies
  `src/popup/popup.css` to `dist/popup/popup.css`, and a CSS Module imported into the
  popup bundle would make esbuild emit a sheet at the same path. `FabryMark` imports a CSS
  Module, so the shared Fabry icon is a plain SVG built from the same star path, with that
  path moved to a CSS-free module both use.
- **Popup styles stay in `popup.css`** (plain classes, `rossum-sa`-style naming is not
  needed there; no bare single-letter classes).
- `src/popup/tab-readers.ts` functions are serialized into the page and cannot import: the
  org-cache reader takes the prefix as an argument and returns the raw entry; the popup
  parses it with `cachedOrg`.
- Popup max height 600px; at 9 apps the Console view is about 470px.
- `getViews` is available to extension pages in Chrome and Edge (not to the service
  worker). **Not yet verified in this repo** — the first task of the plan proves it in a
  real Console tab before building on it. If it fails, view C uses the rejected
  alternative instead: the Console answers a `chrome.runtime` message addressed to its
  own tab id (`chrome.tabs.getCurrent`) with token, domain and app, and takes the app
  switch the same way. The views do not change (builder's call).
- No new usage events (adding one needs `EVENT_NAMES` and `PRIVACY.md`; nobody asked).
- jsdom has no `chrome.extension`; tests stub it.

## Left to the builder

- Component split, file names and class names.
- Exact spacing values, within the "airy" direction of the mockup.
- Relative-time wording ("2 h ago", "yesterday").
- How many Rossum tabs to list before scrolling (the list scrolls inside the capped popup).
