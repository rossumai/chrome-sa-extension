# CIB deploy: upgrade an installation to a newer release

Date: 2026-11-16. A delta on `2026-11-02-cib-deploy-auto-target-design.md`.

## What ships with it (already built)

1. **The Console bundle is `app.js` / `app.css`**, not `console.js` / `console.css`: the name `console.js` set off a false-positive security check. `console.html` (its URL is used everywhere) and `console.base.css` keep their names.
2. **A complete deploy keeps its checkpoint.** It used to be deleted. It now stays in `_SA_EXTENSION__cib_deploy_runs`, marked `complete: true, completed: <epoch s>`, as the record of what was installed: the release tag, the configured body of every op, and the `idmap` (op key → id, url). A run ID with a complete record is refused ("use a new run ID"), and `checkpointRelease` ignores it, so step 1 never shows it as a resume.

## Decisions (owner, 2026-11-16)

1. **Three-way merge, conflicts skipped.** Base = the installed release, new = the latest release, live = the org now. A release change is applied only where live still equals base. When the customer changed the same field too, it is a conflict: listed, and not touched.
2. **All op types**: engines, engine fields, workspaces, hooks, schemas, queues, inboxes, rules. Objects new in the release are created, as by a deploy.
3. **Objects removed from the release are reported only.** Nothing is deleted or deactivated.
4. **No install record** (deployed before this change, or by the Python deploy tool): the admin names the installed release tag, or leaves it empty and confirms the one the page suggests (owner, 2026-11-16). The page reads that release from GitHub as the base and finds its objects in the org by each op's `match` (name; engine + name for engine fields), as the deploy's adopt does.

## The base

