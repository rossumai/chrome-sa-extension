# rdc app: sync state in Data Storage — design

**Date:** 2026-11-03
**Status:** built and merged. **Superseded in part on 2026-11-12:** rdc no longer stores its
state; the page does, through `useStateStore` (section "The page stores rdc's state" near the
end). Sections §1–§8 keep their 2026-11-03 wording about `useDataStorageState` as history.
**Scope:** `src/rdc/` (types, key, reads, Plan, Review, Write, error texts), `build.js` and
`tests/rdc-wasm-node.test.ts` (a local-build override), `.gitignore`, `CLAUDE.md` (the rdc
paragraph). A delta on `2026-10-27-rdc-deployments-design.md`; read that first. It replaces that
design's §8.3 ("no resume") and the "writes nothing to either org" rule.

## 1. Decisions (owner, 2026-11-03)

The first draft of this record proposed keeping reads in memory and using Data Storage state only
for the Write step. The owner decided otherwise; these are binding:

1. **Every run persists its state, both reads included**, so the lockfiles survive a refresh.
   Each env's state lives **in its own org**: the source's in the source org (written with the
   typed source token), the target's in the target org (the session token), like the on-disk
   lockfile per env. The page now says that rdc writes its sync state to each org's Data Storage.
2. **The Write step is built**: Plan is a `migrate` dry run, Review shows its result, Write is a
   `sync` of the target that pushes.
3. rdc will also persist the env tree (`envs/<env>/**`) with the state, so state and tree agree
   after a closed tab. rdc decides what else survives (for example `.rdc/mapping.toml`).
4. The collection is the extension's: `_SA_EXTENSION__rdc_state`, passed as rdc's new `collection`
   option. Dataset Management already hides it by the prefix; nothing is added for `__rdc_state`.
5. rdc adds (branch `feat/wasm-migrate`): `useDataStorageState({ key, collection?, chunkBytes? })`,
   `Project.migrate(src, tgt, opts, onLog)` with a structured result, and a recovery `PromptKind`
   with the full question.
6. Web Lock errors are handled now. The first read of an env with no stored state stores the
   baseline, as the CLI does. rdc's version is detected by whether the method exists; rdc adds no
   version suffix.

## 2. What is true today (verified)

Extension, branch `master` at `0ad5c4f`:

- One `Project` per read: `rdc.Project.create('console', target)`, then `addEnv(source)`
  (`src/rdc/components/Read.tsx:133-135`). The project is freed when the read ends
  (`Read.tsx:149-151`).
- Envs are named `source` and `target` (`src/rdc/deploy.ts:7-8`). The target is the Console's
  session org: `apiBase` from the tab's origin, `orgId` from the one org `GET /organizations`
  lists, the session token (`src/rdc/core.ts:23-36`; the token comes from
  `src/console/index.tsx:253-254`). The source uses the typed token (`deploy.ts:61-72`).
- The only option ever passed: `{ noPush: true }`, source first, then target
  (`Read.tsx:136-142`; pinned by `tests/rdc-read.test.tsx:80-94`). `interactive` is therefore
  rdc's default, `true` (rdc `src/cli/sync/embed.rs:51-61`).
- "rdc writes nothing to either org" (`CLAUDE.md:390-391`). Under `noPush` without Data Storage
  state that holds: the sync pulls into the in-memory tree only.
- The one stored thing is the chosen source: a `kind: 'source'` document upserted into the
  target's `_SA_EXTENSION__rdc_deployments` (`src/rdc/sourceStore.ts:8`, `:41-47`), over
  `${domain}/svc/data-storage/api/v1/data/<op>` with the session token (`sourceStore.ts:13-24`),
  loaded at boot and saved on choice (`App.tsx:99-104`, `:250`).
- Dataset Management hides only `_SA_EXTENSION__*` plus one legacy name
  (`src/mdh/hiddenCollections.ts:13-23`). **`__rdc_state` would be visible there.**
- `src/rdc/wasm.ts:41-51` types `RdcProject` without `useDataStorageState`; `Prompt.kind` is
  `string` (`wasm.ts:29-33`). Nothing in `src/` or `tests/` reads a lockfile (`grep` for
  `lock.json`, `.rdc/`, `lockfile`: no hits), so **lockfile v4 needs no type change**.
