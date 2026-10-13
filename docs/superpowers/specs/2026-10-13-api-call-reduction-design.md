# API call reduction and 429 handling — design

**Date:** 2026-10-13
**Status:** designed, not built. Step 1 of the plan is a live probe (§2c); two parts depend on it.
**Scope:** new `src/net/rateLimit.ts`; `src/inspector/` (request scope, 429); `src/galaxy/`
(429, hook fields); `src/popup/` (`cache.ts`, `mdh-provenance.ts`,
`components/MdhProvenancePanel.tsx`). One PR.

## 1. Why

A heavily customised org hit HTTP 429 from the Rossum API. The extension is probably a small
part of that org's traffic next to its own hooks and integrations, but it shares the user's
token, and its heaviest calls — full hook lists — are heaviest exactly on such orgs. An audit
of the extension's API calls (a handover written by an agent, not re-verified until this spec)
listed eight places that fetch the same data again. This design keeps the ones that reduce
request count or remove a misleading result, and adds what the audit missed: the extension has
no 429 handling for the Rossum API at all.

Goals, weighted equally by the owner: less pressure toward 429, repo hygiene, a quicker popup.

## 2. Facts this design rests on

### a. Code (verified on `d8b6e01`, `master`)

- **No 429 handling.** Only Fabry Chat names 429, and only for the agent API
  (`src/fabry/chat.ts:15`).
- **Inspector turns a 429 into "nothing there".** `safe()` (`src/inspector/index.tsx:13`)
  maps any error to `null`, and the loaders read `null` as `[]`. A rate-limited hooks list
  sets `_hooksLoaded: true` with no hooks — a false diagnosis.
- **Inspector lists hooks and rules more than once per annotation.** `index.tsx:73-75` starts
  `loadQueueHooks`, `loadLabelContext` and `loadQueueRules` together; `loadLabelContext` lists
  rules and hooks again (`:334-335`). `_hooksLoaded` / `_rulesLoaded` are set only on
  completion, so panels that mount mid-load call the loaders again (`PipelinePanel.tsx:11`,
  `ExportPanel.tsx:16`, `ProvenancePanel.tsx:44`, `LabelsPanel.tsx:49`), and on a queue with
  no hooks `attributionContext.ts:16` lists them once more.
- **Galaxy keeps paging after a 429.** `fetchOrgResources` (`src/galaxy/api.ts:139`) lists
  five collections in parallel, each paging sequentially. A 429 rejects `Promise.all`, but
  nothing aborts the other four loops, so they keep sending requests. Hooks arrive as full
  objects (function hooks include their code); `graph.ts` reads only `id`, `url`, `name`,
  `type`, `active`, `events`, `queues`, `run_after`, `description`.
- **Popup never caches an empty hook list.** `MdhProvenancePanel.tsx:183` caches only
  `if (hookEntries.length > 0)` — deliberately, so "no hooks" and "no hook applies" stay
  distinct. The empty-result return (`:197`) also runs before `setCachedAnnotation` (`:267`).
  On a review-screen URL (`/document/<id>`, no queue in it) every open of an empty queue sends
  the annotation GET (`:153`) and the full hooks GET (`mdh-provenance.ts:819`). Lookup-only
  queues send the hooks GET every open too.
- **Popup TTL then full refetch.** `cache.ts:4` trusts an entry for 5 minutes; after that an
  open refetches hooks, the queue and the full schema (`mdh-provenance.ts:340,343`).
- **The popup's `fetchJson` throws `new Error('HTTP <status>')`** with no `status` field
  (`mdh-provenance.ts:14`); the Inspector's and Galaxy's `apiError` carry `status`.

### b. Rossum API (public OpenAPI spec, read 2026-10-13; not tested live)

- Hook, queue, rule, schema and organization objects carry `modified_at`. Labels do not.
- List endpoints cannot be ordered by `modified_at`.
- `/schemas` accepts a `queue` filter; `/hooks` accepts `queue`.
- `fields=` is not documented on list endpoints. The repo uses it on detail routes and on the
  annotations list.

### c. Open — the live probe (plan step 1, read-only, on a sandbox org)

1. Does `fields=id,modified_at` trim `/hooks?queue=X` and `/schemas?queue=X` responses?
2. Does `/schemas?queue=X` return only that queue's schema?
3. Does a 429 carry `Retry-After`? Observe only if one occurs; never provoke one.

If 1 or 2 fails, §4.3 and §4.4's revalidation fall back as described in §5.

## 3. Non-goals

Each was considered and dropped on 2026-10-13:

- **Popup lock banner and MDH card sharing one annotation GET** — one tiny GET per open at
  human pace; the shared plumbing (a host-owned scope passed by context) costs more than it
  saves.
- **Memoising "copy/open lookup query"** — user clicks, rare.
- **DevTools `resolveResource` using its 60 s cache** — one GET per tab load.
- **Inspector queue-level cache across annotations** — revalidation would keep the request
  count (about five per annotation) and save only bytes.
- **Sharing the Console's session probes** — each app probes once, on first activation; a
  later probe still has a purpose (the session may have expired).
- **Any automatic retry** of a 429.
- **A shared caching layer.** Storage stays per surface, because the contexts differ: the popup
  is destroyed on close (`chrome.storage.session`), a content script cannot read that
  (`sessionStorage`), the Console is a long-lived page (memory).
- **Moving `single()` out of `src/mdh/cache.ts`**, or touching `fetchRossumApi` /
  `fetchRossumApiFresh` in `src/rossum/api.ts`.

## 4. Design

### 4.1 `src/net/rateLimit.ts`

- `rateLimitError(resp, message)` → an `Error` with `status: 429` and `retryAfter`: the
  `Retry-After` header as whole seconds, or `null` when absent or not a number (an HTTP-date
  value reads as `null`).
