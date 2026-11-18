# Academy redesign: one client project, named-object checks, instant ticks

Date: 2026-11-13
Status: approved by the owner (mockup review, 2026-11-13); replaces the curriculum, checks and UI
of `2026-08-07-partner-onboarding-training-design.md`, which stays as the base record for the
gate, the storage cap and the signed receipt.

## 1. Why

The Academy shipped behind `experimentalUnlocked` and was never used. The owner wants better
guides and design, and doubts the checks. Three things were wrong with the checks:

- They compared org-wide counts and id sets with a mission-start baseline. Anyone else working
  in the same org could tick a step or un-tick it at mint time.
- They could only say "something grew", never what is missing.
- They polled every 20 s, so a tick took up to 20 s to appear.

## 2. Goals, non-goals, anti-goals

Goals:

1. The training is ONE fictional client project, Acme Freight accounts payable, told across six
   missions. Each mission opens with a short message from the client.
2. Every task states up front what the Academy will check ("Done when"), and a failed check says
   exactly what to fix.
3. A check finds the trainee's OWN objects by name, so other people in the org cannot affect it.
4. A task ticks within about half a second of the trainee pressing Save in Rossum.
5. The coach on the Rossum page keeps the always-on tether, can be minimised to a pill and opened
   again from the pill, the popup or the Academy.

Non-goals: a credential (the receipt stays a training artifact, its key ships in the bundle);
seeding the org; grading by an agent.

Anti-goals: the training must never write to the org (`Training never mutates` invariant); the
page listener must never change or delay Rossum's own requests; a 429 is never retried
automatically.

## 3. Approaches (decided in conversation)

Checks — picked **named objects**:

- Baseline deltas, bugs fixed: vague feedback, still broken in a shared org.
- **Named objects (picked)**: each brief names what to build, suffixed with the trainee's handle;
  the check finds that object and reads its shape. No baseline, exact feedback, read-only.
- The Academy builds a sandbox: best experience, but breaks `Training never mutates`.

Detection — picked **listening to the app's own saves**:

- **MAIN-world listener (picked)**: a content script in the page's world wraps `fetch` and
  `XMLHttpRequest`, and after a successful non-GET to the same origin's `/api/` or `/svc/` posts
  `{method, path}` to the isolated content script, which checks at once. No new permission.
- Polling every 2 s: ~30 GETs a minute, more 429s, ticks still up to 2 s late.

## 4. The trainee's names

`handleOf(username)`: the part before `@`, lowercased, every run of characters outside
`[a-z0-9]` replaced by `_`, trimmed of `_`, at most 24 characters. `martin.zlamal@x` → `martin_zlamal`.

| Object | Name |
|---|---|
| Queue | `Acme AP · <handle>` |
| Dataset | `acme_vendors_<handle>` |
| Rule | `Acme PO required · <handle>` |

The Academy shows each name with a Copy button.

## 5. Curriculum

Six missions, linear unlock (a mission opens when every task of the previous one has passed
once). Tasks are all checked; there are no self-attested steps any more.

