# Agent API migration to `svc/rossum-agent` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every Mr. Fabry call from the deprecated `https://rossum-agent-api.tools.rossum.cloud/api/v1`
to `${domain}/svc/rossum-agent/api/v1`, and remove the old service from the codebase entirely.

**Architecture:** One transport (`src/agent/agentApi.ts`) owns the base URL; it is derived from
the connected domain in `init()`, like `svc/data-storage` in `src/mdh/api.ts`. The new service has
no personas and different tool names, so the `/persona` priming is removed everywhere and the
Architect's write audit learns the new tool names. Old chats are NOT migrated (owner, 2026-11-03).

**Tech Stack:** TypeScript, Preact, Vitest, esbuild (see CLAUDE.md).

**Spec:** this plan. The decisions are the owner's (2026-11-03), and the facts are the live
probe results below. There is no separate design doc.

## Findings (live probe, 2026-11-03, against a test org on `elis.rossum.ai`)

The new service is a reimplementation (Mastra; `/health` `version` is a git hash), not the old
service at a new URL.

| Area | New service behaviour |
|---|---|
| Base URL | `https://<app origin>/svc/rossum-agent/api/v1`; the API host (`api.elis…/svc/…`) is 404 |
| Auth | `X-Rossum-Token` + `X-Rossum-Api-Url`, BOTH required; `Authorization: Bearer` is 401 |
| `GET /health` | unauthenticated, `{"status":"healthy",…}` — unchanged |
| `GET /commands` | **401 without auth headers**; returns only `/usage` |
| `POST /chats`, `GET /chats`, `GET /chats/{id}` | same shapes; `chat_id` is a UUID; list `message_count` is always 0 |
| `GET /chats/{unknown id}` | **200 with `messages: []`** and a fresh `created_at` — never 404 |
| Chat scoping | by the exact `X-Rossum-Api-Url` STRING: `https://api.elis.rossum.ai/v1` and `https://elis.rossum.ai/api/v1` see disjoint histories |
| Stream | same AI-SDK v1 protocol; adds `start-step`/`finish-step`; **no `data-final-answer`** (harmless: `replyText` falls back to `text`) |
| `/persona cautious` | **unsupported** — answered as plain chat text, costing a full LLM turn |
| Tools | `rossum_api_search`, `rossum_api_describe`, `rossum_api_read`, `rossum_api_write` (`input: {method, path, body}`) |
| Read-only default | holds: a label-create request without `mcp_mode` was refused, REST confirmed nothing written |
| `mcp_mode: 'read-write'` | works: `rossum_api_write` `POST /labels` created the label, REST confirmed (then deleted) |
| Files route | exists (404 for a missing file); a real download was not tested |

## Global Constraints

- The string `rossum-agent-api.tools.rossum.cloud` must not appear in `src/`, `tests/` or `dist/`. The `*.rossum.cloud` host permission stays.
- The string `/persona` must not appear in `src/` or `dist/`.
- `X-Rossum-Api-Url` is exactly `${domain}/api/v1` — changing its form hides every user's history.
- The write boundary is unchanged: only `src/fabry/architect/**` sends `mcp_mode: 'read-write'`, only `agentApi.ts` names it; `tests/fabry-write-boundary.test.ts` must pass untouched.
- Type changes are emit-neutral; no `.js` files; `npm run format:check` passes (two passes may be needed).
- Old docs under `docs/superpowers/` are dated records — do not edit them.

## Review Focus

1. **A restored chat ID from the old service** (`fabryActiveChat`, `chat_2026…`) must open the greeting, not a blank thread — pinned in Task 4.
2. **An Architect check result's saved `chatId`** (Data Storage) opened from `CheckPanel` must show "no longer available", not a blank thread — pinned in Task 4.
3. **An Architect implement run's read calls** (`rossum_api_read`/`_search`/`_describe`) must NOT enter the write journal — pinned in Task 3.
4. **A brand-new Fabry chat's first message** must be the user's own text, with no extra turn before it — pinned in Task 2.
5. **`data-agent-question`** (the agent asking the user) was not observed on the new service. If it never arrives, questions arrive as plain text and still render. No test can pin a server behaviour; check it once in the live Console (Task 5, Step 5).