- The committed dependency is `@mrtnzlml/rdc-wasm` `^0.15.0` (`package.json:59`), locked to
  0.15.0 (`package-lock.json:1040-1044`). `build.js:119-126` copies the glue and the `.wasm` from
  `node_modules/@mrtnzlml/rdc-wasm` only.

rdc, branch `feat/crash-safe-sync` at `e7fcd745`:

- `useDataStorageState({ key, chunkBytes? })` sets the option **for the whole project**, for
  every later `sync`/`watch` of any env (`wasm/src/lib.rs:550-560`, read at `:740` in `sync`).
  There is no call to switch it off again.
- Each run stores its env's state on **that env's cluster with that env's token**
  (`lib.rs:814-831`; Data Storage base derived from `api_base`, rdc `src/config.rs:44-56`). So a
  source sync after `useDataStorageState` writes to the **source** org.
- Documents: manifest `_id = "<key>/<env>"`, blobs `"<key>/<env>/blob/<sha256>/<n>"`
  (`src/state/data_storage_store.rs:6-10`, `:94-104`).
- **Data Storage writes happen under `noPush`.** The run hydrates before reading the lockfile
  (`src/cli/sync/mod.rs:234-237`) and commits at the end (`mod.rs:867`), and every commit
  checkpoints the store. The wasm test `sync_uses_data_storage_state_when_set`
  (`wasm/src/lib.rs:1179-1199`) runs with `no_push: true` (`lib.rs:1127`) and asserts the manifest
  `acme-key/dev` is inserted. A checkpoint is skipped only when the state is unchanged
  (`data_storage_store.rs:216-220`).
- **`dryRun` does not write**: it returns at `mod.rs:754`, before the commit; recovery under dry
  run does not commit either (`mod.rs:287-290`). It still **reads** (hydrates) Data Storage.
- Recovery runs whenever the lockfile has `pending`, `noPush` or not (`mod.rs:246`, `:280-292`).
  Several candidates: interactively a prompt of kind `conflict` with keys `1`–`9` ("it is id N")
  and `a` ("abort the sync"); with more than nine, or non-interactive, an error naming the ids
  (`src/cli/sync/recover.rs:217-271`). The wasm `Prompt.question` is the one-line menu
  (`wasm/src/lib.rs:268`), so the explanation is only in the preceding Warn log line.
- A lost compare-and-swap fails the run with "the state of env '<env>' was changed by another
  run" (`data_storage_store.rs:284`), wrapped in "saving the sync state of env '<env>' to Data
  Storage" (`:319`).
- Web Lock `rdc:<api_base>:<org_id>`, `ifAvailable`, held for the whole run, **always** — with or
  without Data Storage state (`wasm/README.md:88-99`; `lib.rs:452-454`, `:564-569`, `:742`).
  A held lock rejects with `env '<env>' is already being synced in another tab`; a missing
  `navigator.locks` rejects with `Web Locks are not available in this context`.
- Option checks: `collection`, `chunk_bytes` and an empty `key` throw
  (`wasm/src/bindings.rs:297-309`, `lib.rs:456-472`).
- `rdc migrate` loads **both** lockfiles from the tree (rdc `src/cli/migrate/mod.rs:3238`,
  `:3295`).

Run against a local build of the branch (§7), in Node 24, no Rossum org touched:
`useDataStorageState` throws on `collection`, `chunk_bytes` and `" "` with the messages above and
accepts `{ key, chunkBytes }`; a sync with Data Storage state first POSTs
`/svc/data-storage/api/v1/data/find` before any API call; a Web Lock held by the same process makes
`sync` reject with `env 'target' is already being synced in another tab`; `version()` of the
branch build answers `0.15.0`, the same as the published package.

## 3. Which org holds which state

| Env | Where its state and tree live | Token |
|---|---|---|
| `source` | Source org, `_SA_EXTENSION__rdc_state`, manifest `<key>/source` | The typed source token |
| `target` | Target org, `_SA_EXTENSION__rdc_state`, manifest `<key>/target` | The Console session token |

This is what rdc does on its own: a run stores its env's state on that env's cluster with that
env's token (§2). So the app calls `useDataStorageState` **once, right after `addEnv`**, before the
first sync, and every later run of either env uses it. The source org now holds the source's state
under a key that names the target org's id (§4); that is the only thing it learns about the target.
This replaces the deployments design's "the source org stores nothing" (its §3).