1. **Kickoff** — create the queue `Acme AP · <handle>` (any workspace); open its settings
   (visit, the queue's own detail page).
2. **Capture what Acme needs** — the queue's schema has `po_number` and `vendor_vat_id`; it has
   `vendor_match` of type `enum` (MDH writes options into an enum).
3. **Load the vendor master** — the dataset `acme_vendors_<handle>` exists; it holds at least 40
   records (the Academy offers `acme-vendors.csv`, 40 fictional vendors, generated in the page).
4. **Match every invoice to a vendor** — a hook with MDH settings
   (`settings.configurations[].source`) is attached to the queue; a configuration reads the
   dataset and its FIRST query uses `vat_id` and `{vendor_vat_id}`; its mapping writes into
   `vendor_match` (`mapping.target_schema_id`) with a `dataset_key`.
5. **Stop bad invoices early** — the rule `Acme PO required · <handle>` runs on the queue; its
   trigger condition reads `po_number`; it has an enabled `show_message` action of type `error`.
6. **Go live with one invoice** — the queue holds at least one annotation; one annotation in
   `confirmed` or `exported` has a non-empty `vendor_match`.

Each task carries: title, why (one or two sentences), where (a breadcrumb in Rossum), a coach
anchor (`data-cy` or `hrefIncludes`, plus the side the tether arrives on), and its assertions.

## 6. Checks

Pure core in `src/training/checks.ts`: `evaluate(task, ctx) → Assertion[]`, where an assertion is
`{ id, label, state: 'ok' | 'no' | 'pending', fix? }`. `ctx` is built by `src/training/load.ts`
from a memoised per-run loader with an injected `get`, fetching only what the current mission's
tasks need:

- queue: `GET /api/v1/queues?name=<name>` (exact match, measured 2026-11-13)
- schema: `GET` the queue's `schema` URL (reduced to a path)
- hooks: `GET /api/v1/hooks?queue=<id>`
- rules: `GET /api/v1/rules?name=<name>`
- dataset: `POST /svc/data-storage/api/v1/collections/list` with `{filter: {name}, nameOnly: true}`
  and `POST /svc/data-storage/api/v1/data/aggregate` with `[{$count: 'n'}]` (both list queries;
  Bearer; measured)
- annotations: `GET /api/v1/annotations?queue=<id>&page_size=1`, then
  `?queue=<id>&status=confirmed,exported&ordering=-modified_at&page_size=5` and each one's
  `/content` until one has `vendor_match` filled

Who runs it:

- The **content script** runs the current mission's checks on a save signal (debounced 250 ms),
  on window focus, on route change, and every 30 s while visible. Every check bypasses the fetch
  cache (`ttlMs: 0`).
- The **Academy** runs the same checks on open, on window focus and on a Check now button.

A 429 from either stops automatic checks and says so; the next focus or click checks again.
Any other failure leaves the last result in place and marks it stale.

## 7. Progress

New key `academyProgress` in `chrome.storage.local`, per org origin, same soft cap of 3 and the
same receipt exemption as before (`pruneOrgs`). `trainingProgress` is orphaned, not deleted.

```
{ trackId, trackVersion, startedAt, handle,
  tasks: { [taskId]: { passedAt } },           // sticky: unlocks the next mission
  results: { [taskId]: { at, assertions } },   // latest check, shown in both surfaces
  build: { queueId, schemaId, fields, hookId, ruleId, dataset, records, annotationId },
  receipt? }
```

`build` holds ids, counts and the trainee's own names only. A task whose latest result fails
after it passed shows "Changed since it was checked"; the receipt needs every task passing NOW.

## 8. The coach on the Rossum page

Expanded card (bottom right): mission title, "Task n of m", the task, its assertions with the fix
note, a footer with when it was last checked ("Checked 0.4 s after your save") and Open in
Academy. On a pass: a toast "Task checked: <task>", and the tether moves to the next task.

`–` minimises to a pill ("Mission 4, task 3 of 3"); a pass gives the pill a green ring and the
toast still shows. The tether stays on, drawn from the pill. Minimised is remembered in
`academyCoachMinimised` (all tabs). The pill, the popup's **Training → Show coach** and the
Academy's **Open your queue in Rossum** expand it. The popup's **Coach on Rossum pages** switch
writes `academyCoachOff`: no card, pill, tether or checks on any tab until it is turned on.

Tether: unchanged geometry, plus an optional arrival side per anchor (`side: 'below'`), so a head
cannot land on the neighbouring control.

## 9. The Academy (Console)

Left: the client and the six missions (done / current / locked), and the count of tasks checked.
Main: mission title, the names with Copy, the client's message (serif), the task cards (passed
ones collapsed), and **Your build**, a board drawing queue, schema and its new fields, dataset
and records, the matching hook (flagged when matching on name), the rule and the invoice, from
`build` and the results. When every task passes: the handover — "Acme Freight is live", what
was built with ids, and Issue/Copy summary. A trainer checks a summary from a link in the left
column.

## 10. Receipt

Same HMAC key and Crockford code. Prefix `RSA2`, header `ROSSUM ACADEMY — COMPLETION SUMMARY`.
Signed and printed: track@version, org host, user (name and id), queue id, hook id, rule id,
annotation id, issue date. Before issuing, every task is checked again and must pass.

## 11. Usage events

Unchanged: `sa_training_start`, `sa_training_mission_complete`, `sa_training_receipt_issue`,
`sa_training_receipt_verify`, `sa_console_app_academy`.

## 12. Left to the builder

The exact `data-cy` anchors (verify live; a missing anchor draws no tether, never blocks), copy
wording, and the CSV's fictional vendors.

## 13. Measured on the test org, 2026-11-13

A full pass through all six missions, with the built extension loaded:

- The coach ticked a task 0.5–0.7 s after Rossum's own save (queue creation, the review
  screen's field edits, Confirm). The debounce is most of it, since Rossum sends saves in pairs.
