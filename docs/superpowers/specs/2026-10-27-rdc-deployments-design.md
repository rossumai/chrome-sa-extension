# rdc deployments in the Console — design

**Date:** 2026-10-27
**Status:** designed, not built. Blocked on rdc changes (§9).
**Scope:** `src/rdc/` (the rdc Console app, rebuilt), `src/console/` (rail entry stays), a new
hidden Data Storage collection in the target org, `CLAUDE.md` (the "one bulk WRITE path" sentence).
**Mockup:** [`2026-10-27-rdc-deployments-mockup.html`](2026-10-27-rdc-deployments-mockup.html) —
open it in a browser; the bar at the top switches screens. It is the approved look (v13 of the
brainstorm). Its pink "guess" markers are switched off by default and are listed in §11.

## 0. Build now: the UI, honest about what does not work yet

Owner, 2026-10-27: build the design now. Much of it needs rdc work that is in progress (§9), so
the page must **say plainly** where a feature does not work yet, rather than fake it.

- **Works now** with today's wasm API: the Console session for the target; checking a token for
  the source (it can read the chosen org); reading both orgs into memory with
  `sync({ noPush: true })`, with the real log and real counts per kind.
- **Work in progress** — shown in the design's layout, but disabled and labelled as not available
  yet, naming what it waits for: remembering the source and the history (storage in the target's
  collection), Plan (`migrate` in wasm), Review and its decisions (structured dry run and conflict
  input), Write, Done, and editing own values.
- **No fake data presented as real.** Where the mockup shows sample numbers for a work-in-progress
  step, the build shows the step's structure and the work-in-progress note instead.
- The questions in §8.1, §8.2, the first deployment into a target that already has configuration,
  and when hook secrets are asked for are **deferred** until the rdc work lands; this phase does
  not need their answers, because nothing is written to either org.

## 1. Why

Moving configuration between Rossum environments (test → prod) with rdc means a CLI, a git
project and three commands in the right order (`rdc sync test`, `rdc migrate test prod`,
`rdc sync prod`). The rdc Console app today is a proof of concept that only pulls the connected
org. This design turns it into a **deployment page for admins**: anyone who can open the Console
and is an admin of the org can bring tested configuration into that org, review every change, and
write it — without a CLI.

Success: an admin deploys test into prod from the browser, sees exactly what will change before
anything is written, and never loses an edit someone made directly in prod.

Anti-goals — it fails even if it works when:
- an edit made directly in the target is overwritten without the admin deciding it;
- the admin cannot tell which org is read and which org changes;
- a token or a hook secret is stored anywhere;
- the page becomes unreadable for an org with hundreds of objects per kind.

## 2. The model: deploy INTO the org you are signed into

Decided by the owner:

- **The target is the connected org.** The deployment always starts from the target: the org the
  Console was opened from is the only org that changes, written with the Console's own session.
  To deploy into another org, open the Console from that org.
- **Why:** each org has its own Data Storage, so an org can only see its own records. The record
  of a deployment (source, own values, history) therefore lives where the change lands.
- **Exactly one source per target.** The source is only read. Its API token is typed at every
  deployment and never stored — not in the browser, not in the collection.
- **The admin always types the target org's name to confirm a write**, for every org, not only
  Production ones.
