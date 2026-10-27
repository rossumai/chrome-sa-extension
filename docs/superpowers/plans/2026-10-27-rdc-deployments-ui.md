# rdc deployments UI (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rdc proof of concept with the approved deployments UI: the header band with
the conveyor, the overview, choosing a source, Connect and Read both working for real, and every
step that needs unfinished rdc work shown in its layout and plainly labelled as work in progress.

**Architecture:** A DOM-free core (`src/rdc/deploy.ts`, `src/rdc/conveyor.ts`) holds counting,
env inputs, step and work-in-progress data; Preact components under `src/rdc/components/` render
it; `App.tsx` is a small screen state machine. The only rdc calls are `Project.create`, `addEnv`
and `sync({ noPush: true })` on an in-memory tree — nothing is written to either org and nothing
is stored.

**Tech Stack:** Preact + @preact/signals, TypeScript, CSS Modules, esbuild, Vitest (jsdom), the
optional `@mrtnzlml/rdc-wasm` package.

**Spec:** `docs/superpowers/specs/2026-10-27-rdc-deployments-design.md` (read §0 first) and its
mockup `docs/superpowers/specs/2026-10-27-rdc-deployments-mockup.html` (the approved look; copy
its CSS values and copy text, not its sample data).

## Global Constraints

- Nothing is written to either org: the only sync option ever passed is `{ noPush: true }`.
- No token and no hook secret is stored anywhere (no `chrome.storage`, no `sessionStorage`, no
  Data Storage); the source token lives in component state only.
- No fake data presented as real: a work-in-progress step shows its structure and a WIP note,
  never the mockup's sample numbers.
- Conveyor values (spec §4.1): spawn every 2700 ms, 9000 ms per crossing, linear speed, fade over
  the first and last 10 %, 30 px opaque icons, belt at `top: 38%`, caption at `top: calc(38% + 24px)`,
  coral arrowhead before the target card, `prefers-reduced-motion` → three still icons.
