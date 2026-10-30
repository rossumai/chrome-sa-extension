# CIB deploy: UX refinement — design

**Date:** 2026-10-30
**Status:** approved mockup (v7); not built.
**Scope:** `src/cib/components/App.tsx` and `App.module.css` only. A delta on
`2026-10-24-cib-deploy-console-design.md`, which stays the record for the engine and the flow.
**Mockup:** `.superpowers/brainstorm/27385-1793351575/content/cib-deploy-v7.html` (gitignored, local
only). Open it in a browser and use the state buttons at the top to see each state.

## 1. Why

The CIB deploy screen works, but it explains too little. SAs could not tell what the Coupa
check function is for, when to use it, or whether Check is a required step before Deploy. The
owner asked for "a bit more refinement and explanation", in a more modern layout, in one column.

## 2. Hard rule: behaviour does not change

Every request, its order, and every engine call (`listReleases`, `loadRelease`, `deployCib`,
`deployCoupaProbe`, `teardownCoupaProbes`, `findCoupaProbes`, the users and groups lookups, the
optional-permission request) stays exactly as it is today. `src/cib/cib.ts`, `engine.ts` and
`release.ts` keep their logic. Only presentation and wording change, plus the small UI-only
additions listed in §5. One exception, wording only (builder's-check call): three user-facing
strings say "press Deploy" and become "press Check and deploy" — `verdict()`'s `resumable` text
and the pending-imports note in `cib.ts`, and the error suffix in `App.tsx`.

## 3. Goals, non-goals, anti-goals

- **Goals:** each step says what it is for; the token owner is one field; the Coupa login test is
  understandable; Check vs. Deploy is unambiguous; the result is easy to read.
- **Non-goals:** a gate that forces Check before Deploy (rejected, see §4.4); a teardown of a
  deployed CIB; any change to the engine or to what is stored.
- **Anti-goals:** a screen that is busier than today. The owner rejected two busier drafts of
  step 4 ("KISS").

## 4. Layout

One centred column, max width about 760px, on `--bg-base`. The Console connection bar stays at
the top unchanged. Below it, in order:

### 4.1 Header

An icon tile, the title "Deploy the Coupa Integration Baseline", and one sentence: "Reads a CIB
release from github.com/rossumai/rossum-coupa-integration and creates it in the connected
organization." The repo name is a link to the repo. **No badges** under it (removed on request).

### 4.2 Numbered steps

Each step is a card with a numbered circle on the left. A vertical line joins the circles. A
step's circle shows a tick and turns green when its required fields are filled. The current
step's circle has an accent ring. Step 3's circle has a dashed border because the step is
optional. Card style: 12px radius, a soft border, a light shadow, a 15px/700 title and a 12px
secondary subtitle. Field labels are plain 12px/600 text, not the uppercase mono `filter-label`.
Inputs are 34px tall with an 8px radius and an accent focus ring.

**Step 1 — Release and organization.** Subtitle: "Which CIB release goes where, and which admin
the hooks run as."
- One row with three fields:
  - **CIB version**: hint "Newest first · release notes ↗". The link goes to
    `github.com/<CIB_REPO>/releases/tag/<version>`.
  - **Organization ID**: when it was prefilled from the session, hint "✓ Filled from your
    session" in success colour.
  - **Region**: hint "Must match the org's location. Check verifies it."
- **Deploy tool (v1.x settings)** appears only for v1.x releases, as today. Hint: "v1.x releases
  take their deploy settings from this tag of the deploy tool."
- **Token owner — one combobox replaces the two fields** ("Find token owner" + the select).
  - It is a text input with a search icon. Typing drives the same debounced `users?search=` query
    as `ownerQuery` today.
  - The dropdown lists the matches. Each row shows initials, the username, and "Full name ·
    email". When nothing matches, it shows "No active admin matches. The hooks need an admin of
    this organization."
  - Picking a row sets `owner` and shows "username · Full name" in the input. That label is
    separate state, never written to `ownerQuery`, so a pick fires no new search (as with the
    select today). Editing the text after a pick clears `owner` and becomes the new
    `ownerQuery`, which searches again. (Builder's-check call.)
  - A single match is auto-picked, as today.
  - Hint: "The CIB hooks run as this user. Only active admins of organization <id> are listed."
  - The query still sends `page_size=10`, so the footer says "Up to 10 matches. Type to narrow."

**Step 2 — Coupa credentials.** Subtitle: "The OAuth client the CIB hooks use to call Coupa."
- Coupa URL on its own full-width row.
- Client ID and Client secret side by side. The secret field gets a Show/Hide toggle.
- Card footer with a lock icon: "The secret stays in this page's memory. The deploy checkpoint
  stores only a placeholder."

**Step 3 — Test the Coupa login** (tag: optional). Subtitle: "The checks log in to Coupa once with
the client ID and secret, so a wrong secret or a missing scope stops the run before anything is
written. The deploy itself does not need this test."

A labelled question, "Where should the checks log in to Coupa from?", with two radio cards:
- **This browser** (tag: default): "Nothing to set up. Chrome asks once for permission to reach
  Coupa. If you refuse, Check skips the test and says so."
- **The Rossum organization**: "A small function in the org logs in from Rossum's servers. Use it
  when this browser cannot reach Coupa, for example when Coupa accepts only known IP addresses."

Under the radios, one panel shows only the action that fits the radio choice and whether a
check function exists in the org (`probe`):

| Radio | Function exists | Panel |
|---|---|---|
| Browser | no | neutral, "Ready. Nothing to set up." No button. |
| Organization | no | "Create the check function first" + what it creates (the hook "CIB deploy: Coupa credentials check", manual trigger, no queues; it gets the secret only during a Check; the org must allow functions to call HTTPS hosts) + hint "Until it exists, Check logs in from this browser." Primary button **Create check function** (= today's Deploy check function). |
| Organization | yes | success, "Ready. Check logs in from the organization." + link to the hook page + hint "It is not part of CIB. Remove it when you have finished deploying." Button **Remove check function** (= today's Tear down). |
| Browser | yes | warning, "A check function still exists in this org. While it exists, Check logs in from the organization, not from this browser." Button **Remove check function**. |

The radio is UI state only. It starts on "The Rossum organization" when `findCoupaProbes` finds a
function on load, and on "This browser" otherwise. It never changes which route a run uses:
that stays "the function if it exists, else the browser", as today. The last row of the table
exists so the screen never contradicts that rule.

**Step 4 — Deploy.** Subtitle: "**Check and deploy** runs the checks first and writes nothing if
one fails. **Check only** runs the checks and stops."
- First, a collapsed inset box "› Resume and re-run · run ID `<run>`". Expanded, it shows:
  - **Run ID**, with the hint "Deploy saves its progress under this ID. Deploy again with the
    same ID to resume; a resumed run skips the checks."
  - **Continue a half-built deploy**, with the hint "Adopt CIB objects already in the org by
    name, instead of stopping at them."
- Then a divider, and the buttons right-aligned: **Check only** (secondary, = today's Check,
  `checkOnly: true`) and **Check and deploy** (primary, = today's Deploy). Both are 40px tall.
  There is no floating or sticky bar.

**Step 5 — Result.** Hidden until the first run. On a run it appears and scrolls into view.
- Title: "Deploying CIB <v>" while running, else "Check result" / "Deploy result" /
  "Deploy stopped". The elapsed time or the finish time is right-aligned.
- **While running:** the subtitle is the current `prog.detail`, plus "Leaving this app keeps the
  run going." (true: `Console.tsx` keeps CIB mounted).
- **When finished:** a verdict box first. The tone and the text come from `verdict()`; split the
  text at its first ":" into a bold headline and the rest as the subline. For a finished deploy,
  three stat tiles follow: objects, imports started (x / y), datasets still missing (warning
  colour when > 0). They use the same numbers `verdict()` computes.
- **Blockers:** red rows with a count heading, the text verbatim. The mockup's "Fix: …" lines,
  its own verdict sentences and "continue from object 64" are illustrative only: the engine
  does not produce them, and the result is a plain pass-through of `verdict()`, `blockers` and
  `notes`. (Builder's-check call.)
- **Notes:** neutral rows with a count heading ("Notes, not blocking" when there are blockers),
  the text verbatim.
- **Phases:** an 8-segment bar (one segment per `PHASES` key, in order), then a two-column list
  of the phases. Each phase is done ✓, current (spinner + `done/total`), failed (!) or not run.
  "Read the release" and "Checks" carry a small read-only tag. Each phase keeps the last
  `done/total` it reported, so finished phases still show their counts.
- **Details (JSON)** and the **Log** are collapsed `<details>` blocks. The log has a Copy
  button. The log is open by default only after an error.

### 4.3 Error

When a run throws, the existing `error-banner` text is shown as an inline red box at the top of
the column. The **Resume deploy** button appears only when the run that threw was a Check and
deploy run (the component remembers the last run's mode). It does exactly what pressing Check and
deploy again with the same run ID does. It never appears after a Check only run, nor for errors
that are not run errors (`listReleases`, the check function's create or remove). Step 5 shows
"Stopped with an error". (Builder's-check call.)

### 4.4 Why two buttons, not a gate

`deployCib` with `checkOnly: false` already runs the checks first and stops before writing if
one fails; only a resume skips them. So Check is never skipped, and a gate ("Deploy unlocks
after a passing Check") would add a rule the code does not have. The owner chose to rename the
buttons instead ("Check only" / "Check and deploy").

## 5. UI-only additions (no new requests)

- While a run is in progress, every input and button in the form is disabled, not only
  Check/Deploy. A run already copies the form values when it starts; this makes that visible.
- After a deploy, when a check function still exists, step 5 shows the note "The Coupa check
  function is still deployed. Remove it in step 3." It is derived from `probe`, not from the
  engine's notes.
- The Show/Hide toggle on the secret.
- The release-notes link (built from the tag; no API call).

## 6. Constraints that bind the build

- Colours only from the existing tokens (`--accent`, `--success*`, `--warning*`, `--danger*`,
  `--info*`, `--bg-*`, `--text-*`, `--border`). There is no `--accent-bg`; for accent tints, use
  `color-mix(in srgb, var(--accent) N%, var(--bg-card))` as the mockup does. Check dark mode.
- All new styles go in `App.module.css`. No bare short class names (CLAUDE.md).
- JSX text: no `\uXXXX` in raw text (`›`, `↗`, `✓`, `·` are pasted or wrapped in `{'…'}`).
- The mockup's pink pins, legend and state toolbar are mockup-only.
- Customer-free fixtures: `acme` / `example` placeholders only.

## 7. Left to the builder

- How to split `App.tsx` into components (for example `OwnerCombobox`, `CoupaLoginStep`,
  `RunResult`). Exact spacing, as long as it matches the mockup closely.
- When a step counts as "complete" for its green tick. Suggestion: step 1 when version, org,
  region and owner are set; step 2 when all three credentials are set; step 3 is never ticked.
- The combobox's keyboard behaviour. It must at least support arrow keys, Enter and Escape, and
  use `role="combobox"` / `listbox`.
- Tests: a `.test.tsx` for the combobox (search → pick → `owner` set) and one for the step 3
  panel table (all four rows).