- With a record: the newest `{kind: 'plan', complete: true}` document of the org (by `completed`). Its `ops` are already configured (Coupa URL and client ID in, the secret only as `$secret:client_secret`), and its `idmap` names the objects.
- Without one: `loadRelease(tag)`, each op's `match` resolved in the org, then `configurePlan` with the Coupa values of step 2. A value step 2 leaves empty is read from the org's own CIB schemas (the datapoints `coupa_api_base_url` and `oauth_client_id` of the schemas found by name), so step 2 can stay empty (`installFromOrg`). Names do not depend on the Coupa values, so the objects are found before the values are known.
- Without one and without a tag: Check upgrade compares the org with every published v2.x release (`deployableReleases`, one GitHub API call, plus one per release for its file tree). For each one it finds the objects by name and counts what the release sets that the org does not hold: 1 per differing value, a list counts only its missing elements (so a reordered list counts 0), and an object not found counts 1 (`guessInstalled`; read-only, the GETs are shared). The closest release is filled in as the installed release, and the check stops with an amber verdict and the counts. A second Check upgrade uses it, or the admin types another one. When two releases tie, none is filled in. On a test org deployed from v2.0.1 (2026-11-16), it picked v2.0.1 with 53 differences, against 54 for v2.0.0 and 134 for v2.1.0. Most of the 53 are the same for every release (the `active` flags the deploy's patches set), so the margin is the one real difference. An op that matches nothing is "missing in the org": the upgrade creates it if the new release still has it, and reports it otherwise.

The new release is configured with the same Coupa values. A value typed in step 2 wins, as without a record, and the log says when it differs from the record. A value step 2 leaves empty is read from the record (the schema datapoints `oauth_client_id` / `coupa_api_base_url`), so step 2 asks only for the secret, and only when the upgrade creates a hook marked `patch_secret` in `hooks.csv`.

## The merge

Placeholders (`$org`, `$token_owner`, `$ref:<key>`) in base and new are substituted with the org's values (the `idmap`) before comparing, so a `$ref` compares as the URL it stands for. `$secret:` values and write-only fields (`secrets`) are never compared and never written.

Per object, a recursive merge over JSON:

- **Objects**: key by key. A key in neither base nor new is the org's (server defaults, customer additions): untouched.
- **Arrays of objects that each carry a different `id`** (schema `content` and its `children`, nested), **or a different `//` label** (the entries of a hook's `settings.configurations`, such as "Coupa E-Invoicing"): merged element by element on that field. An entry the customer added stays, and only an entry both changed is a conflict. When the labels repeat, the list stays one value (atomic). The customer's own datapoints are untouched. A datapoint the release adds is inserted after its predecessor from the new release (or at the end). A datapoint the release removes is reported, not removed (decision 3).
- **Arrays of scalars** (a queue's `hooks`, a hook's `events`): merged as sets. What the release adds is appended, what it drops is removed, and what the customer added stays. So a hook the customer attached to a queue does not make a new release's hook a conflict.
- **Other arrays and scalars**: atomic. `live == base` → take new. `live == new` → nothing to do. Otherwise, if `new != base`, it is a conflict.
- **A key that the base lacks and the new release sets**: the release sets it for the first time, so it is taken, unless live already holds a different non-default value. Then it is a conflict. "Default" is not knowable over the API, so in practice: taken when live lacks the key, and a conflict otherwise.

The result per object is a PATCH body that holds only the changed top-level keys (for a schema, the whole merged `content`), plus a list of conflicts as `path: base → new, org has X`.

The new release's patches (the secret and active flag of `patch_secret` hooks, engine `training_queues`) run only for objects the upgrade creates. For an existing hook, the secret it already holds and its active flag stay. For an existing engine, `training_queues` is not touched.

## Flow on the page

Step 4 gets a third button, **Check upgrade**, next to Check and Check and deploy. It is enabled when the org holds CIB objects. It does the following and writes nothing:

1. Finds the base (record, or asks for the installed tag in an inline field when there is no record).
2. Reads the latest release and the live objects (`GET` each `idmap` url).
3. Shows step 5 as an **upgrade plan**: per object "update (n fields)", "create", "no change", "conflict (n)", "removed from release", "missing in org", with the conflicts' paths in a `<details>`. When base == latest, it says "already on <tag>".

**Upgrade** (enabled after a Check upgrade whose plan has changes) writes. Before each PATCH, it re-reads the object and redoes its merge, so an edit made between Check and Upgrade becomes a conflict rather than being overwritten. Creates go through the deploy engine (adopt, then create; Store-template hooks via `hooks/create`). Progress is checkpointed like a deploy, under the run ID `cib-upgrade-<new tag>`, with `upgradeOf: <base release>`. The ID is derived, not typed, so the next Upgrade click resumes a stopped one. The checkpoint is seeded with the `idmap` of the existing objects, so the deploy engine creates only the new ones. The updates are not cursored: each one is re-merged, and an update already applied merges to nothing. Imports are invoked only for import hooks it **created**, and the page does not wait for their datasets.

When it finishes, the new run's document becomes the install record: `complete: true`, `release: <new tag>`, ops = the new release's configured bodies, idmap = base idmap + created objects, and `conflicts` = every conflict left, as `<key> <path>: ...`. The next upgrade then diffs against the new release. A conflicting field stays the customer's, and it shows as a conflict again only if a later release changes it again. The old record stays, so the history of installs is the list of complete records.

## Code

- `src/cib/upgrade.ts` (new): `findInstall(c)`, `installFromRelease(c, tag, ops, orgId)`, `installFromOrg` and `guessInstalled` (the base without a record), `coupaFromInstall(ops)`, the pure `merge3(base, neu, live)` → `{patch, conflicts, removed}`, `upgradeCib(c, {install, plan, ..., apply})` (Check upgrade with `apply: false`, Upgrade with `true`; it reuses `deploy()` for creates and the checkpoint), and `upgradeVerdict`. `engine.ts` exports `adopt` for it.
- `cib.ts`: `preflight`'s "CIB objects already present" blocker stays for a deploy. The upgrade runs `preflight` over the objects it creates only (token owner, hook timeout, Store templates), with that blocker and the leftover-schemas note dropped. When it creates a hook that needs the Coupa secret, an empty secret is a note in Check upgrade and a blocker in Upgrade.
- UI: `DeployStep.tsx` (buttons, installed-tag field), `RunResult.tsx` (plan view), `App.tsx` (state), `help.tsx` (a section on upgrade, with `data-help` targets).
- Tests (`tests/cib-upgrade.test.ts`): a real v2.0.0 → v2.0.1 upgrade in the fake API (one change: the `settings` of the hook "Coupa E-Invoicing"; no conflicts and nothing created), then `merge3` cases (untouched, taken, conflict, schema datapoints added/removed/customer-added, key new in the release), `planUpgrade` and `runUpgrade` against `tests/support/fakeRossum.ts`, including the re-read-before-PATCH conflict and a resume.

## Measured on a test org (2026-11-16)

An org deployed from v2.0.1 by a build that still deleted its checkpoint. All 219 objects were found by name and match v2.0.1, except for the hook order on six queues and one entry the customer added to the "Coupa E-Invoicing" `configurations`. Before the `//` merge, that list was one conflict, so the hook would have got no Italy or Mexico entry. After it, the upgrade to v2.1.0 plans 15 updates, 20 creates and 0 conflicts, both from a seeded install record and without one.

## Not in this change

- A live check in a real organization: the upgrade is tested against `tests/support/fakeRossum.ts` only.
- Updating an existing engine's `training_queues`, or the secret of an existing hook.

- Picking single changes, or "take release" for a conflict (owner chose skip; add a per-conflict choice when it is asked for).
- Downgrade, or upgrading to a tag other than the latest.
- Deleting or deactivating removed objects.