- The target card is white in both themes; its icons keep `#fde6e4` / `#9b231b` in dark mode.
- Copy: plain, short, sentence case, active voice. Placeholders only (`acme`, `test`,
  `example`, `partner-sandbox.rossum.app`); no customer names (CLAUDE.md "No customer identifies
  itself").
- Repo rules (CLAUDE.md): component imports spell `.jsx`; no `\uXXXX` in JSX text; no bare
  single-letter class names; `ReturnType<typeof setTimeout>` for timer handles; a listener lives
  in the effect that owns its element; guard Chrome-only APIs for jsdom.
- The rdc app stays `gated` behind `experimentalUnlocked` (spec §10).
- Gates before each commit: `npm run typecheck`, `npm test`, `npm run format:check`.

## Review Focus

1. The source token cannot read the chosen org (401/403, or the org is not listed) — Connect shows
   why and stays on Connect; Read is not reachable.
2. A 429 from the source while checking the token — shown as rate limited (`rateLimitError` from
   `src/net/rateLimit.ts`), never as "no organizations".
3. The rdc wasm is not in this build — the page still renders; Read says rdc is not in this build
   and every rdc-dependent action is disabled with that reason.
4. A sync fails or the admin leaves the app mid-read — the error is shown with a Retry; a pending
   rdc prompt is answered `null` on unmount so nothing hangs.
5. The session lists other than exactly one organization — the target cannot be resolved, and the
   page says so instead of reading.

---

## File structure

| File | Responsibility |
|---|---|
| `src/rdc/deploy.ts` (new) | Pure core: steps, kinds, `countKinds`, `sourceEnvInput`, `readableOrgs`, WIP reasons |
| `src/rdc/conveyor.ts` (new) | Pure conveyor constants and geometry |
| `src/rdc/core.ts` (modify) | Keep `apiBaseOf`, `envInputFor`, `answerFor`; `envInputFor` gains an env-name parameter; `treeRows` removed |
| `src/rdc/wasm.ts` (modify) | `RdcProject` gains `addEnv` |
| `src/rdc/components/Band.tsx` + `Band.module.css` (new) | The header band, conveyor, compact stepper |
| `src/rdc/components/Wip.tsx` (new) | The work-in-progress note |
| `src/rdc/components/Overview.tsx`, `ChooseSource.tsx`, `Connect.tsx`, `Read.tsx`, `WipSteps.tsx` (new) + `Deploy.module.css` (new) | The screens |
| `src/rdc/components/App.tsx` (rewrite), `App.module.css` (trim) | Screen state machine |
| `CLAUDE.md` (modify) | The rdc bullet under Console apps |

---

### Task 1: Pure core — steps, kinds, env inputs, WIP reasons

**Files:**
- Create: `src/rdc/deploy.ts`
- Modify: `src/rdc/core.ts` (add `name` parameter to `envInputFor`; delete `treeRows`, `TreeRow`)
- Test: `tests/rdc-deploy.test.ts`; update `tests/rdc-core.test.ts` (drop `treeRows` cases, pass the env name)

**Interfaces:**
- Produces:
  - `export const SOURCE_ENV = 'source'`, `export const TARGET_ENV = 'target'` (rdc env names; display names are separate)
  - `export type Kind = 'queues' | 'schemas' | 'hooks' | 'rules' | 'labels'`
  - `export const KINDS: { kind: Kind; label: string; icon: string }[]` — labels `Queues`, `Schemas`, `Hooks`, `Rules`, `Labels`; icons `i-queue`, `i-schema`, `i-hook`, `i-rule`, `i-label`
  - `export type StepId = 'connect' | 'read' | 'plan' | 'review' | 'write'`
  - `export const STEPS: { id: StepId; label: string }[]` — labels `Connect`, `Read both`, `Plan`, `Review`, `Write` (the band shows the last one as `Write to <target name>`)
  - `export function countKinds(files: Map<string, Uint8Array>, env: string): Record<Kind, number>`
  - `export type Source = { name: string; domain: string; orgId: number; orgName: string }`
  - `export function sourceEnvInput(source: Source, token: string): EnvInput | string`
  - `export function readableOrgs(organizations: unknown): { id: number; name: string }[]`
  - `export type WipFeature = 'remember' | 'history' | 'secrets' | 'plan' | 'review' | 'write' | 'ownValues'`
  - `export const WIP: Record<WipFeature, string>`
  - `core.ts`: `envInputFor(domain: string, token: string, organizations: unknown, name: string): EnvInput | string`

- [ ] **Step 1: Write the failing tests** in `tests/rdc-deploy.test.ts`:

```ts
const enc = (s: string) => new TextEncoder().encode(s);
const tree = new Map([
  ['envs/target/workspaces/ap/queues/cost/queue.json', enc('{}')],
  ['envs/target/workspaces/ap/queues/cost/schema.json', enc('{}')],
  ['envs/target/workspaces/ap/queues/cost/formulas/total.py', enc('')],
  ['envs/target/hooks/validator.json', enc('{}')],
  ['envs/target/hooks/validator.py', enc('')],
  ['envs/target/rules/totals.json', enc('{}')],
  ['envs/target/rules/totals.py', enc('')],
  ['envs/target/labels/urgent.json', enc('{}')],
  ['envs/source/hooks/other.json', enc('{}')],
]);
it('counts one object per JSON file of each kind, for one env only', () => {
  expect(countKinds(tree, 'target')).toEqual({ queues: 1, schemas: 1, hooks: 1, rules: 1, labels: 1 });
  expect(countKinds(tree, 'source').hooks).toBe(1);
});
it('builds the source env from the chosen org', () => {
  const s = { name: 'test', domain: 'https://partner-sandbox.rossum.app', orgId: 20412, orgName: 'Acme Test' };
  expect(sourceEnvInput(s, 'tok')).toEqual({ name: 'source', apiBase: 'https://partner-sandbox.rossum.app/api/v1', orgId: 20412, authKind: 'token', token: 'tok' });
  expect(sourceEnvInput(s, '')).toBe('Give a token for test.');
  expect(sourceEnvInput({ ...s, domain: 'ftp://x' }, 'tok')).toBe('Not a Rossum URL: ftp://x');
});
it('lists the orgs a token can read, and nothing for junk', () => {
  expect(readableOrgs({ results: [{ id: 1, name: 'A' }, { id: 'x' }, { id: 2 }] })).toEqual([{ id: 1, name: 'A' }, { id: 2, name: 'org 2' }]);
  expect(readableOrgs(null)).toEqual([]);
});
it('names what each work-in-progress feature waits for', () => {
  expect(Object.keys(WIP).sort()).toEqual(['history', 'ownValues', 'plan', 'remember', 'review', 'secrets', 'write']);
  for (const s of Object.values(WIP)) expect(s).toMatch(/^Not available yet\./);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/rdc-deploy.test.ts tests/rdc-core.test.ts` — expected FAIL (module not found).
- [ ] **Step 3: Implement** `src/rdc/deploy.ts` and the `core.ts` changes. `countKinds` matches
  paths under `envs/<env>/`: `…/queues/<q>/queue.json`, `…/queues/<q>/schema.json`, and
  `hooks/*.json`, `rules/*.json`, `labels/*.json` directly under the env root (rdc's layout,
  rdc README "Quick start"). `sourceEnvInput` reuses `apiBaseOf`. `WIP` copy, verbatim:
  - `remember`: `Not available yet. The Console does not remember the source between visits; rdc's storage in this org's data storage is in progress.`
  - `history`: `Not available yet. Deployments are not recorded until rdc can store them in this org.`
  - `secrets`: `Not available yet. Which hooks need a secret is known only after the plan, and rdc cannot plan in the browser yet.`
  - `plan`: `Not available yet. Planning needs rdc migrate in the browser build, which is in progress.`
  - `review`: `Not available yet. Reviewing needs rdc's list of changes and conflicts, which is in progress.`
  - `write`: `Not available yet. Nothing can be written to this org from here; writing waits for the plan and the review.`
  - `ownValues`: `Not available yet. Own values are stored with the project, which rdc cannot do in the browser yet.`
- [ ] **Step 4:** Run the same command — expected PASS. Run `npm test -- tests/dead-code.test.ts` — expected PASS (no export left unused once later tasks import them; if it fails only on not-yet-imported exports, finish Task 6 before committing this one together — note it in the commit).
- [ ] **Step 5: Commit** `feat(rdc): deployment core — kinds, source env, WIP reasons`.

### Task 2: `addEnv` in the wasm subset, proven against the real package

**Files:**
- Modify: `src/rdc/wasm.ts` (`RdcProject.addEnv(input: EnvInput): unknown`; `Rdc.Project.create` unchanged)
- Test: `tests/rdc-wasm-node.test.ts`

**Interfaces:**
- Consumes: `envInputFor(…, TARGET_ENV)`, `sourceEnvInput` (Task 1)
- Produces: `RdcProject.addEnv`

- [ ] **Step 1: Write the failing test** (inside the existing `describe.skipIf(!present)`):

```ts
it('holds the target and the source as two envs of one in-memory project', async () => {
  // …initSync as in the existing test…
  const target = envInputFor('https://acme.rossum.app', 'tok', { results: [{ id: 31007, name: 'Acme' }] }, TARGET_ENV);
  if (typeof target === 'string') throw new Error(target);
  const project = glue.Project.create('console', target);
  const src = sourceEnvInput({ name: 'test', domain: 'https://partner-sandbox.rossum.app', orgId: 20412, orgName: 'Acme Test' }, 'tok2');
  if (typeof src === 'string') throw new Error(src);
  project.addEnv(src);
  const toml = new TextDecoder().decode(project.files().get('rdc.toml'));
  expect(toml).toContain('[envs.target]');
  expect(toml).toContain('[envs.source]');
  expect(toml).toContain('20412');
  project.free();
});
```

- [ ] **Step 2:** Run `npx vitest run tests/rdc-wasm-node.test.ts` — expected PASS already (the glue has `addEnv`), or SKIP without the package; this test pins the real behaviour the hand-kept type in Step 3 describes.
- [ ] **Step 3:** Add `addEnv(input: EnvInput): unknown;` to `RdcProject` in `src/rdc/wasm.ts` (the package returns `ProjectSummary`; keep it `unknown`, the page does not read it). Update the existing test's `envInputFor` call with `ENV`→`TARGET_ENV` name argument.
- [ ] **Step 4:** Run `npx vitest run tests/rdc-wasm-node.test.ts` and `npm run typecheck` — PASS (the vitest test skips without the package; say so in the commit if skipped).
- [ ] **Step 5: Commit** `feat(rdc): add a second env to the in-memory project`.

### Task 3: The header band and the conveyor

**Files:**
- Create: `src/rdc/conveyor.ts`, `src/rdc/components/Band.tsx`, `src/rdc/components/Band.module.css`
- Test: `tests/rdc-conveyor.test.ts`, `tests/rdc-band.test.tsx`

**Interfaces:**
- Produces:
  - `conveyor.ts`: `export const SPAWN_MS = 2700`, `export const CROSS_MS = 9000`, `export const FADE = 0.1`, `export const ICON_PX = 30`, `export function beltStops(trackWidth: number): { x0: number; x1: number }` (x0 = 6; x1 = trackWidth − 18 − 14 − 30 − 8, never below x0), `export function stillPositions(trackWidth: number): number[]` (three x positions at 1/4, 2/4, 3/4 between x0 and x1)
  - `Band.tsx`: `export default function Band(props: { source: Source | null; target: { name: string; host: string; orgId: number; env: 'Production' | 'Sandbox' | null }; step: StepId | null; lastDeployment: string | null; locked: boolean })` — `step === null` renders the full band (cards with kind icons, conveyor, caption, the three rules); a step renders the compact band with the 5 steps between the cards.
- [ ] **Step 1: Write the failing tests.** `tests/rdc-conveyor.test.ts`: `beltStops(800)` → `{ x0: 6, x1: 730 }`; `beltStops(40).x1 >= 6`; `stillPositions(800)` has length 3 and is increasing. `tests/rdc-band.test.tsx` (jsdom, `matchMedia` stubbed): with `source: null` the source card says `Your test org` and is locked; with a source it shows its name and host; `step: 'plan'` marks Connect and Read both done, Plan current, Write label `Write to Acme`; with `prefers-reduced-motion: reduce` exactly 3 `[data-belt-icon]` exist and no `Element.animate` call is made (stub `animate` and assert it is not called); `lastDeployment: null` renders the caption `No deployment yet`.
- [ ] **Step 2:** Run `npx vitest run tests/rdc-conveyor.test.ts tests/rdc-band.test.tsx` — FAIL.
- [ ] **Step 3: Implement.** Port the mockup's band CSS (v13 `.lane`, `.org`, `.track[data-conveyor]` and the compact `.stages`) into `Band.module.css`. The conveyor runs in a `useEffect` owned by the track element: `setInterval(spawn, SPAWN_MS)` skips while `document.hidden`; each icon is a `<span data-belt-icon>` animated with `Element.animate` (keyframes and colours from the mockup's v13 script: teal `#e3f4f8` → `#f4f5f8` → `#f9f1f1`), removed on finish; the belt-dash duration is `18 / speed` ms with `speed = (x1 − x0) / (CROSS_MS × 0.84)`; departing/arriving pulses toggle classes on the matching kind icon. Clear the interval and remove icons on unmount. Guard `Element.prototype.animate` for jsdom.
- [ ] **Step 4:** Run the tests — PASS.
- [ ] **Step 5: Commit** `feat(rdc): deployment header band with the conveyor`.