- **Own values** (rdc's per-env `overlay.toml`) are viewed and edited on their own page (§5.9).
- **No resume after a closed tab** (§8.3). The page says to keep the tab open.

## 3. What is stored, and where

One hidden collection in the **target** org, named with the extension's convention:
`_SA_EXTENSION__rdc_deployments` (*builder's call on the exact name*). The source org stores
nothing and is never told about the target.

| Stored in the target's collection | Never stored |
|---|---|
| The source: Rossum URL, org id, short name | Any API token (source or target) |
| The target's own values (`envs/<target>/overlay.toml`) | Hook secret values |
| Slug mapping (`.rdc/mapping.toml`) | The source's configuration |
| rdc state of the target after the last deployment (§8.1) | |
| History: one record per deployment (who, when, from, counts, result) | |

Follow the repo's migration convention: additive keys and sibling documents, so older builds keep
working. Retiring a field never deletes customer data.

## 4. Look: the header band

The approved header is a dark band (mockup, *This org* and *First visit*):

- **Left:** the source card, dashed border, "Deploys from", name, host, a row of kind icons
  (queues, schemas, hooks, rules, labels).
- **Right:** the target card, solid white with a coral ring, "You are signed in here", name,
  Production/Sandbox chip, host, the same kind icons.
- **Between:** a conveyor belt (§4.1) with the caption "last deployment <date> by <user>" right
  under it.
- **Under the cards:** three one-line rules — *test is only read*, *Acme is the only org that
  changes*, *Acme keeps its own values*.

During the 5 steps the band is compact: the two cards stay, and the 5 steps sit on the line
between them (Connect, Read both, Plan, Review, Write to Acme), done steps checked, the current
one highlighted, the write step in coral.

The Acme card is white in both themes; its icons and chip keep their light-theme colours in dark
mode (a v5 bug, fixed in the mockup).

### 4.1 The conveyor (decorative, deliberately calm)

Tuned with the owner over several rounds; keep these values unless the owner says otherwise:

- One icon enters every **2.7 s** and takes **9 s** to cross, at **one constant speed** (linear
  between a fade-in over the first 10 % and a fade-out over the last 10 %), so icons never bunch.
- Icons are full size (30 px) and opaque. They shift from a teal tint at the start through white
  to a coral ring at the end. No trail, no scale pop.
- The belt sits at the height of the org names (38 % of the track). Faint dashes move along it at
  exactly the icons' speed.
- The line ends in a solid coral arrowhead with a soft glow, before the target card; icons fade
  out before reaching it.
- When an icon leaves, the source's icon of the same kind gets a faint tint; when it arrives, the
  target's icon gets a thin coral ring.
- Spawn only while the screen is visible and the document is not hidden.
- `prefers-reduced-motion`: three still icons on the belt, nothing moves.

Rejected during the brainstorm, so do not reintroduce: one tile per object, comet arcs, a review
gate, flipping copies, a donut ring, a kind × change table as the header, a side rail, and a
"work order" document metaphor.

## 5. Screens

All screens are in the mockup. Copy is plain, short, active, from the admin's point of view.

1. **First visit** — no source yet. The band with "Your test org" behind a lock; three numbered
   sentences on how it works; one button, *Choose the org to deploy from*; a note that the record
   lives in this org's own data storage.
2. **Choose the org to deploy from** (an inline form, hidden until asked for — owner,
   2026-10-27, replacing the mockup's modal) — Rossum address, a token used only to list the orgs
   it can read, the organization (select), a short name. Saves URL, org id and name only. Its
   button says *Use <name> as the source*, never "Deploy": choosing deploys nothing. It opens in
   place of the button that asked for it: *Choose the org to deploy from* on the first visit,
   *Change source* on the overview.
3. **This org** (overview) — the band; *Acme deploys from* (one source, *Deploy from test*,
   *Change source*); *Deployments into Acme* as a timeline (deployed / partly skipped /
   cancelled); *What Acme keeps for itself* with *Edit*.
4. **Step 1, Connect** — a token for the source (checked, "only read", never kept); hook secrets
   for the target, only where the target needs a new or changed value (a new hook's secret is
   required; an existing one can be left empty to keep the target's value).
5. **Step 2, Read both** — what rdc read from each org, nothing written yet, and a note when
   objects were edited directly in the target since the last deployment.
6. **Step 3, Plan** — counts (created, updated, deleted, renamed, unchanged); *everything* vs
   *only what I pick*; objects only the target has: *keep* (default) vs *delete* (`--mirror`);
   *also overwrite the target's own* score thresholds / inbox addresses / automation (`--carry`
   groups); rdc's warnings in plain words (remapped ids, new inbox prefix, ids not remapped);
   the same plan as CLI commands.
7. **Step 4, Review** — the changes only, grouped by kind, each with a diff of *the target today*
   vs *after*; lines that are the target's own values are marked "Acme keeps this". Objects
   edited in the target since the last deployment come first and need a decision: *use test's
   version*, *keep Acme's version*, *decide next time* (rdc's `k` / `r` / `s`; no "all" answer).
8. **Step 5, Write** — "a dry run produced exactly the N changes you reviewed"; type the org
   name; *Write N changes to Acme*; live progress and log; "keep this tab open".
9. **Own values** — a table of object, setting, value in the target, value in the source, remove;
   *add a value*; the groups the target always keeps (score thresholds, inbox addresses,
   automation, queue training) with the note that one deployment can overwrite the first three
   in its Plan; hook secrets are not listed; *Show as overlay.toml*.
10. **Done** — "Deployed to Acme", counts, what was left (skipped decisions, new queues start with
    automation off), *Back to Acme*.

## 6. Scale

Orgs can have hundreds of objects per kind. Never draw one element per object.

- Counts per kind and per change type, never a grid of objects.
- The review lists **only changes**, grouped by kind, with filters by change type and a search;
  unchanged objects are one number ("289 unchanged hooks not listed").
- The mockup's v7–v9 exploration (counts per kind, bars, filterable list) is the reference for how
  the Review step scales; the header stays the v13 band.

## 7. Animation rules

- The conveyor (§4.1) is the only decorative loop, and only on *This org* and *First visit*.
- Everything else moves only to show real progress (counts while reading, progress while writing)
  or to answer the admin's action.
- Respect `prefers-reduced-motion` everywhere.

## 8. How it maps onto rdc

The page runs rdc's wasm build on an in-memory project tree (the existing `src/rdc/wasm.ts`
loader). A deployment from `test` into `acme`, in rdc terms:

```
rdc sync test --no-push       # read the source
rdc migrate test acme         # [--mirror] [--carry …] [--only …]   local only
rdc sync acme --dry-run       # the reviewed delta
rdc sync acme                 # write; conflicts answered from the Review decisions
```

### 8.1 Edits made directly in the target must surface — this constrains storage

Verified in rdc (`src/cli/sync/mod.rs`, layer 1): sync classifies each object from
`(remote, local, base)`, and reports a conflict only when local AND remote both differ from the
**base** — the bytes of the last sync, kept in `.rdc/state/<env>.lock.json` and
`.rdc/state/<env>.base/`.

Two consequences:

- The target's rdc state and snapshot **after the last deployment** must be kept (in the target's
  collection, §3) and loaded before the migrate. Without them the base is "now", a direct edit is
  indistinguishable from the base, and the write overwrites it silently — the first anti-goal.
