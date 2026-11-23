# MDH loading states, step 1 (the query) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the query's use of the global loading overlay with scoped states in the results area: status chip, skeleton, stale answer, slow/timeout notices, cancel.

**Architecture:** `useQuery` publishes one `QueryRun` signal; a DOM-free core (`queryStatus.ts`) turns it into a view mode, chip text and a slow-cause hint; `RecordList`, a new `QueryStatus` chip and a new `QueryNotice` render it.

**Tech Stack:** Preact + @preact/signals, CSS Modules, Vitest (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-23-mdh-loading-states-design.md` (§3).

## Global Constraints

- Thresholds: `SHOW_AFTER_MS = 300`, `SLOW_AFTER_MS = 10_000`; the API limit stays `REQUEST_TIMEOUT = 30_000`.
- Sample size for Run on a sample: `10000`.
- Every hand-written class contains a hyphen; new styles are CSS Modules; tokens only from `src/console/tokens.css`; 11px text never on `--text-secondary`.
- JSX text: use `{'…'}` / `{'—'}`, never `…` in raw text.
- Copy exactly as in spec §3.3–§3.4.

## Review Focus

1. A query superseded while running must not overwrite the newer run's `queryRun` — pinned in Task 2.
2. Esc with a modal open closes only the modal — pinned in Task 4.
3. Collection switch must not show the previous collection's records as "previous run" — pinned in Task 5.
4. A write pipeline never auto-runs; Run again / Run on a sample go through `runQuery`, which keeps that gate — pinned in Task 5.
5. `slowCause` with indexes not cached claims nothing — pinned in Task 1.

---

### Task 1: Pure core `src/mdh/queryStatus.ts`

**Files:** Create `src/mdh/queryStatus.ts`; Test `tests/mdh-query-status.test.ts`.

**Interfaces — Produces:**
- `type QueryRun` (spec §3.1; exported here and re-exported by `store.ts`)
- `SHOW_AFTER_MS`, `SLOW_AFTER_MS`, `SAMPLE_SIZE`
- `queryView(run: QueryRun, now: number, hasRecords: boolean): { mode: 'pending'|'records'|'skeleton'|'stale'|'cancelled'|'failed'|'empty'; slow: boolean; elapsedS: number }`
- `chipFor(run: QueryRun, now: number): { tone: 'idle'|'run'|'slow'|'failed'; text: string; cancellable: boolean } | null` (null: running < 300 ms, or idle)
- `slowCause(stages: any[], indexes: any[] | null): { field: string } | null`
- `prependSample(stages: any[]): any[]`

- [ ] Tests: each row of spec §3.2 table through `queryView`; chip texts `'1 doc · 208 ms'`, `'2 docs · 5 ms'`, `'Running · 2 s'`, `'Slow · 14 s'`, `'Cancelled after 14 s'`, `'Timed out · 30 s'`, `'Query failed'`; `slowCause` — uncovered first-stage field → `{field}`, covered by first key / `$**` / `order.$**` → null, compound index whose SECOND key is the field → `{field}`, indexes `null` → null, first stage `$sort` → null, `$match` with only `$expr` → null; `prependSample` adds `{ $sample: { size: 10000 } }`, unchanged when first stage is `$sample`.
- [ ] Run, see fail; implement; run, see pass; commit.

### Task 2: `useQuery` publishes `queryRun`; API marks its timeout

**Files:** Modify `src/mdh/hooks/useQuery.ts`, `src/mdh/store.ts`, `src/mdh/api.ts`; Test `tests/mdh-hooks.test.tsx`.

**Interfaces — Consumes:** `QueryRun`. **Produces:** `store.queryRun: Signal<QueryRun>`; `queryCancel`, `queryStartedAt`, `queryCancelled` removed; errors thrown by `api` on its own 30 s abort have `timedOut === true`.

- [ ] Rewrite the useQuery tests: running → `queryRun.phase === 'running'` with a `cancel`; resolve → `{phase:'done', count, ms}`; reject → `{phase:'failed', message, timedOut:false}` and `store.error` untouched; reject with `timedOut:true` → failed with `timedOut:true`; cancel → `{phase:'cancelled'}`, request aborted, records `[]`; superseded query (first resolves after second started) never changes `queryRun`; `store.loading` stays `false` throughout.
- [ ] Run, fail; implement; pass; commit.

### Task 3: Pipeline Debug shimmer and stop

**Files:** Modify `src/mdh/hooks/useStageCounts.ts`, `src/mdh/components/PipelineDebug.tsx` (+ module css); Test `tests/mdh-pipeline-debug-loading.test.tsx`.

**Interfaces — Produces:** `useStageCounts` returns `{ counts, inputInfo, stopped: boolean }`; `stopped` turns true (and in-flight requests abort) when `queryRun` becomes `cancelled` or `failed`, false again on the next stage-set change.

- [ ] Tests: pending count renders an element with `data-pending` (no `…` text); after `queryRun` → cancelled, pending cells read `—` and the aggregate signal is aborted; finished counts stay.
- [ ] Run, fail; implement; pass; commit.

### Task 4: `QueryStatus` chip

**Files:** Create `src/mdh/components/QueryStatus.tsx` + `.module.css`; Test `tests/mdh-query-status-chip.test.tsx`.

**Interfaces — Consumes:** `chipFor`, `store.queryRun`, `modalContent` from `src/ui/Modal.jsx`. **Produces:** `<QueryStatus />` (no props); a `useNow(active: boolean, everyMs: number): number` hook in `src/mdh/hooks/useNow.ts`.

- [ ] Tests (fake timers): nothing before 300 ms; `Running · 1 s` + Cancel after 1 s; amber class + `Slow · 10 s` at 10 s; Cancel click and Esc call `cancel`; Esc with `modalContent` set does not.
- [ ] Run, fail; implement; pass; commit.

### Task 5: Results area — modes, notices, actions

**Files:** Create `src/mdh/components/QueryNotice.tsx` + `.module.css`; Modify `src/mdh/components/RecordList.tsx` (+ css), `src/mdh/components/DataPanel.tsx`, `src/mdh/components/LoadingOverlay.tsx`, `src/mdh/components/LoadingOverlay.module.css`; Test `tests/mdh-record-list-footer.test.tsx`, `tests/mdh-query-notice.test.tsx`.

**Interfaces — Consumes:** `queryView`, `slowCause`, `prependSample`, `<QueryStatus />`. **Produces:** `RecordList` props `onRunAgain`, `onRunOnSample`, `onOpenIndexes` (all `() => void`); `<QueryNotice kind="stale"|"slow"|"failed" … />`.

- [ ] Tests: skeleton rows (`[data-skeleton]`, 10) for running ≥ 300 ms with no records; stale wrapper (`[data-stale]`) + "Showing the previous run" with records; nothing and no "0 records match" while pending; cancelled copy + Run again; timed-out notice copy with cause, Run on a sample / Run again call their props; slow notice at 10 s names the field when `cache` holds indexes without it, and omits the cause when indexes are not cached; Open Indexes calls its prop.
- [ ] DataPanel: `onRunOnSample` = `mutatePipelineText(prependSample)` then `runQuery()`; `onOpenIndexes` = `activePanel.value = 'indexes'`; clear `records` on a collection switch with nothing cached (test in `tests/mdh-flow.test.tsx` style if feasible, else covered by the jsdom DataPanel test that already mounts it).
- [ ] LoadingOverlay back to the plain spinner; delete its query card tests (`tests/mdh-loading-overlay.test.tsx`); `useDelayedLoading` stays for the overlay.
- [ ] Full gates: `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build`; check states in a real browser on the test org; commit.