- Rossum sends reads as POSTs on every navigation — `POST /api/v1/annotations/search` and
  `POST /svc/otel/v1/traces` — so the save signal excludes read-only POST paths; reporting them
  made the coach say "after your save" when nothing was saved.
- The project's AI field names (`order_id`, `sender_vat_id`) come from the Generic engine, so the
  kickoff task tells the trainee to pick it when creating the queue.
- Rossum saves a rule only once it has a condition, so the two rule tasks usually pass together.
- The MDH extension runs as its token owner: an owner without MDH access in the org makes it
  answer 401 and leaves `vendor_match` empty. The matching task's copy says to pick an admin.
- Anchors read live: `add-workspace-queue-control`, `queue-settings-btn`,
  `queue-settings-header-tab-fields`, `extensions-navtab`, `add-rule-button`.

## 14. Delta, 2026-11-16: run codes and Start over

- **Names identify a run, not a person.** The trainee's handle is gone. Every run gets a code from
  `newRunCode` (a freight word and two digits, e.g. `barge-17`), and every name follows a fake
  Acme convention built from it: `AF · AP Invoices · barge-17`, `af_vendor_master_barge_17`,
  `AF · PO required · barge-17`. The copy says the code tells the Academy what was built in this
  run — "nobody else" was the wrong framing, since one trainee per org is the common case.
- **Start over asks** (owner): delete what the run built, or keep it and start a new run. Either
  way progress and any summary are cleared and a run with a different code starts at mission 1;
  the old run's objects carry the old code, so no check counts them.
- **Deleting** is the one exception to `Training never mutates` (§2's anti-goal is amended to
  that one confirmed action). `src/academy/cleanup.ts` deletes, in order: the run's rule; MDH
  hooks attached to the run's queue only and reading its dataset; the queue at once
  (`delete_after=0`) with its documents; its schema when no other queue uses it; the dataset. The
  workspace stays. A failure keeps the run and lists what is left, with Retry.

## 15. Delta, 2026-11-16: stopping and undone work

- **Stopping and continuing.** Progress, run code included, is in `chrome.storage.local` only;
  the earlier copy saying it "stays in the org" was wrong and is gone. The spine says progress is
  saved in this browser, shows the run code with a copy button, and holds the coach switch. The
  landing page has "Continue an earlier run": a run code re-creates progress and checks forward
  through every mission whose objects already exist (the settings visit is inferred from an
  existing queue).
- **Complete or not (owner).** §7's `tasks[id].passedAt` and the "Changed since it was checked"
  state are gone: a task is complete exactly while its latest check passes, and a mission opens
  once every earlier mission is complete. The settings visit is the one confirm-only task: on any
  other page its check says nothing, so the visit stays made.
- **Undone work.** Checks cover every mission up to the current one, so a deleted queue makes
  Kickoff incomplete again and the coach and the Academy go back to it. A queue in `deletion*`
  status counts as gone (Rossum keeps a deleted queue 24 h, still answering `?name=`).
  Save-triggered checks are spaced at least 2 s apart, because a check now reads more.
- **Open Rossum** opens its tab right after the Console's tab, and always on Documents (owner):
  the trainee navigates from there, so each task has a route instead of one anchor — steps from
  the control that does it back to the run's queue in the sidebar (`sidebar-queue` holding the
  queue's name), with `ownQueue` steps (the gear, the settings tabs) only on pages about that
  queue. The tether points at the furthest step on the page and re-picks twice a second.
- **A complete mission** shows "Mission complete" with a button to the next one (or the handover).

## 16. Delta, 2026-11-16: the tether on demand

Always-on proved too disruptive (owner). The coach draws no tether until the trainee presses
**Show me where** under the current task; it then follows that task's route and ends when the
task changes. **Hide the way** and minimising put it away; reopening the card brings it back
while the task lasts. When no step of the route is on the page, the card says where to start
instead ("Start from Documents: <queue> is in its sidebar"). §8's "always on" is superseded.

## 17. Delta, 2026-11-18: the Academy page only

The owner removed everything the training drew on Rossum pages: the coach card and pill, the
tether and its routes (`src/training/wayfinding.ts`, `src/training/tether.ts`), the page-world
save signal (`src/rossum/saveSignal.ts`, its manifest entry and build entry), the popup's
Training row and the coach's storage keys. §3's detection approach, §8 and §16 are superseded.
The Academy page in the Console is the whole training: it checks on open, on window focus and on
Check now. Kickoff's "Open the settings of your queue" was a visit only the coach could see, so
it was removed with it; the track has 12 tasks.