### Task 4: WIP note, overview and choosing a source

**Files:**
- Create: `src/rdc/components/Wip.tsx`, `src/rdc/components/Overview.tsx`, `src/rdc/components/ChooseSource.tsx`, `src/rdc/components/Deploy.module.css`
- Test: `tests/rdc-overview.test.tsx`

**Interfaces:**
- Consumes: `WIP`, `Source`, `readableOrgs`, `apiBaseOf`
- Produces:
  - `Wip(props: { feature: WipFeature })` — renders `role="note"` with a `Work in progress` badge and `WIP[feature]`
  - `Overview(props: { source: Source | null; targetName: string; onChooseSource: () => void; onDeploy: () => void })` — the first-visit card when `source` is null (three numbered sentences from the mockup, button `Choose the org to deploy from`); otherwise *<target> deploys from* with `Deploy from <name>` and `Change source`, plus *Deployments into <target>* and *What <target> keeps for itself* each showing `<Wip feature="history" />` / `<Wip feature="ownValues" />`, and `<Wip feature="remember" />` under the source
  - `ChooseSource(props: { onCancel: () => void; onChosen: (s: Source) => void; fetchOrgs?: (domain: string, token: string) => Promise<unknown> })` — address, token, `Find organizations`, then a select of `readableOrgs`, short name (default `test`), button `Deploy from <name>`. Default `fetchOrgs` is `GET ${domain}/api/v1/organizations` with `Authorization: Bearer`, throwing `rateLimitError` on 429 and `HTTP <status>` otherwise. The token is dropped when the modal closes.
