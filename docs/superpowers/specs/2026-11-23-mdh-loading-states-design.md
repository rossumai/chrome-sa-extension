# MDH loading states — design

Date: 2026-11-23. Mockup: `2026-11-23-mdh-loading-states-mockup.html` (open in a browser; states 0–7).
Approved by the owner on 2026-11-23 ("Looks good, go"), with the four open questions answered by
the recommendations: keep the faded previous answer on a re-run, the missing-index hint is in
scope, "Run on a sample" may edit the pipeline, and the work ships in two steps.

## 1. Problem

Dataset Management has one loading flag, `store.loading`, written by ten unrelated callers
(sidebar list, create/drop/rename, both index panels, operation logs, record edit/delete, bulk
update/delete, the query). Whichever is true paints `LoadingOverlay` over the whole main column.

- It says nothing: not what is loading, for how long, or how to stop it. On a 50M-record
  collection a refresh looked like an empty dataset (the trigger for this work, together with
  the unbounded type probe fixed in the same branch).
- It blocks everything, the editor included, so the user cannot fix the query that is slow.
- It lies while waiting: the record list rendered "0 records match" under the spinner before
  any answer arrived, and two writers to one boolean can switch it off while a query still runs.
- A query timeout (the API aborts every request at 30 s) surfaces as the generic top-of-page
  `ErrorBanner`.

## 2. Principles

1. **The region that changes shows the loading.** No full-column overlay for a query.
2. **Three primitives**: a status chip (what, how long, Cancel), skeleton rows for a first load,
   and the previous answer faded for a re-run.
3. **One timing ladder** for every region:

| Elapsed | Shown |
|---|---|
| 0–300 ms | Nothing changes. A fast answer replaces the old one; typing never flashes. |
| ≥ 300 ms | Chip "Running · N s" + Cancel (Esc). No records yet → skeleton rows; records → faded "previous run". |
| ≥ 10 s | Chip turns amber ("Slow · N s"); a notice explains the likely cause and the 30 s limit. |
| 30 s | The API aborts. The failure lands in the results area, not the global banner. |

## 3. Step 1 — the query (mockup states 1–5)

### 3.1 State

`store.queryRun` replaces `queryCancel` / `queryStartedAt` / `queryCancelled` (all three added
earlier in this branch, never released):

```ts
type QueryRun =
  | { phase: 'idle' }
  | { phase: 'running'; startedAt: number; cancel: () => void }
  | { phase: 'done'; count: number; ms: number }
  | { phase: 'cancelled'; afterMs: number }
  | { phase: 'failed'; message: string; timedOut: boolean; afterMs: number };
```

`useQuery` is its only writer. **A query no longer writes `store.loading` or `store.error`**, so
the overlay and the global banner are left to the other callers until step 2. A superseded query
writes nothing. Cancel and failure both clear `records` (they belong to a query the editor no
longer shows).

### 3.2 Results area (`RecordList`)

A pure `queryView(run, now, hasRecords)` decides one mode:

| Mode | When | Renders |
|---|---|---|
| `pending` | running, < 300 ms, no records | nothing (never "0 records match") |
| `records` | not running, or running < 300 ms with records | the records as today |
| `skeleton` | running ≥ 300 ms, no records | 10 skeleton rows |
| `stale` | running ≥ 300 ms, records | records at 50 % opacity, inert, an info notice "Showing the previous run", footer suffix "· previous run" |
| `cancelled` | cancelled | "Query cancelled after N s", the server caveat, Run again |
| `failed` | failed | danger notice (§3.4) |
| `empty` | done with 0 records | today's empty states |

A collection switch with nothing cached clears `records`, so the previous collection's records
are never shown as this collection's "previous run".

### 3.3 Status chip (results toolbar)

Between the view switch and Bulk. Text from the same pure core:

- done: `N doc(s) · M ms`; running ≥ 300 ms: `Running · N s` + Cancel; ≥ 10 s: `Slow · N s`
  (amber) + Cancel; cancelled: `Cancelled after N s`; timed out: `Timed out · 30 s`; other
  failure: `Query failed`.
- Esc cancels while the chip shows Cancel, unless a modal is open (a modal owns Esc).

### 3.4 Slow and failed notices

`slowCause(stages, indexes)` → `{ field } | null`: when the FIRST stage is a `$match` and none of
its top-level fields is covered by an index (an index whose first key is the field, a `$**`
wildcard, or a `prefix.$**` wildcard over it). `null` when the indexes are not cached (no
claim without evidence), when the first stage is not a `$match`, or when any field is covered.
Indexes come from `cache.get(collection, 'indexes')`, which the prefetch already fills.

- **Slow** (warning tone): "This query is taking a while — N s". "{collection} has {total}
  records" when the total is known; with a cause, "and `{field}` has no index, so the first
  `$match` reads every record"; then "Data Storage stops a request after 30 s." With a cause,
  bullets "Add an index on `{field}` in Indexes" and "or narrow the `$match`". Buttons: Open
  Indexes (switches to the Indexes tab), Cancel query.
- **Timed out** (danger tone): "The query did not finish within 30 s", "Data Storage stops every
  request after 30 s.", the cause sentence when known, bullets "Add an index on `{field}`, then
  run again" (with a cause) and "Try it on a sample". Buttons: Run on a sample, Run again.
- **Other failure** (danger tone): "The query failed" and the API message. Button: Run again.

`api.ts` marks its own 30 s abort: the thrown error carries `timedOut: true`.

**Run on a sample** prepends `{ "$sample": { "size": 10000 } }` to the editor text (one editor
change, so ⌘Z undoes it; no-op when the first stage is already `$sample`) and runs.

### 3.5 Pipeline Debug

Pending counts shimmer (a skeleton bar) instead of `…`. When the run is cancelled or fails, the
debug requests are aborted and counts that never arrived show `—`; finished counts stay.

### 3.6 What goes away

The query card in `LoadingOverlay` (back to the plain spinner, which only step-2 callers still
use) and the "Running query…" empty state.

## 4. Step 2 — writes and panels (mockup states 6–7; separate plan)

Every remaining `store.loading` writer gets a scoped indicator, then `loading` and
`LoadingOverlay` are deleted: row-level busy for a single-record write, a progress toast for
bulk update/delete and import (Details opens Operation Logs; only Bulk locks), the sidebar's ↻
as a spinner with a region bar, a region bar for the index panels and Operation Logs, Stats'
"N of M checks" as a determinate bar with Stop, and a spinner on a tab whose panel is working.

## 5. Not in scope

Cancelling server-side work (Data Storage has no endpoint for it; the copy says so), the 30 s
limit itself, and the Stages view's own loading.