---

### Task 0: Branch

- [ ] **Step 1:** `git switch master && git pull && git switch -c agent-svc-migration`. This plan file was written on `app-help-drawer`; move it with `git stash -u` / `git stash pop` if it is still uncommitted there.

### Task 1: Transport base URL and `/commands` auth

**Files:**
- Modify: `src/agent/agentApi.ts` (the `AGENT_BASE` constant, `init`, `listCommands`, and the `createChat` comment)
- Test: `tests/agent-api.test.ts`, `tests/agent-api-createchat.test.ts`

**Interfaces:**
- Produces: `init(domain: string, token: string): void` (unchanged signature) now also sets the base URL. Every exported function keeps its signature.

- [ ] **Step 1: Write the failing tests** in `tests/agent-api.test.ts` (`beforeEach` already calls `init('https://acme.rossum.app', 'tok123')`):

```ts
describe('base URL', () => {
  it('derives the agent base from the connected domain', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'healthy' }) });
    global.fetch = fetchMock;
    await agentApi.probeAgent();
    expect(fetchMock.mock.calls[0][0]).toBe('https://acme.rossum.app/svc/rossum-agent/api/v1/health');
  });
  it('pins X-Rossum-Api-Url to ${domain}/api/v1 (chats are scoped by this exact string)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ chats: [], total: 0 }) });
    global.fetch = fetchMock;
    await agentApi.listChats();
    expect(fetchMock.mock.calls[0][0]).toBe('https://acme.rossum.app/svc/rossum-agent/api/v1/chats?limit=50&offset=0');
    expect(fetchMock.mock.calls[0][1].headers['X-Rossum-Api-Url']).toBe('https://acme.rossum.app/api/v1');
  });
});
describe('listCommands', () => {
  it('sends the auth headers (the service 401s without them)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ commands: [{ name: '/usage' }] }) });
    global.fetch = fetchMock;
    expect(await agentApi.listCommands()).toEqual([{ name: '/usage' }]);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'X-Rossum-Token': 'tok123', 'X-Rossum-Api-Url': 'https://acme.rossum.app/api/v1' });
  });
});
```

Also update any existing assertion in both test files that spells the old host.

- [ ] **Step 2:** `npx vitest run tests/agent-api.test.ts`. Expected: the three new tests FAIL, because the URL is still the old host and `listCommands` sends no headers.
- [ ] **Step 3: Implement.** Replace `const AGENT_BASE = …` with `let agentBase = '';`, and set `agentBase = domain ? \`${domain}/svc/rossum-agent/api/v1\` : '';` in `init`. Rename every `${AGENT_BASE}` use. Give `listCommands`'s fetch `{ headers: authHeaders() }`, and change its comment ("unauthenticated per the spec") to say it needs auth. In the `createChat` comment, replace "verified against rossum-agent api/stream.py resolve_mcp_mode" with "verified live against svc/rossum-agent, 2026-11-03". Add one line above `agentBase`: chats are scoped by the exact `X-Rossum-Api-Url` string, and an unknown chat id returns 200 with no messages.
- [ ] **Step 4:** `npx vitest run tests/agent-api.test.ts tests/agent-api-createchat.test.ts tests/fabry-write-boundary.test.ts`. Expected: PASS. Then `grep -rn "tools.rossum.cloud" src tests` returns nothing.
- [ ] **Step 5: Commit** — `fix(agent): call svc/rossum-agent on the connected domain`.

### Task 2: Remove persona priming and the persona UI

**Files:**
- Delete: `src/fabry/personas.ts`
- Modify: `src/fabry/chat.ts` (the new-chat prime ~L150-161 and the critic prime ~L206), `src/fabry/store.ts:25` (`personaChoice`), `src/fabry/thread.ts:76-85` (`personaOf`), `src/fabry/components/Composer.tsx` (the dropdown, its state, outside-click effect and caret), `src/fabry/components/ChatHeader.tsx` (the `.fabry-hd-persona` chip), `src/fabry/architect/actions.ts` (L414, L466, L643), `src/inspector/agentAttribute.ts` (L119, L205), `src/inspector/synthesize.ts:54`, `src/mdh/agent/agentQuery.ts:463`, `src/mdh/agent/explainEmpty.ts:246`, `src/audit/fabry.ts:168`, `src/builder/assist.ts:89`, `src/console/console.css` (`.fabry-persona-*` L8040-8120, `.fabry-hd-persona` ~L8242, the retired-hint comment L8298)
- Test: every test file `grep -rln persona tests` lists (16 files plus `tests/support/builder.ts`)