- [ ] **Step 1: Write the failing tests:** no source → button `Choose the org to deploy from` calls `onChooseSource`; with a source → text `Acme deploys from`, `Deploy from test` calls `onDeploy`, and 3 notes with `role="note"` containing `Not available yet.`; `ChooseSource` with a `fetchOrgs` stub resolving `{ results: [{ id: 20412, name: 'Acme Test' }] }` → after `Find organizations`, choosing and confirming calls `onChosen({ name: 'test', domain: 'https://partner-sandbox.rossum.app', orgId: 20412, orgName: 'Acme Test' })`; a stub rejecting with a 429 `rateLimitError` shows text matching `/rate limit/i` and no org select; an address `ftp://x` shows `Not a Rossum URL: ftp://x` without calling `fetchOrgs`.
- [ ] **Step 2:** Run `npx vitest run tests/rdc-overview.test.tsx` — FAIL.
- [ ] **Step 3: Implement** with the mockup's markup and styles (`.panel`, `.srcs`, `.tl`, `.pins`, modal). History and own values render only the WIP note — no sample rows.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** `feat(rdc): overview and choosing the source, with WIP notes`.

### Task 5: Connect and Read both (real)

**Files:**
- Create: `src/rdc/components/Connect.tsx`, `src/rdc/components/Read.tsx`
- Test: `tests/rdc-read.test.tsx`