**A build without the `collection` option** (the published 0.15.0 has no `useDataStorageState`; the
`feat/crash-safe-sync` build refuses `collection`, §2) must not fall back to `__rdc_state`. The
page then runs in memory as today and says so: "This build of rdc cannot keep its sync state in the
org, so nothing is kept after this visit." Write needs the state (it is what makes a closed tab
safe), so Write is disabled with that note.

## 4. The key

`key = "chrome-sa-extension/rdc-deployments/<targetOrgId>"`. Re-checked now that the source also
stores state:

- **The target org id must be in the key.** One source org can feed several targets. Each
  target's deployment keeps its own copy of the source's state in the source org, so their bases do
  not overwrite each other: `…/<T1>/source` and `…/<T2>/source` are two manifests.
- **The source org id is not needed.** Manifests are per org already: the source's manifest lives
  in the source org, the target's in the target org. A target has exactly one source (deployments
  design §2), so within the target org there is never a second source to tell apart.
- **Switching source keeps the target's state.** The target's base describes the target's remote,
  not the source, so it stays valid and direct edits in the target keep surfacing (§5). The new
  source org has no manifest under this key, so its first read stores a baseline. The old source's
  manifest stays in the old source org, unused; switching back resumes from it, and the next read
  pulls whatever changed since. Nothing is deleted in either case.
- What is not per env — `.rdc/mapping.toml` — is pair-specific and rdc decides where it lives
  (§1.3). If it is kept with the target and the source changes, it describes the old source; §9
  asks rdc.
- `source` and `target` (`deploy.ts`) are part of the stored identity and must never be renamed.
- The key holds an org id only: no token, no name.

## 5. Direct edits in the target (deployments design §8.1, re-checked)

The concern holds, and the decision makes it concrete: **every read of the target pulls and
stores a new base.** rdc reports a conflict only when local and remote both differ from the base,
so an edit made directly in the target before a read becomes part of the base, and a later Write
that changes the same object overwrites it with no conflict. The page has to show such edits
itself.

**How the read sees them.** The target is read in two runs on one project:

1. `sync(target, { dryRun: true })`. It loads the stored state and tree into the project and writes
   nothing (§2). The page snapshots `envs/target/**`: the target as of the last run.
2. `sync(target, { noPush: true })`. It pulls and stores the new base and tree.

The page diffs the two snapshots per object file: added, changed or removed in the target since the
last run. A first read (no stored tree) shows no list and says "First read of <target>: its current
configuration is now the baseline."

**Since the last run is not enough.** The read stores the pulled tree, so the next read's dry run
starts from it and lists nothing for an edit the previous read already saw (pinned by the Node
test against the real build: a second read with no change lists nothing). "Read again" in the same
visit, or a second visit before deploying, would otherwise drop the warning for edits the
deployment still overwrites. So the page keeps the list until a deployment: a `kind: 'directEdits'`
document in the target's `_SA_EXTENSION__rdc_deployments`, holding the paths only
(`envs/target/…`, the org's own slugs, in the org's own storage; no content). Each read adds what
it found; a finished Write empties it, because a deployment overwrites every object it plans.
When Data Storage refuses, the page shows the edits for this visit and says they are not
remembered. Dropping the document would make the warning "since the last read", which is
simpler and loses the cases above.

**What the admin sees** (owner, 2026-11-03: no per-object choice). The Read step lists them
("Changed directly in <target> since the last deployment"). Review lists, first and as a warning,
every planned change to one of those objects: "This deployment replaces them with <source>'s
version." There is no Keep: Write never puts target files back.

## 6. Writes, the lock, and how the page reports rdc's errors

What each step writes:

| Step | Writes |
|---|---|
| Read both | Sync state and tree of each env, in each env's own org |
| Plan (`migrate` dry run) | Nothing (§9 asks rdc to confirm) |
| Write | The target's configuration, then its state |

`CLAUDE.md` and the Read step's text say this instead of "rdc writes nothing to either org".

**Web Lock.** Shared by every page of the extension's origin in one browser profile, named per org,
never waited for (§2). Two Console tabs reading or deploying the same org exclude each other. A
CLI run, another browser or another machine is not excluded; the manifest's compare-and-swap makes
the loser fail (rdc spec §3).

