# Academy client project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Academy's curriculum, checks, coach and UI with the Acme Freight client project from the spec.

**Architecture:** A pure core in `src/training/` (track, checks, loader, progress, receipt, tether) is shared by the Rossum content script (coach) and the Console (Academy). A MAIN-world content script reports the app's own saves so the coach checks at once.

**Tech Stack:** TypeScript, Preact + signals, esbuild, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-13-academy-client-project-design.md`

## Global Constraints

- Every request the training makes is a read; Data Storage calls are `collections/list` and `data/aggregate` only.
- Storage keys: `academyProgress`, `academyCoachMinimised`, `academyCoachOff`. `trainingProgress` is orphaned, not deleted.
- Names: queue `Acme AP · <handle>`, dataset `acme_vendors_<handle>`, rule `Acme PO required · <handle>`.
- Coach DOM uses `textContent` only; every class and id is prefixed `rossum-sa-extension-`.
- A 429 stops automatic checks; nothing retries it.
- Usage events unchanged; no new event names.
- The page listener must never change, delay or swallow a page request or its errors.

## Review Focus

- A username with no `@`, dots, capitals or non-ASCII → a stable non-empty handle (fallback `trainee`).
- Two trainees in one org → each sees only their own objects (exact-name lookups).
- A task that passed and was undone → still unlocks the next mission, shown as changed, blocks the receipt.
- A page whose `fetch` is called with a `Request` object or a relative URL → the signal still reports the path.
- The coach open in two tabs → minimising in one minimises both.

---

### Task 1: Track and names
**Files:** rewrite `src/training/track.ts`; create `src/training/vendors.ts`; test `tests/training-track.test.ts` (rewrite).
**Produces:** `handleOf(username: string): string`, `namesFor(handle): { queue; dataset; rule }`, types `Track`, `Mission`, `Task`, `Anchor = { cy?; hrefIncludes?; side?: 'right' | 'below' }`, `Need`, `TRACK` (id `acme-ap`, version 1, six missions per spec §5), `vendorsCsv(): string` (header `id,name,vat_id,country`, 40 rows, contains `Nordic Pallet AB`).
- [ ] Tests: handle cases (`martin.zlamal@x` → `martin_zlamal`, `''` → `trainee`, 24-char cap); every task id unique; each mission has a letter and ≥1 task; CSV has 41 lines.
- [ ] Implement, run `npx vitest run tests/training-track.test.ts`, commit.

### Task 2: Checks (pure)
**Files:** create `src/training/checks.ts`; test `tests/training-checks.test.ts`.
**Produces:** `Assertion = { id; label; state: 'ok' | 'no' | 'pending'; fix? }`, `Ctx`, `evaluateTask(taskId, ctx, location?) : Assertion[]`, `taskOk(as: Assertion[]): boolean`, `buildOf(ctx): Build`. Labels mark code with backticks.
- [ ] Tests per task in spec §5, including: MDH first query on `name` → `no` with a fix naming it; rule action `warning` → `no`; enum check on `vendor_match`.
- [ ] Implement, run, commit.

### Task 3: Loader
**Files:** create `src/training/load.ts`; test `tests/training-load.test.ts`.
**Consumes:** `Need`, `namesFor`. **Produces:** `Get = (path, opts?: { method?; body?; auth?: 'token' | 'bearer' }) => Promise<any>`, `loadContext(needs: Need[], names, get): Promise<Ctx>`, `runChecks(track, progress, get, location?, scope?: 'current' | 'all'): Promise<{ results; build }>`.
- [ ] Tests: only needed requests are made; schema URL reduced to a path; a 429 error propagates; dataset count via aggregate.
- [ ] Implement, run, commit.

### Task 4: Progress and storage
**Files:** rewrite `src/training/progress.ts`, modify `src/training/storage.ts`; tests rewrite `tests/training-progress.test.ts`, `tests/training-storage.test.ts`.
**Produces:** `Progress` (spec §7), `emptyProgress(track, handle, at)`, `recordResults(p, results, build, at)`, `taskState(p, id): 'ok' | 'changed' | 'open'`, `missionStatus`, `currentMission`, `currentTask`, `isTrackComplete`, `checkedCount`; storage `PROGRESS_KEY = 'academyProgress'`.
- [ ] Tests incl. Review Focus line 3. Implement, run, commit.

### Task 5: Receipt v2
**Files:** modify `src/training/receipt.ts`; test rewrite `tests/training-receipt.test.ts`.
- [ ] Fields per spec §10; round trip; tampering any field invalidates. Implement, run, commit.

### Task 6: Tether arrival side
**Files:** modify `src/training/tether.ts`, `src/rossum/features/training-tether.ts`; tests in `tests/training-tether-geometry.test.ts`.
- [ ] `tetherGeometry(card, target, viewport, side?)`: `'below'` forces the vertical approach. Test, implement, commit.

### Task 7: Save signal
**Files:** create `src/rossum/saveSignal.ts` (MAIN world) and `src/rossum/saveSignalCore.ts` (pure `savePath(url, origin, method, status): string | null`); modify `build.js`, `manifest.json`; test `tests/rossum-save-signal.test.ts`.
- [ ] Tests: non-GET 2xx same-origin `/api/` or `/svc/` → path; GET, 4xx, other origin → null; `Request` input. Implement; wrappers call the original first and never throw. Commit.

### Task 8: Coach
**Files:** rewrite `src/rossum/features/training-quest.ts`; test rewrite `tests/training-quest.test.ts`.
- [ ] Card, pill, toast, tether, triggers (save message debounced 250 ms, focus, route change, 30 s), `academyCoachMinimised` / `academyCoachOff`, 429 pause, Open in Academy message. Test, implement, commit.

### Task 9: Worker opens the Academy
**Files:** modify `src/background/index.ts`; its existing test.
- [ ] `openDatasetManagement` accepts `app: 'mdh' | 'academy'` (anything else → `mdh`). Test, implement, commit.

### Task 10: Popup training row
**Files:** modify `src/popup/components/App.tsx` (+ a `TrainingRow.tsx`); test `tests/popup-training-gate.test.tsx`.
- [ ] Unlocked + progress for the tab's origin → row with Show coach and the Coach on Rossum pages switch. Test, implement, commit.

### Task 11: Academy UI
**Files:** rewrite `src/academy/**`; tests rewrite `tests/academy-*.test.tsx`.
- [ ] Spine, mission view, task cards, build board, handover with mint, trainer check, landing. Test, implement, commit.

### Task 12: Clean-up, docs, browser verification
- [ ] Delete `src/training/baseline.ts`, `steps.ts` and their tests; update CLAUDE.md (Academy, storage keys, spec index); `npm run typecheck && npm test && npm run format:check && npm run build`.
- [ ] Load `dist/` with agent-browser on the test org and walk every mission; commit.