**Interfaces:**
- Produces: nothing new. `personaOf`, `PERSONAS`, `personaLabel`, `Persona` and `store.personaChoice` cease to exist.

- [ ] **Step 1: Write the failing test** in `tests/fabry-chat.test.ts` (`describe('sendMessage')`):

```ts
it('new chat: the first streamed message is the user text, with no prime turn', async () => {
  streamOk('answer');
  await sendMessage('question', []);
  expect(vi.mocked(agentApi.streamMessage).mock.calls.map((c) => c[1])).toEqual(['question']);
  expect(store.thread.value.map((t) => t.role)).toEqual(['user', 'assistant']);
});
```

Add one equivalent "first call is the real prompt" assertion to each of `tests/inspector-synthesize.test.ts`, `tests/mdh-agent-query.test.ts`, `tests/audit-fabry.test.ts` and `tests/builder-ruleassist.test.ts`: `streamMessage.mock.calls[0][1]` is not `'/persona cautious'`.

- [ ] **Step 2:** `npx vitest run tests/fabry-chat.test.ts tests/inspector-synthesize.test.ts tests/mdh-agent-query.test.ts tests/audit-fabry.test.ts tests/builder-ruleassist.test.ts`. Expected: the new assertions FAIL.
- [ ] **Step 3: Implement.** Delete each `/persona cautious` send, including its surrounding `try`, a `pushTurn` of the chip, and the abort check that guarded only the prime. Keep the abort check that guards the next real send. Delete the persona UI, the store signal, `personaOf` and `personas.ts`. Delete the dead CSS by the CLAUDE.md rules: drop only the dead selectors from a grouped list, and do not splice into a comment. Update the existing tests that asserted the prime: index shifts like `calls[1]` become `calls[0]`, and you delete the persona-picker and header-chip tests.
- [ ] **Step 4:** `npm run typecheck && npm test`. Expected: PASS, including `tests/dead-code.test.ts`. Then `grep -rn "/persona\|personaChoice\|fabry-persona\|fabry-hd-persona" src` returns nothing.
- [ ] **Step 5: Commit** — `refactor(fabry): drop /persona priming — the agent service has no personas`.

### Task 3: Architect write audit and tool labels for the new tool names

**Files:**
- Modify: `src/fabry/architect/audit.ts` (`NS_RE`, `summarizeArgs`), `src/agent/agentStream.ts` (`TOOL_LABELS`)
- Test: `tests/fabry-architect-audit.test.ts`, `tests/agent-stream.test.ts`

**Interfaces:**
- Produces: `isWriteTool(name: unknown): boolean` and `summarizeArgs(input: any): string` (signatures unchanged).

- [ ] **Step 1: Write the failing tests:**

```ts
it('classifies the generic rossum_api_* tools', () => {
  expect(isWriteTool('rossum_api_write')).toBe(true);
  expect(isWriteTool('rossum_api_read')).toBe(false);
  expect(isWriteTool('rossum_api_search')).toBe(false);
  expect(isWriteTool('rossum_api_describe')).toBe(false);
  expect(isWriteTool('rossum_api_frobnicate')).toBe(true); // fail-safe unchanged
});
it('summarizes a generic write as method, path and body name', () => {
  expect(summarizeArgs({ method: 'POST', path: '/labels', body: { name: 'x' } })).toBe('POST /labels x');
  expect(summarizeArgs({ method: 'DELETE', path: '/labels/25559' })).toBe('DELETE /labels/25559');
});
it('journals only the write in a new-service implement stream', () => {
  // makeAuditFolder fed tool-input-available for rossum_api_search, rossum_api_describe,
  // rossum_api_write {method:'POST',path:'/labels',body:{name:'x'}}, then tool-output-available
  // for all three → writes equals [{ tool: 'rossum_api_write', argsSummary: 'POST /labels x', ok: true, at: 7 }]
});
```