- The target must **not** be pulled (`sync --no-push`) before the migrate: a pull moves the base
  forward and absorbs the direct edit the same way. "Read both" reads the target read-only for
  display (or with `--dry-run`); it never advances the target's base.

### 8.2 Renames

rdc follows a rename across envs only through `.rdc/mapping.toml`, which `rdc doctor <src>` writes
while the source's lockfile still holds the old slug; `--mirror` refuses an unrecorded rename of a
queue or engine. If the source is read fresh each time, nothing holds the old slug. Which state of
the source must be kept between deployments, and where, is open (§11).

### 8.3 No resume

Verified in rdc: a sync that fails mid-run saves its lockfile with what it already wrote, so the
next CLI sync continues. A closed tab is different: rdc saves the lockfile only at the end of a
sync or on an error, and the in-memory tree dies with the tab. A re-run would create duplicates
(names are not unique). Hence "keep this tab open". Making a closed tab resumable needs rdc to
save the lockfile after each write and the page to store it in the collection — out of scope.

### 8.4 Changes from outside the page, and two admins at once

*My call:* a change made to the target by anything else (the Rossum UI, an rdc CLI run, prd2)
is exactly what §8.1 exists for — it shows as a decision in Review, never silently. Two
deployments into one target at the same time are prevented with a lock document in the target's
collection, taken at *Read both* and released at Done or Cancel, with an expiry so a closed tab
does not block the org for ever (CIB deploy's run checkpoint is the precedent). The stored state
is written only by a deployment that finished.

### 8.5 Hook secrets

rdc reads secrets from `secrets/<env>.hook-secrets.json` and skips `"<unfilled>"` values. The page
writes the typed values into that file in the in-memory tree for the write only; the file never
reaches the collection.

## 9. Depends on rdc (owner will add; not this repo)

- `migrate` in the wasm build (with `mirror`, `carry`, `only`), and a structured plan result:
  per object kind, slug, operation, and the warnings (remapped ids, ambiguous ids, new inbox
  prefixes).
- `doctor` in the wasm build if §8.2 needs it.
- Enough structure from `sync` (dry run and write) to drive the Review list and the Write
  progress per object, instead of parsing log lines.
- **Conflicts before the write.** Today rdc raises a conflict only as a prompt during a live sync,
  but the Review step collects the decisions first. The dry run must return the list of
  conflicting objects, and the write must take the decisions as input (per object: keep local,
  use remote, skip), answering the prompts from that list. *Builder's call:* until rdc has this,
  plan against a mock of that contract; the owner builds it in rdc.
- Per-object diffs can be computed in the extension from `files()` before and after the migrate.

## 10. Repo rules this touches

- **Bulk write path.** `CLAUDE.md` calls CIB deploy "the extension's one bulk WRITE path into an
  org". This app adds a second one; update that sentence and keep the write behind the typed
  confirmation.
- **CSP.** The wasm already needs `'wasm-unsafe-eval'`; nothing new.
- **Experimental gate.** The rdc app is `gated` behind `experimentalUnlocked`; it stays gated
  while rdc's wasm build is an optional dependency (*my call*).
- **Usage data.** If an event is added (for example a completed deployment), it goes into
  `EVENT_NAMES` and `PRIVACY.md` together (*builder's call whether to add one*).
- **No customer names** in fixtures, copy or commits; use `acme`, `test`, `example`,
  `partner-sandbox.rossum.app`.

## 11. Open: guesses not confirmed by the owner

These were shown as guesses in the mockup and never confirmed:

1. Source, own values, slug mapping and history live in the target's hidden collection only.
2. Every deployment is recorded: who, when, from where, counts, result.
3. The source token is used for one deployment and never stored. *(The owner confirmed "never
   stored" for tokens in general.)*
4. Hook secrets are typed during the deployment and never stored.
5. Both orgs are read fresh before every plan — **contradicted by §8.1 for the target**; the
   design above keeps the target's last state instead.
6. A direct edit in the target always shows as a decision, never as a silent overwrite.
7. The three "also overwrite" options are offered, unchecked by default.
8. The equivalent CLI commands are shown on the Plan step.
9. Conflicts are decided one by one; no "all" answer.
10. Own values are edited as a list of object, setting and value, not as raw `overlay.toml`
    (the raw file is shown read-only).

## 12. Non-goals

- Deploying into an org other than the connected one.
- More than one source per target.
- Resuming a deployment after the tab closes.
- MDH dataset contents (rdc never drops a collection; its rules apply unchanged).
- Showing the source's live state on the overview: without its token only the last deployment's
  numbers are known.