**Interfaces:**
- Consumes: `sourceEnvInput`, `envInputFor(…, TARGET_ENV)`, `countKinds`, `answerFor`, `parseAnsi`, `Rdc`, `RdcProject`, `ChooseSource`'s `fetchOrgs` shape
- Produces:
  - `Connect(props: { source: Source; fetchOrgs?: …; onConnected: (token: string) => void; onBack: () => void })` — token field, `Check token`; passes when `readableOrgs` of the response contains `source.orgId` (else `This token cannot read <orgName>, org <orgId>.`); shows `<Wip feature="secrets" />` where the mockup has the hook-secrets table
  - `Read(props: { rdc: Rdc | null; rdcError: string; source: Source; sourceToken: string; domain: string; token: string; organizations: () => Promise<unknown>; onDone: (counts: { source: Record<Kind, number>; target: Record<Kind, number> }) => void })` — on mount: `Project.create('console', targetEnv)`, `addEnv(sourceEnv)`, `sync(SOURCE_ENV, { noPush: true }, ask, log)`, then `sync(TARGET_ENV, { noPush: true }, ask, log)`; two log panels (ANSI via `parseAnsi`), per-kind counts from `countKinds`, prompts shown with their choices plus Cancel; `project.free()` in `finally`; a pending prompt answered `null` on unmount; on error the message and `Retry`.