In `tests/agent-stream.test.ts`: `toolLabel('rossum_api_write')` is `'writing to the org'`.

- [ ] **Step 2:** `npx vitest run tests/fabry-architect-audit.test.ts tests/agent-stream.test.ts`. Expected: FAIL. `api_read` matches no read verb, so it counts as a write.
- [ ] **Step 3: Implement.** Change `NS_RE` to `/^(rossum_(api_)?|data_storage_)/i`, so `baseToolName('rossum_api_read')` returns `'read'`. In `summarizeArgs`, when `input.method` and `input.path` are strings, return `` `${input.method} ${input.path}` ``, plus `' ' + summarizeArgs(input.body)` when that is non-empty, cut to 80 characters. Add these labels to `TOOL_LABELS`: `rossum_api_search: 'searching the API'`, `rossum_api_describe: 'reading the API docs'`, `rossum_api_read: 'reading'`, `rossum_api_write: 'writing to the org'`.
- [ ] **Step 4:** `npx vitest run tests/fabry-architect-audit.test.ts tests/agent-stream.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `fix(architect): audit the agent's generic rossum_api_* tools`.

### Task 4: An empty chat is a gone chat

**Files:**
- Modify: `src/fabry/chat.ts` (`openChat`, ~L48-75)
- Test: `tests/fabry-chat.test.ts` (`describe('loadChats / openChat')`)

**Interfaces:**
- Produces: `openChat(chatId: string, { restore?: boolean })` (signature unchanged). A detail with an empty or missing `messages` array is now handled exactly like a 404.

- [ ] **Step 1: Write the failing tests** next to the two existing 404 tests, with `getChat` resolving `{ chat_id: 'gone_chat', messages: [], files: [], created_at: 'x' }`:
  - restore: `store.activeChatId.value` is `null`, and `store.sendError.value` is `null`;
  - user open: `activeChatId` is `null`, and `sendError` matches `/no longer available/i`.
- [ ] **Step 2:** `npx vitest run tests/fabry-chat.test.ts`. Expected: the two new tests FAIL, because the chat opens as a blank thread.
- [ ] **Step 3: Implement.** After `getChat` returns and the `loadId` check passes, if `!detail?.messages?.length`, run the same branch as the 404 case. Share it rather than copying it, for example by throwing an `{ status: 404 }` error into the existing catch. Add a comment that the service answers an unknown id with 200 and no messages.
- [ ] **Step 4:** `npx vitest run tests/fabry-chat.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `fix(fabry): treat an empty chat as gone — the agent service never 404s`.

### Task 5: Docs and final verification

The `*.rossum.cloud` host permission STAYS (owner, 2026-11-03: harmless, kept for future use).
Do not touch `manifest.json` or `tests/sidepanel-manifest.test.ts`.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md.** Under **Fabry Chat**, add one sentence. The transport is `${domain}/svc/rossum-agent/api/v1`. Chats are scoped by the exact `X-Rossum-Api-Url` string. An unknown chat id returns 200 with no messages. The service has no personas. Under **Safety invariants**, change "(cautious persona, standing notices)" to "(standing notices)".
- [ ] **Step 2:** `npm run build && npm run typecheck && npm test && npm run format:check`. Expected: all PASS. If `format:check` fails, run `npm run format` again until it passes.
- [ ] **Step 3:** `grep -rn "rossum-agent-api\|/persona" src tests dist`. Expected: no output.
- [ ] **Step 4:** Mutation-test the write boundary. Add `mcp_mode: 'read-write'` to a non-architect file and confirm `tests/fabry-write-boundary.test.ts` FAILS. Then revert.
- [ ] **Step 5: Live check** in the Console on a test org. Start a new Fabry chat: one turn only, and the reply renders. Reload: the chat is restored. Open a stale old-service chat id: the greeting appears. Run an Architect check: the reply renders. Ask a question that should make the agent ask back: record whether `data-agent-question` arrives. Edge for macOS, Load unpacked, same checks.
- [ ] **Step 6: Commit** — `docs: document the svc/rossum-agent service`.