One pure function, `runErrorFor` in `src/rdc/core.ts`, maps rdc's message to the page's text,
keeps the raw message visible under it, and matches rdc's exact phrases (pinned in tests):

| rdc says | The page says |
|---|---|
| `already being synced in another tab` | "Another tab of this browser is reading or deploying this org. Finish or close it, then retry." |
| `Web Locks are not available in this context` | "This browser cannot lock the org while rdc works, so rdc did not start." |
| `was changed by another run` | "Someone else ran rdc on this org at the same time. This run stopped; read both orgs again." |
| `loading the sync state of env` | "rdc could not load its sync state from the org's Data Storage, so it did not start." |
| `an unfinished run's create may have made any of` | "A deployment stopped in the middle, and rdc cannot tell which of several objects it created. Delete the extra ones, then retry." |

**Recovery prompt.** rdc adds a dedicated `PromptKind` with the full question (§1.5). The page
shows it like any prompt, titled "A deployment stopped in the middle". Until a build has it, the
question is only the key menu (§2), so the page also shows the last log line above the choices.

## 7. The wasm version, and developing against a local build

The package is published only when rdc releases. Until then:

1. **Build outside both trees' tracked files.** From the rdc repo, with the target dir and the
   output in the extension's git-ignored `.rdc-wasm-local/`, nothing is written in the rdc repo:

   ```sh
   X=<extension>/.rdc-wasm-local
   (cd <rdc>/wasm && CARGO_TARGET_DIR=$X/target cargo build --locked --release --target wasm32-unknown-unknown)
   wasm-bindgen --target web --out-dir $X/pkg $X/target/wasm32-unknown-unknown/release/rdc_wasm.wasm
   ```

   `wasm-bindgen` must be the version `wasm/Cargo.toml` pins (`=0.2.129` today). This ran on
   2026-11-03: about a minute, `git status` in rdc clean afterwards. A branch that is checked out
   elsewhere is built from a `git worktree` outside the rdc repo, or from `git archive` output.
2. **Point the build at it with an env var, not at `node_modules`.** `build.js` and
   `tests/rdc-wasm-node.test.ts` read `RDC_WASM_DIR` when set, else
   `node_modules/@mrtnzlml/rdc-wasm`: `RDC_WASM_DIR=.rdc-wasm-local/pkg npm run build`. No
   `npm link` and no `npm install <path>`: both rewrite `package.json` / `package-lock.json`.
3. **The committed dependency stays `^0.15.0`** until rdc publishes. Then
   `npm install @mrtnzlml/rdc-wasm@<version>` with the token, re-read `rdc_wasm.d.ts` against
   `wasm.ts`, commit `package.json` and `package-lock.json`. `^0.15.0` does not match 0.16.x.
4. **Feature detection** (decision 6): `typeof project.useDataStorageState === 'function'` and
   `typeof project.migrate === 'function'`. A build that has the method but refuses `collection`
   counts as not having it (§3).

`wasm.ts` gains `useDataStorageState`, `migrate` and the `PromptKind` union, copied from the
generated `.d.ts` of the `feat/wasm-migrate` spec once it is committed. No lockfile type is added:
nothing in the extension reads a lockfile.

## 8. Test plan

Unit tests, Vitest, with the existing fake project (`tests/rdc-read.test.tsx`):

- `deploy.ts`: `stateKeyFor(orgId)` and `STATE_COLLECTION`.
- `core.ts`: `runErrorFor` maps each phrase in §6 and passes anything else through;
  `diffEnvTree` gives added, changed and removed object paths.
- Read: `useDataStorageState({ key, collection })` once, before the first sync; the runs in order
  source `noPush`, target `dryRun`, target `noPush`; a build without the method, or one that
  refuses `collection`, runs in memory with the note and no `useDataStorageState`; the
  direct-edit list from the diff, merged into the stored list; the lock error text and Retry.
- `sourceStore.ts`: load, merge and clear of the `directEdits` document.
- Plan, Review, Write against a fake `migrate` result (shape from the rdc spec): Review warns about
  direct edits with no choice; Write disabled until the typed name matches; Write runs one push
  sync, never writes target files back, and empties the remembered list.
- `tests/rdc-wasm-node.test.ts`, when a real build is present (`RDC_WASM_DIR` or the package): the
  method exists; it refuses an unknown option; a held `navigator.locks` lock on
  `rdc:<apiBase>:<orgId>` makes `sync` reject with the lock message. Network-free: the env's
  `apiBase` is a closed local port.