- [ ] **Step 1: Write the failing tests** with a fake `Rdc` whose `Project.create` returns `{ addEnv, sync, files, free }` stubs: the two `sync` calls are, in order, `('source', { noPush: true }, …)` and `('target', { noPush: true }, …)` and no call ever passes anything but `{ noPush: true }`; after both resolve, `onDone` receives counts computed from the stub's `files()`; `free` is called once even when the second sync rejects, and the rejection text plus a `Retry` button are shown; `rdc: null` with `rdcError: 'rdc wasm did not load: x'` shows that text and never calls `onDone`; unmounting while a stub sync awaits a prompt resolves that prompt with `null`; Connect: a stub listing `{ id: 1 }` only → `This token cannot read Acme Test, org 20412.`
- [ ] **Step 2:** Run `npx vitest run tests/rdc-read.test.tsx` — FAIL.
- [ ] **Step 3: Implement.** Reuse the existing App's `LogLine`/`css(st)` (move them into `Read.tsx`). The `organizations` prop is the existing `GET /organizations` call for the session.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** `feat(rdc): connect to the source and read both orgs`.

### Task 6: WIP steps, own values, and the App state machine

**Files:**
- Create: `src/rdc/components/WipSteps.tsx`
- Rewrite: `src/rdc/components/App.tsx`; trim `src/rdc/components/App.module.css` to what remains used
- Modify: `CLAUDE.md` (the rdc bullet under *Console apps*)
- Test: `tests/rdc-app.test.tsx`

**Interfaces:**
- Consumes: everything above
- Produces: `export default function App({ connected }: { connected: boolean | null })` (same props as today, so `Console.tsx` is unchanged); `WipStep(props: { step: 'plan' | 'review' | 'write' | 'done'; targetName: string; onBack: () => void; onNext?: () => void })`; `OwnValues(props: { targetName: string; onBack: () => void })`
- [ ] **Step 1: Write the failing tests:** not connected → the existing connection-bar error; connected with a stub loader → overview; *Choose* → *Deploy from test* → Connect → Read (fake rdc) → `Continue` → Plan shows a note `Not available yet. Planning needs rdc migrate…`, the CLI block `rdc migrate source target` is shown as text, and every input on Plan, Review and Write is `disabled`; Write's confirmation input and button are disabled; *Edit* on the overview opens Own values with the `ownValues` note; reload state is not persisted (`sessionStorage` and `chrome.storage.local.set` untouched — spy on both).
- [ ] **Step 2:** Run `npx vitest run tests/rdc-app.test.tsx` — FAIL.
- [ ] **Step 3: Implement.** Screens: `overview | choose | connect | read | plan | review | write | done | own`. The band's `step` follows the screen. Plan, Review, Write and Done render the mockup's headings and section frames with `<Wip feature=…/>` in place of data; Plan also shows the CLI commands (`rdc sync source --no-push`, `rdc sync target --no-push`, `rdc migrate source target`, `rdc sync target --dry-run`) as the honest next step. `CLAUDE.md`: rewrite the rdc bullet to say it is the deployments UI, reads two orgs in memory with `noPush`, writes nothing, and that Plan/Review/Write/own values/history are work in progress pending rdc (spec 2026-10-27).
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run format:check` — all PASS (including `tests/dead-code.test.ts`, which now sees every Task 1 export used).
- [ ] **Step 5:** Run `npm run build`; confirm `dist/console/console.js` contains `Not available yet.` and no `noPush:!1` / `dryRun` / `allowDeletes` (grep the unminified build or search the strings).
- [ ] **Step 6: Commit** `feat(rdc): deployments UI with WIP steps; replace the proof of concept`.

### Task 7: Look check in a real browser

**Files:** none (scratchpad harness only)

- [ ] **Step 1:** Load `dist/` as an unpacked extension (or ask the owner to), unlock the experimental gate, open the Console from a Rossum tab, open rdc.
- [ ] **Step 2:** Compare against the mockup's *This org*, *First visit*, *Connect*, *Plan*: band height equal across screens, belt at the name line, caption under the belt, arrowhead visible, dark mode target-card colours. jsdom has no layout, so this step is the only check for them.
- [ ] **Step 3:** Fix and commit any differences as `fix(rdc): …`; report what was compared.