- `isRateLimited(err)` → `err?.status === 429`.
- `rateLimitMessage(err)` → "Rossum is rate-limiting requests. Try again in N s." or, with no
  `retryAfter`, "Rossum is rate-limiting requests. Try again shortly."

Each transport in scope builds its 429 through `rateLimitError`: the popup's `fetchJson`,
`src/inspector/api.ts` `get`, `src/galaxy/api.ts` `get`. The popup's `fetchJson` also gains a
`status` field on every error (same message as today).

Rules everywhere in scope: never retry a 429 automatically; code that maps an error to "empty"
must not do so for a 429; Refresh (or reload) bypasses every cache and check.

### 4.2 Inspector

**Request scope.** New `src/inspector/requestScope.ts`: `createRequestScope()` returns
`{ get(key, fn), clear() }`. A successful promise is kept for the scope's life; a failed one is
dropped at once, so a 429 is never served from it; concurrent callers share one request.

`loadAnnotation` creates one scope per load, next to `loadId`, and replaces it on the next
load. Every hooks, rules and labels list in the load path goes through it — the three loaders,
the panels' calls into them, and the attribution fallback (passed the scoped lister). Result:
each list once per annotation.

**429.** `safe()` stays a catch-all, but records a 429 on the current load
(`resolved.rateLimited = { retryAfter }`). A loader whose list was rate-limited does not set
`_hooksLoaded` / `_rulesLoaded` and does not write an empty `hooksById` / `rules`. The report
shows one notice, using `rateLimitMessage`: "Some data could not be loaded — Rossum is
rate-limiting requests…", in place of conclusions drawn from the missing lists. Reloading the
annotation fetches them again.

### 4.3 Galaxy

- `fetchOrgResources` owns an `AbortController`, combined with the caller's signal. The first
  failure of any list aborts the others; the abort errors of the siblings are not reported.
- A 429 shows `rateLimitMessage` with a **Retry** button that calls `loadGraph()`. No automatic
  retry. Other errors keep today's message.
- **Probe-dependent:** the hooks list requests
  `fields=id,url,name,type,active,events,queues,run_after,description`, the fields `graph.ts`
  reads. A test asserts the list stays in step with what `graph.ts` reads.

### 4.4 Popup and side panel (`MdhProvenancePanel`)

**Trust window, then revalidate** (probe-dependent):

- The hook cache entry gains `hadHooks` and `sig`, the sorted `(id, modified_at)` pairs of
  every hook the queue lists; the schema entry gains `sig` from
  `/schemas?queue=X&fields=id,modified_at`. Additive keys: an entry without `sig` takes the
  full fetch after its window, so no prefix bump.
- **Non-empty entries:** trusted for 5 minutes, as today — no calls. After that the cached view
  renders at once and a background check fetches the signature. Unchanged → the window
  restarts. Changed → full fetch and re-render, through the existing `refreshNonce` path the
  annotation freshness check already uses.
- **Empty result (no hook applies, or no hooks at all):** cached with `hadHooks`, but with no
  window — every open renders the cached message at once and runs the background check. This
  is what keeps the first MDH hook an SA adds visible on the next open. The annotation entry is
  written on this path too (`modifiedAt`, `queueId`), and the existing `modified_at` check runs
  in the background as on the loaded path.
- Effect per open: an empty queue still sends two requests, now small and off the critical
  path; after the window a non-empty queue sends two small checks instead of the hooks, queue
  and schema fetches.

**429.** A foreground 429 shows `rateLimitMessage` instead of `Failed: HTTP 429`. A 429 from a
background check keeps the cached view and changes nothing. The lock banner is unchanged: it
already returns `null` on any failure.

## 5. Fallbacks if the probe fails

- `fields=` does not trim lists → the popup keeps today's 5-minute TTL plus full refetch, but
  still caches the empty result with `hadHooks` (with the 5-minute window — the risk that a
  first hook stays hidden until Refresh is then accepted and stated in the PR); Galaxy keeps
  full hook objects. §4.1-4.3's 429 work and §4.2's dedupe are unaffected.
- `/schemas?queue=X` does not filter → the schema check uses
  `GET /queues/X?fields=schema` then `GET <schema>?fields=modified_at`.

## 6. Testing

Test-first; mutation-check every new guard (the repo rule).

- `rateLimit`: seconds parsed; absent, non-numeric and HTTP-date → `null`; both messages.
- `requestScope`: concurrent calls share one run; a success is reused; a failure is dropped and
  the next call runs again; `clear()` empties it.
- Inspector: one annotation load with every panel mounted → `listHooks` once, `listRules` once,
  `listLabels` once; a 429 on hooks → the notice shows, `_hooksLoaded` is false, no "no hooks"
  conclusion; a new load uses a new scope.
- Galaxy: a 429 on one list aborts the others (no further page requests); the Retry button
  reloads; a 403 still degrades to `[]`; the requested hook fields cover what `graph.ts` reads.
- Popup: an empty queue's second open renders without waiting and sends only the checks, with
  the right message for `hadHooks` true and false; within the window no hook or schema request;
  after it, an unchanged `sig` → no full fetch, a changed one → full fetch and re-render;
  Refresh bypasses all; a foreground 429 shows the message; a background 429 keeps the view.
- `npm run typecheck`, `npm test` (with `NODE_OPTIONS=--no-experimental-webstorage` on
  Node 26), `npm run format:check`, `npm run build`.

## 7. Delivery

One PR from `perf/api-call-reduction`, branched from `master` at `d8b6e01`. Open PRs #20 and
#21 (org name and cell) touch none of these source files; the only expected conflict is
`CLAUDE.md`, if this PR documents the 429 rules there.