A live run (not done; it writes to two orgs and needs the owner's approval): a sandbox target and a
source; read both and check `_SA_EXTENSION__rdc_state` appears in both orgs and nothing else
changed; edit an object in the target by hand and read again (the edit is listed); open a second
tab on the same target (refused); deploy, close the tab after the first create, reopen and deploy
again (no duplicate, a recovery line in the log); clean up.

## 9. Built against rdc's `feat/wasm-migrate` spec (2026-11-03)

rdc's spec (`docs/superpowers/specs/2026-11-03-wasm-migrate-design.md`, commit `86c543d6`)
answered the first draft's questions:

- **`migrate` loads the stored state itself**, holds the target's Web Lock, and checkpoints the
  target only when it is not a dry run. A dry run writes nothing. Plan is therefore a plain
  `migrate({ dryRun: true })` on the read's project.
- **The first run of an env in a `Project` replaces its tree with the stored one** (spec §2,
  "No K"). That is what the read's target `dryRun` relies on to snapshot the last run's tree.
- **`.rdc/mapping.toml` is the host's** (spec §3). The page keeps it in
  `_SA_EXTENSION__rdc_deployments` as `{ kind: 'mapping', domain, orgId, text }`, **one document
  per source org** (the filter names the source: a read of another source scaffolds an empty
  mapping, rdc `src/cli/init.rs` `write_mapping_scaffold`, which must not overwrite this one's
  rows). Another source starts without a mapping, because a stale one makes the next
  migrate delete and re-create the renamed objects. It is written into the project before the
  reads and saved when a read or a Write changed it. A mapping that cannot be loaded **or saved**
  fails the read, for the same reason.
- **Recovery prompt**: kind `recoverCreate`, full question. The page titles it "A deployment
  stopped in the middle".

Direct edits are tied to objects by rdc's own identity, `MigrateFile.kind` / `.slug` (rdc
`1ff97899`), the one `PlanItem` and `SkippedItem` use; the page's earlier path grouping
(`objectOf`) is gone (2026-11-04).

**Re-checked against rdc `feat/wasm-migrate`** (code `8c0d2406`; `a1c57081` adds docs and a
comment only): `Project` caches one store per env, and hydrate merges the stored tree with the
host's. The read's detection holds. In a new project the dry run is the env's first run, so it
has no known manifest and the tree becomes exactly the stored one ("No K"); hydrate also runs
under `dryRun` and records the manifest it read. The pull that follows uses the same cached store,
finds the known manifest unchanged ("K = M") and leaves the tree as the dry run wrote it, then pulls.
Verified in Node against the real build with a fake org over `fetch`: a first read reports a
baseline, a second read with no change lists nothing, and a label renamed in the org lists exactly
`envs/target/labels/hold.json`. One edge: the Web Lock is released between the two runs, so
another tab's run that slips in there makes "K ≠ M"; its own changes then show as direct edits.
That over-warns; it never hides an edit.

*Withdrawn:* a first build had a Keep choice per object, restoring files after the migrate. The
owner had not approved it and it was removed on 2026-11-03, with its tests.

### Review fixes (independent review, 2026-11-03)

- **Unpushed target changes.** migrate's `files[].change` compares with the local target tree
  (rdc `src/cli/migrate/mod.rs`, `FileOutcome`), not the org. After a Write whose migrate was saved
  but whose sync never finished, the next plan said "unchanged" while Write would push it all.
  Plan now also runs `sync(target, { dryRun: true, interactive: false })` and Review shows its log
  as "Already waiting to be written". rdc's dry-run `sync` resolves an all-zero `CycleOutcome`, so
  the lines are shown as rdc wrote them; nothing is parsed. Verified with the real build: an
  unpushed label edit shows as `patch labels hold`. A Write's migrate drops the page's plan, so
  Back plans again.
- **Deletes.** Write never passes `allowDeletes`. rdc's delete gate then lists every object it
  would delete in the log and asks (`deleteGate`, rdc `src/cli/push/deletes.rs`), which the page
  shows with the log beside it.
- **Truthful Done.** The direct-edit list is emptied only after a write with no conflict and no
  question asked; Done names the conflicts and questions when there were any.
