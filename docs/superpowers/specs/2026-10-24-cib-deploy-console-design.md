# CIB deploy in the Console — design

**Date:** 2026-10-24
**Status:** built; a full Deploy live-tested on a test org.
**Scope:** new `src/cib/` (Console app), `src/console/` (rail item, render switch, boot, keep-mounted),
`manifest.json` (optional Coupa host permissions), `src/usage/event.ts` + `PRIVACY.md` (one event).

## 1. Why

Deploying the Coupa Integration Baseline (CIB) into a customer org used to need a local toolchain
(prd2, Python, the deploy tool). This app deploys a CIB release from the browser, signed in as the
org's admin, with no local install.

## 2. Rule: no CIB content in this repo

This repo is public. The extension bundles **no** CIB hooks, schemas, rules, engines or tenant
values. A run reads the chosen release from the public GitHub repo
`rossumai/rossum-coupa-integration` at the moment the user presses Check or Deploy. Tests use a
small synthetic org folder, or a release fetched from GitHub and cached in `node_modules/.cache`.

## 3. Sources at run time

| What | From |
|---|---|
| Release list | `api.github.com/repos/rossumai/rossum-coupa-integration/releases` (no drafts, no pre-releases) |
| File list of a release | the git tree of the tag (one API call; a truncated tree is an error) |
| Org folder files | `raw.githubusercontent.com` |
| Deploy settings, v2.x | the release's own `deploy/` (`cib_target.yaml`, `hooks.csv`, `required_scopes.json`) |
| Deploy settings, v1.x | `_config/` of `rossumai/coupa-integration-deploy-tool` at a tag the user picks from the supported list (`TOOL_REFS` in `release.ts`) |

Both hosts answer CORS with `*`, so no host permission is needed. A run makes 2 GitHub API calls
(rate-limited without sign-in); the rest are raw file reads.

## 4. Flow

1. **Compile** (`release.ts`, offline): the prd2 org folder becomes a create plan — ordered ops
   with `$ref` placeholders, a `match` key per op, and patches for references that point forward
   (engine training queues, hook `run_after`). A self-check refuses a plan that still names the
   source host, has a forward `$ref`, or has an op without `match`.
2. **Check** (`cib.ts`, read-only): the Coupa credentials (§6), the token owner (an active admin of
   the target org), existing CIB objects in the org (blocks unless allowed), the required scopes,
   and the region: it picks each hook's regional service URL, so a region other than the
   organization group's `deployment_location` blocks.
3. **Deploy**: create, patch, create the memorisation collections, invoke the import hooks, and
   wait until each import job has started. A dataset whose MDH operation log survived an earlier
   teardown gets a full first import (from the epoch), because the incremental anchor would
   otherwise import almost nothing.
4. **Checkpoint**: after each step the run state (`ops`, `cursor`, `idmap`, …) is written to the
   org's Data Storage collection `_cib_deploy_runs`. The Coupa secret is stored only as the
   placeholder `$secret:client_secret`. A re-run with the same run id resumes. A complete deploy
   deletes its checkpoint; a deploy with pending imports keeps it.

## 5. Console behaviour

- The token owner is picked from the org's active admins, with a search.
- `Console.tsx` keeps CIB mounted (hidden) once opened. Unmounting it lost the form, the log and
  the view of a deploy that kept running in the background — and a second Deploy press could then
  start a second run on the same run id.

## 6. Coupa credential check

Either from the browser — `POST <coupa>/oauth2/token`, only after the user grants the optional
`*.coupahost.com` / `*.coupacloud.com` permission — or through a **check function**: a function
hook ("CIB deploy: Coupa credentials check", manual invocation) that the user deploys and
tears down with explicit buttons, never as a side effect. The secret is PATCHed into the hook's
write-only `secrets` before each check; the invoke body carries only the token URL and client id.
The page treats a hook as the check function only when its name, type and code all match what it
deploys: a hook with the same name alone never gets the secret.
Whether the hook can reach Coupa depends on the org's serverless egress.
If a run reports that the secret could not be given to the hook (it was deleted elsewhere), the
page re-reads the org's check functions, so the UI stops pointing at a dead hook.

## 7. Limits

- The write path is client-side only, like the rest of the extension: there is no server-side
  guard beyond the user's own permissions.
- The API client sends the token only to the organization's origin, so a changed checkpoint or
  list cursor cannot send it elsewhere.
- Imports are reported as started, not finished; a large dataset can still be filling (`__tmp_*`
  collection) after the run reports done.
- No teardown in the app: removing a deployed CIB is out of scope.
