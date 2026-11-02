# CIB deploy: read the target, do not ask for it

Date: 2026-11-02. A delta on `2026-10-24-cib-deploy-console-design.md` and
`2026-10-30-cib-deploy-ux-refinement-design.md`.

## Change

Step 1 of the CIB page asked for four values: the CIB version, the organization ID, the region
and, for a v1.x release, the deploy tool version. Three of them have one right answer that the
page can read, so they are no longer form fields:

| Value | Read from |
|---|---|
| Release | GitHub `GET /repos/rossumai/rossum-coupa-integration/releases/latest` (`latestRelease`) |
| Organization | the one organization `GET /organizations` lists (`currentOrg`, as the connection bar) |
| Region | that organization's group, `deployment_location` (the field `preflight` compared with) |

Step 1 shows them read-only, with the token owner as its only input. The region used to default to
`prod-eu` for every org, so any other region was found only by Check's mismatch blocker.

## Decisions (owner, 2026-11-02)

1. **Zero or several organizations in the session**: "should never occur". The page shows an
   error and both run buttons stay disabled. The group-admin path (typing another org's ID of the
   group) is gone.
2. **Region unknown** (the group cannot be read, has no `deployment_location`, or names a region
   outside `REGIONS`): same as 1, an error and no run.
3. **v1.x releases** can no longer be deployed: expected. The v1.x machinery is removed:
   `TOOL_REPO`, `TOOL_REFS`, `TOOL_REF`, the `toolRef` option, the deploy tool `_config/` fallback
   and the `<org>/default` root guess. `loadRelease` refuses a release without `deploy/hooks.csv`,
   and one whose `source_dir` has no files.
4. **A new release between a run and its resume must not break the run.** `deploy` writes the
   release tag into the checkpoint document (`release`, an additive key). Before each run the page
   reads it (`checkpointRelease`) and loads that release instead of the latest; the log says so.
   A checkpoint written before this change has no tag and resumes with the latest release.
   Step 1 shows the release the run will use: when the run ID has a checkpoint with a tag, its
   release, captioned "From checkpoint" and without the "latest" chip. The page re-reads it 300 ms
   after the run ID changes and after every run, since a run creates or deletes the checkpoint; a
   failed read falls back to showing the latest, and the run's own read still decides.

## Unchanged

Steps 2 to 4, the token owner, the Coupa login check, `preflight` (its region comparison stays as a
guard; with the region read from the same field it cannot fire unless the group's location changes
between page load and run), and every request a run makes after the release is chosen.