- **Locks.** A lock refusal while one of this page's runs is still in flight (an abandoned read)
  names this tab (`runs.ts`). The direct-edit list's load-merge-save runs under a page Web Lock,
  so tabs of one browser cannot drop each other's additions. The mapping document has no lock:
  it is per source, and two tabs saving the same source's mapping write what rdc produced from
  the same rows; between browsers neither document has a compare-and-swap (accepted, as rdc
  accepts two machines on one org).

### Adopting rdc's dry-run plan and skipped items (2026-11-04)

rdc `feat/wasm-migrate` (`4765c865`) returns `CycleOutcome.plan` from a dry run and
`CycleOutcome.skipped` from every run, and documents migrate's `ObjectChange` as describing the
target tree. The page now:

- **Plans on a scratch copy.** Review must show what Write sends to the org, which is the target
  sync after the migrate. A migrate dry run leaves the tree unmigrated, so a dry-run sync after
  it would describe the tree before the plan. Plan therefore copies the read's project
  (`new Project(files)`, no Data Storage state, so nothing is saved and no state is touched),
  migrates the copy for real and dry-runs the target sync on it. `plan` covers request 3 of
  §10 (migrate measured against the org): it is the sync's own classification against the base
  and the org, leftovers of an earlier unfinished write included. Verified against the real build
  in Node: a copy's dry run lists an unpushed label edit as `{labels, hold, push, update}` and
  skips nothing.
- **Review lists objects from `plan`**: created, updated, deleted (rdc asks before it deletes),
  both changed, read back, `recovered` and `problems`; rdc's dry-run log stays in a `<details>`.
  The "Already waiting" log panel is gone.
- **Done lists `skipped`** with rdc's reasons. With `MigrateFile.kind` / `.slug` (rdc
  `1ff97899`), a direct-edit warning is cleared exactly for an object the plan sends and
  `skipped` does not name (`remainingAfterWrite`). A file rdc names no object (`overlay.toml`,
  `_index.md`, docs) loses its warning. Since rdc `717dc54a`, `MigrateResult.pruned` carries the
  same identity, so a direct edit on a file `mirror` deletes is warned and cleared by object too.

### The page stores rdc's state (owner, 2026-11-12)

rdc no longer reads or writes Data Storage for its state (rdc `main`, `2f03d30d`, the
wasm-migrate spec's "§0. The host does the state's storage I/O"). `useDataStorageState` and its
`key`, `collection` and `chunkBytes` are gone; rdc calls the host's
`useStateStore({ load, save })` with an opaque snapshot per env and keeps every decision about it
(when to load and save, the three-way merge, "changed by another run", the Web Lock).

The page's store (`src/rdc/stateStore.ts`, wired by `keepStateInOrgs`):

- **Where.** One document per env, in that env's own org, `_SA_EXTENSION__rdc_state`:
  `{ _id: '<stateKey>/<env>', rev, snapshot: <base64> }`, through the same Data Storage helper
  the page uses for its own documents (`dataStorageFor`, now taking the collection). The key is
  unchanged (§4).
- **Load** is one `find` by `_id`; nothing stored → `null`.
- **Save** is one write: `insert_one` when `expectedRev` is null, else `replace_one` filtered on
  `{ _id, rev: expectedRev }`, true when `matched_count === 1`. A first save that finds a
  document already there lost the race: `false`. rdc's contract leaves a write whose answer was
  lost to the host, so a failed write is read back: our rev and snapshot there → `true`; another
  rev → `false`; otherwise the error is thrown with "saving the sync state of env '<env>' to Data
  Storage: …".
- **Limits.** A snapshot whose base64 plus a 4 KiB margin exceeds MongoDB's 16 MiB document
  limit is refused before any write: "The sync state of env '<env>' is N MiB in Data Storage,
  over its 16 MiB document limit."
- **The old format.** A `<key>/<env>` document with `files` and no `snapshot` (rdc's earlier
  manifest) loads as `null`. The first save then finds it, replaces it (filtered on
  `snapshot: { $exists: false }`), and deletes that env's old blobs with one `delete_many` on
  `_id` matching `^<key>/<env>/blob/`. Whether Data Storage accepts `$regex` in a
  `delete_many` filter is not verified; a refusal fails that save with its message.
- Never logged: the snapshot and the tokens.

### The hooks' token owner (owner, 2026-11-13)

The first live run's Write failed after three hook creates: "store extension is missing required
field 'token_owner' for /hooks/create". Verified in rdc `main` (`243bf462`):

- rdc strips a hook's `token_owner` from cross-env comparisons and PATCH bodies
  (`src/snapshot/create.rs`, `strip_for_cross_env_patch`, `strip_patch_extra`): a user URL of
  one org means nothing in another.
- `migrate` writes the target overlay's per-hook `token_owner`, or the kind-wide
  `[hooks."*"] token_owner`, into every hook it copies; with neither, a new hook keeps the source's
  value (`src/cli/migrate/mod.rs` tests around `transform_applies_wildcard_default…`).
- Only a **store extension** (`extension_source: "rossum_store"`) **on create** needs one:
  `push/hooks.rs` sends it to `POST /hooks/create` through `build_install_body`
  (`src/cli/deploy/store_extensions.rs`), which refuses a missing or null `token_owner`. Other
  creates and every PATCH go without that check.

So Review asks only when the dry-run plan creates such a hook (`storeHookCreates`, which reads
the hook's file in the migrated scratch copy), or when the target already stores an owner (so it
can be changed). The picker lists the target org's active users (`GET /users`, session token).
The choice goes into `envs/target/overlay.toml` as `[hooks."*"] token_owner = "<user url>"`
(`tokenOwner.ts`, a line edit that leaves the rest of the file alone), before the migrate in
Plan's scratch copy (Review plans again on every change, so its list matches Write) and in Write.
The overlay is part of the env tree rdc persists, so the next visit's read restores it and the
picker pre-selects it. Review lists it under "Own values". Verified against the real build in
Node: the migrated hook carries the owner the page wrote.

### The two reads at once (owner, 2026-11-13)

"Read both" starts the source read (`sync(source, { noPush })`) and the target pair
(`sync(target, { dryRun })`, then `sync(target, { noPush })`, in that order for the direct-edit
diff) together. Decisions:

- **A failure does not cancel the other branch.** rdc has no way to abort a running `sync` (only
  a watch has `stop()`), freeing the project under a running sync is unsafe, and a finished
  read has already saved its state, so a retry starts from it. The page waits for both
  (`Promise.allSettled`) and reports both: "Reading <source> failed: … Reading <target>
  finished." Nothing is handed to Plan unless both finished.
- **Prompts are queued.** Before, the page kept one pending prompt, so a second would have hidden
  the first and left it unanswerable. Now each prompt joins a queue and the first is shown,
  labelled "About <org>" with that env's last log line; answering shows the next.
- **Leaving the step** answers every queued prompt `null` and starts no further run (the target's
  pull does not start after a dry run the page has left). A sync already running finishes in the
  background, as before; `runs.ts` still names it as this tab's if its lock refuses a new read.
- The mapping is loaded before both and saved after both. Whether two syncs of different envs
  can safely share the project's `.rdc/mapping.toml` is rdc's to settle, not the page's.

## 10. Open questions

For rdc:

1. **Done, 2026-11-04:** a structured dry-run plan and the skipped items (`4765c865`).
2. **Done, 2026-11-04:** `MigrateFile.kind` / `.slug` (`1ff97899`).
   And `MigrateResult.pruned` entries carry it too (`717dc54a`).
3. **Done:** migrate measured against the org is covered by the dry-run plan on a scratch copy.
4. **Done:** rdc treats every `_SA_EXTENSION__*` collection as internal on every surface, the
   CLI included (rdc `CLAUDE.md`, owner decision 2026-11-03), so a CLI sync no longer mirrors
   `_SA_EXTENSION__rdc_state`.

For the owner:

2. Hook secrets: Write sends none (rdc pushes only the secrets the host's file names), so a new
   hook is created without its secrets. The page says so; typing them is not built.
3. "Only what I pick" stays disabled: it needs a picker over rdc's `--only` selectors.

Not verified:

- `navigator.locks` on extension pages in Chrome and Edge (verified in Node 24 only).
- Real Rossum API payloads: the Node tests fake the org with one label. Checked with the real
  build (rdc `8c0d2406`): the `collection` option, `migrate`'s option check, a migrate dry run
  writing nothing, its file identities in `overwrittenEdits`, and the direct-edit detection above.
- Anything against a Rossum org.
