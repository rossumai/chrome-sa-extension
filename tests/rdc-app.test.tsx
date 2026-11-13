// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import App from '../src/rdc/components/App.jsx';
import { domain, token } from '../src/rdc/store.js';
import type { PlanItem, Rdc } from '../src/rdc/wasm.js';
import { rateLimitError } from '../src/net/rateLimit.js';

const outcome = {
  itemsPushed: 0,
  itemsPulled: 1,
  conflicts: 0,
  remoteDeletesResolved: 0,
  fileCount: 1,
};

function fakeRdc() {
  const project = {
    addEnv: vi.fn(),
    sync: vi.fn(async (_env: string, _opts: any, _ask: any, log: (l: string) => void) => {
      log('pulled');
      return outcome;
    }),
    files: vi.fn(() => new Map<string, Uint8Array>()),
    free: vi.fn(),
  };
  const rdc = {
    version: () => '1.0.0',
    Project: { create: vi.fn(() => project) },
  } as unknown as Rdc;
  return { rdc, project };
}

// A build with the crash-safe sync, migrate and the dry-run plan. The read's dry run loads the
// last run's target tree; the pull finds hooks/a.json changed directly in the target. Plan works
// on a scratch copy (`new Project(files)`), whose dry-run sync answers the plan of what Write sends.
// `storeHook`: the source has a store extension the migrate creates in the target (hooks/mdh).
// `storedOwner`: the target's overlay already names the hooks' token owner. Every migrate call
// records the target overlay as it was when it ran (`overlaySeen`).
function fullRdc(
  push: (ask: any) => Promise<Partial<typeof outcome>> = async () => ({}),
  opts: { storeHook?: boolean; storedOwner?: string } = {},
) {
  const enc = (t: string) => new TextEncoder().encode(t);
  const OVERLAY = 'envs/target/overlay.toml';
  let tree = new Map<string, Uint8Array>([
    ['envs/target/hooks/a.json', enc('old')],
    [
      OVERLAY,
      enc(
        `version = 1\n${opts.storedOwner ? `\n[hooks."*"]\ntoken_owner = "${opts.storedOwner}"\n` : ''}`,
      ),
    ],
  ]);
  const overlaySeen: string[] = [];
  const migrated = (o: any) => ({
    dryRun: !!o.dryRun,
    source: 'source',
    target: 'target',
    files: [
      {
        source: 'envs/source/hooks/a.json',
        target: 'envs/target/hooks/a.json',
        change: 'update',
        kind: 'hooks',
        slug: 'a',
      },
      {
        source: 'envs/source/rules/r.json',
        target: 'envs/target/rules/r.json',
        change: 'create',
        kind: 'rules',
        slug: 'r',
      },
      ...(opts.storeHook
        ? [
            {
              source: 'envs/source/hooks/mdh.json',
              target: 'envs/target/hooks/mdh.json',
              change: 'create',
              kind: 'hooks',
              slug: 'mdh',
            },
          ]
        : []),
    ],
    objects: [],
    pruned: [],
    prunedDirs: [],
    skipped: [],
    warnings: ['queues/cost: an id was remapped'],
    creates: 1,
    updates: 1,
    unchanged: 3,
    deletes: 0,
    filesChanged: 2,
    renamed: 0,
  });
  const migrate = (t: Map<string, Uint8Array>) =>
    vi.fn(async (_s: string, _t: string, o: any, log: (l: string) => void) => {
      log('migrate');
      overlaySeen.push(new TextDecoder().decode(t.get(OVERLAY) ?? new Uint8Array()));
      if (!o.dryRun) {
        t.set('envs/target/hooks/a.json', enc('from source'));
        t.set('envs/target/rules/r.json', enc('from source'));
        if (opts.storeHook)
          t.set(
            'envs/target/hooks/mdh.json',
            enc(JSON.stringify({ name: 'MDH', extension_source: 'rossum_store' })),
          );
      }
      return migrated(o);
    });
  const project = {
    addEnv: vi.fn(),
    useStateStore: vi.fn(),
    sync: vi.fn(async (env: string, opts: any, ask: any, log: (l: string) => void) => {
      log(`sync ${env}`);
      if (env === 'target' && opts.noPush) tree.set('envs/target/hooks/a.json', enc('edited'));
      if (opts.noPush || opts.dryRun) return { ...outcome, skipped: [] };
      return { ...outcome, itemsPushed: 3, skipped: [], ...(await push(ask)) };
    }),
    migrate: migrate(tree),
    files: vi.fn(() => new Map(tree)),
    writeFile: vi.fn((p: string, b: Uint8Array) => void tree.set(p, b)),
    deleteFile: vi.fn((p: string) => void tree.delete(p)),
    free: vi.fn(),
  };
  const scratches: any[] = [];
  function Project(files: Map<string, Uint8Array>) {
    const t = new Map(files);
    const scratch = {
      migrate: migrate(t),
      files: () => new Map(t),
      writeFile: (p: string, b: Uint8Array) => void t.set(p, b),
      sync: vi.fn(async (_env: string, _opts: any, _ask: any, log: (l: string) => void) => {
        log('dry run of target');
        const items: PlanItem[] = [
          {
            kind: 'hooks',
            slug: 'a',
            direction: 'push',
            change: 'update',
            prompt: null,
            note: null,
          },
          {
            kind: 'hooks',
            slug: 'gone',
            direction: 'push',
            change: 'delete',
            prompt: 'deleteGate',
            note: null,
          },
          {
            kind: 'queues',
            slug: 'cost',
            direction: 'pull',
            change: 'update',
            prompt: null,
            note: null,
          },
        ];
        if (t.has('envs/target/hooks/mdh.json'))
          items.unshift({
            kind: 'hooks',
            slug: 'mdh',
            direction: 'push',
            change: 'create',
            prompt: null,
            note: 'new',
          });
        if (t.has('envs/target/rules/r.json'))
          items.unshift({
            kind: 'rules',
            slug: 'r',
            direction: 'push',
            change: 'create',
            prompt: null,
            note: 'new',
          });
        return {
          ...outcome,
          skipped: [],
          plan: {
            items,
            recovered: [{ kind: 'labels', slug: 'hold', id: 5 }],
            problems: ['hooks/a: a secret is missing'],
          },
        };
      }),
      free: vi.fn(),
    };
    scratches.push(scratch);
    return scratch;
  }
  Project.create = vi.fn(() => project);
  const rdc = { version: () => '1.0.0', Project } as unknown as Rdc;
  return { rdc, project, scratches, tree: () => tree, overlaySeen };
}

// The session sees Acme; the source token sees Acme Test.
const fetchOrgs = vi.fn(async (d: string, _t: string) =>
  d === 'https://acme.rossum.app'
    ? { results: [{ id: 31007, name: 'Acme' }] }
    : { results: [{ id: 20412, name: 'Acme Test' }] },
);

// The org's Data Storage: nothing saved yet, and saving works.
let ds: ReturnType<typeof vi.fn>;

let root: HTMLElement;
let chromeSet: ReturnType<typeof vi.fn>;
let sessionSet: ReturnType<typeof vi.spyOn>;
const mount = (el: any) => act(() => void render(el, root));
// a macrotask, so promise chains (the target, then the saved source) settle
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const byText = (sel: string, text: string) =>
  [...root.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.trim() === text)!;
const click = async (sel: string, text: string) => {
  act(() => byText(sel, text).click());
  await flush();
};
const type = (id: string, value: string) =>
  act(() => {
    const el = root.querySelector<HTMLInputElement>('#' + id)!;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const controls = () => [...root.querySelectorAll<HTMLInputElement>('input, select')];

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  domain.value = 'https://acme.rossum.app';
  token.value = 'ttok';
  chromeSet = vi.fn();
  (globalThis as any).chrome = { storage: { local: { set: chromeSet } } };
  sessionSet = vi.spyOn(Storage.prototype, 'setItem');
  ds = vi.fn(async (op: string, _body: Record<string, unknown>) => (op === 'find' ? [] : {}));
});
afterEach(() => {
  render(null, root);
  root.remove();
  sessionSet.mockRestore();
  delete (globalThis as any).chrome;
});

const loadRdc = () => Promise.resolve(fakeRdc().rdc);

describe('rdc App', () => {
  it('says so when not connected', () => {
    mount(
      <App connected={false} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />,
    );
    expect(root.textContent).toContain('Not connected');
  });

  it('shows the overview for the connected org', async () => {
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    expect(root.textContent).toContain('Bring tested configuration into Acme');
    expect(root.querySelector('[data-role="target"]')!.textContent).toContain('org 31007');
  });

  it('refuses a session that does not list exactly one organization', async () => {
    const two = vi.fn(async () => ({
      results: [
        { id: 1, name: 'x' },
        { id: 2, name: 'y' },
      ],
    }));
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={two} />);
    await flush();
    expect(root.textContent).toContain('does not list exactly one organization');
    expect(byText('button', 'Choose the org to deploy from')).toBeUndefined();
  });

  it('says Rossum is rate-limiting when the org cannot be read for a 429', async () => {
    const limited = vi.fn(async () => {
      throw rateLimitError({ headers: new Headers({ 'Retry-After': '7' }) }, 'HTTP 429');
    });
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={limited} />);
    await flush();
    expect(root.querySelector('.error-banner')!.textContent).toBe(
      'Rossum is rate-limiting requests. Try again in 7 s.',
    );
    expect(root.textContent).not.toContain('Could not read this organization');
    expect(ds).not.toHaveBeenCalled();
  });

  it('remembers the chosen source in the org, without its token', async () => {
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    expect(ds).toHaveBeenCalledWith('find', { query: { kind: 'source' }, limit: 1 });
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Use test as the source');
    const save = ds.mock.calls.find(([op]) => op === 'replace_one')!;
    expect(save[1]).toMatchObject({
      filter: { kind: 'source' },
      replacement: {
        kind: 'source',
        name: 'test',
        domain: 'https://partner-sandbox.rossum.app',
        orgId: 20412,
        orgName: 'Acme Test',
      },
      options: { upsert: true },
    });
    expect(JSON.stringify(save[1])).not.toContain('stok');
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it('opens on the remembered source', async () => {
    ds = vi.fn(async (op: string) =>
      op === 'find'
        ? [
            {
              kind: 'source',
              name: 'test',
              domain: 'https://partner-sandbox.rossum.app',
              orgId: 20412,
              orgName: 'Acme Test',
            },
          ]
        : {},
    );
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    expect(root.textContent).toContain('Acme deploys from');
    expect(root.textContent).not.toContain('Bring tested configuration');
  });

  it('says when the source cannot be loaded or saved, and still works for the visit', async () => {
    ds = vi.fn(async () => {
      throw new Error('HTTP 403');
    });
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    expect(root.textContent).toContain('Could not load the saved source: HTTP 403');
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Use test as the source');
    expect(root.textContent).toContain('Acme deploys from');
    expect(root.textContent).toContain(
      'Could not save the source in this org, so it is used for this visit only: HTTP 403',
    );
  });

  it('shows the source form inline, hidden until asked for', async () => {
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    expect(root.querySelector('#rdc-src-address')).toBeNull();
    await click('button', 'Choose the org to deploy from');
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(
      root.querySelector('section[aria-label="Choose the org to deploy from"]'),
    ).not.toBeNull();
    expect(byText('button', 'Choose the org to deploy from')).toBeUndefined();
    expect((byText('button', 'Use test as the source') as HTMLButtonElement).disabled).toBe(true);
    await click('button', 'Cancel');
    expect(root.querySelector('#rdc-src-address')).toBeNull();
    expect(byText('button', 'Choose the org to deploy from')).toBeDefined();

    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Use test as the source');
    expect(root.querySelector('#rdc-src-address')).toBeNull();
    await click('button', 'Change source');
    expect(root.querySelector('#rdc-src-address')).not.toBeNull();
    expect(byText('button', 'Change source')).toBeUndefined();
    expect(root.textContent).toContain('Acme deploys from');
  });

  it('does not ask again for the token the source was just found with', async () => {
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Use test as the source');
    await click('button', 'Deploy from test');
    expect((root.querySelector('#rdc-conn-token') as HTMLInputElement).value).toBe('stok');
    expect(root.textContent).toContain('The token can read');
    expect((byText('button', 'Read both orgs') as HTMLButtonElement).disabled).toBe(false);
    // leaving the deployment forgets it: the next one asks again
    await click('button', 'Cancel');
    await click('button', 'Deploy from test');
    expect((root.querySelector('#rdc-conn-token') as HTMLInputElement).value).toBe('');
  });

  it('deploys: plans on a scratch copy, reviews what rdc will send, writes after the typed name', async () => {
    const { rdc, project, scratches, tree } = fullRdc();
    mount(
      <App
        connected={true}
        dataStorage={ds as any}
        loadRdc={async () => rdc}
        fetchOrgs={fetchOrgs}
      />,
    );
    await flush();
    await toPlan();
    await flush();
    expect(root.textContent).toContain('Plan what to bring');
    // the plan never touches the read's project: a scratch copy is migrated and dry-run synced
    expect(project.migrate).not.toHaveBeenCalled();
    expect(scratches).toHaveLength(1);
    expect(scratches[0].migrate).toHaveBeenCalledWith(
      'source',
      'target',
      { dryRun: false, mirror: false, carry: [] },
      expect.any(Function),
    );
    expect(scratches[0].sync).toHaveBeenCalledWith(
      'target',
      { dryRun: true, interactive: false },
      expect.any(Function),
      expect.any(Function),
    );
    expect(scratches[0].free).toHaveBeenCalled();
    const plan = root.querySelector('[aria-label="The plan"]')!;
    expect(plan.textContent).toContain('Create 1');
    expect(plan.textContent).toContain('Delete 1');
    expect(plan.textContent).toContain('queues/cost: an id was remapped');

    act(() => byText('b', 'Delete them').click());
    await flush();
    expect(scratches).toHaveLength(2);
    expect(scratches[1].migrate).toHaveBeenCalledWith(
      'source',
      'target',
      { dryRun: false, mirror: true, carry: [] },
      expect.any(Function),
    );

    await click('button', 'Review the changes');
    expect(root.textContent).toContain('Review the changes to Acme');
    expect(root.querySelector('[aria-label="Created"]')!.textContent).toContain('rules/r');
    expect(root.querySelector('[aria-label="Updated"]')!.textContent).toContain('hooks/a');
    const deleted = root.querySelector('[aria-label="Deleted"]')!;
    expect(deleted.textContent).toContain('hooks/gone');
    expect(deleted.textContent).toContain('rdc asks before it deletes');
    expect(root.querySelector('[aria-label="Read back"]')!.textContent).toContain('queues/cost');
    expect(
      root.querySelector('[aria-label="Finished from an earlier deployment"]')!.textContent,
    ).toContain('labels/hold');
    expect(root.textContent).toContain('hooks/a: a secret is missing');
    expect(root.querySelector('details')!.textContent).toContain('dry run of target');
    const warn = root.querySelector('[aria-label="Overwritten direct edits"]')!;
    expect(warn.textContent).toContain('hooks/a');
    expect(warn.querySelectorAll('button')).toHaveLength(0);

    await click('button', 'Continue to write');
    const go = byText('button', 'Write the changes to Acme') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    act(() => {
      const el = root.querySelector<HTMLInputElement>('[aria-label="Type Acme to confirm"]')!;
      el.value = 'Acme';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => go.click());
    await flush();
    await flush();
    expect(project.migrate).toHaveBeenLastCalledWith(
      'source',
      'target',
      { dryRun: false, mirror: true, carry: [] },
      expect.any(Function),
    );
    expect(project.sync).toHaveBeenLastCalledWith(
      'target',
      {},
      expect.any(Function),
      expect.any(Function),
    );
    expect(new TextDecoder().decode(tree().get('envs/target/hooks/a.json'))).toBe('from source');
    expect(project.writeFile).not.toHaveBeenCalled();

    expect(root.textContent).toContain('After the deployment');
    expect(root.textContent).toContain('3 changes written to Acme');
    expect(root.querySelector('[aria-label="Not written"]')).toBeNull();
    const edits = ds.mock.calls.filter(
      (c) => c[0] === 'replace_one' && (c[1] as any).filter.kind === 'directEdits',
    );
    // hooks/a was overwritten, so its warning goes
    expect((edits.at(-1)![1] as any).replacement.paths).toEqual([]);
    expect(chromeSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
  });

  async function toWrite() {
    await toPlan();
    await flush();
    await click('button', 'Review the changes');
    await click('button', 'Continue to write');
    act(() => {
      const el = root.querySelector<HTMLInputElement>('[aria-label="Type Acme to confirm"]')!;
      el.value = 'Acme';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => byText('button', 'Write the changes to Acme').click());
    await flush();
    await flush();
  }

  it('after a write that did not finish, Back plans again from the tree as it is', async () => {
    let fail = true;
    const { rdc, scratches } = fullRdc(async () => {
      if (fail) throw new Error('HTTP 502');
      return {};
    });
    mount(
      <App
        connected={true}
        dataStorage={ds as any}
        loadRdc={async () => rdc}
        fetchOrgs={fetchOrgs}
      />,
    );
    await flush();
    await toWrite();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('HTTP 502');
    fail = false;
    await click('button', 'Back');
    await flush();
    expect(root.textContent).toContain('Plan what to bring');
    expect(scratches).toHaveLength(2);
    // the new plan starts from the tree the failed write left
    expect(scratches[1].sync).toHaveBeenCalled();
  });

  it("a write that skipped something lists it with rdc's reason; only what was written loses its warning", async () => {
    const { rdc } = fullRdc(async () => ({
      itemsPushed: 2,
      skipped: [
        { kind: 'hooks', slug: 'gone', reason: 'deleteGateDeclined' },
        { kind: 'hooks', slug: 'a', reason: 'pushDriftSkipped' },
      ],
    }));
    mount(
      <App
        connected={true}
        dataStorage={ds as any}
        loadRdc={async () => rdc}
        fetchOrgs={fetchOrgs}
      />,
    );
    await flush();
    await toWrite();
    expect(root.textContent).toContain('2 changes written to Acme');
    const notWritten = root.querySelector('[aria-label="Not written"]')!;
    expect(notWritten.textContent).toContain('hooks/gone: The delete was declined.');
    expect(notWritten.textContent).toContain('hooks/a: Not sent');
    // hooks/a, the only direct edit, was skipped, so its warning stays: nothing is saved
    const saves = ds.mock.calls.filter(
      (c) => c[0] === 'replace_one' && (c[1] as any).filter.kind === 'directEdits',
    );
    expect(saves.map((c) => (c[1] as any).replacement.paths)).toEqual([
      ['envs/target/hooks/a.json'],
    ]);
  });

  const users = [
    { url: 'https://acme.rossum.app/api/v1/users/7', label: 'Ada Admin (ada@example.com)' },
    { url: 'https://acme.rossum.app/api/v1/users/8', label: 'Bo Builder (bo@example.com)' },
  ];
  const select = () => root.querySelector<HTMLSelectElement>('select[aria-label="Token owner"]')!;
  const choose = async (url: string) => {
    act(() => {
      select().value = url;
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    await flush();
  };

  it("asks for the hooks' token owner when the plan creates a store extension, and plans with it", async () => {
    const { rdc, project, scratches, overlaySeen } = fullRdc(undefined, { storeHook: true });
    const fetchUsers = vi.fn(async () => users);
    mount(
      <App
        connected={true}
        dataStorage={ds as any}
        loadRdc={async () => rdc}
        fetchOrgs={fetchOrgs}
        fetchUsers={fetchUsers}
      />,
    );
    await flush();
    await toPlan();
    await flush();
    await click('button', 'Review the changes');
    await flush();
    expect(root.querySelector('[aria-label="Token owner"]')!.textContent).toContain('hooks/mdh');
    expect(fetchUsers).toHaveBeenCalledWith('https://acme.rossum.app', 'ttok');
    const next = () => byText('button', 'Continue to write') as HTMLButtonElement;
    expect(next().disabled).toBe(true);

    await choose(users[1].url);
    // the plan is made again on a fresh scratch copy whose overlay already names the owner
    expect(scratches).toHaveLength(2);
    expect(overlaySeen.at(-1)).toContain(`[hooks."*"]\ntoken_owner = "${users[1].url}"`);
    expect(
      root.querySelector('[aria-label="Written to the target\'s own values"]')!.textContent,
    ).toContain(users[1].url);
    expect(next().disabled).toBe(false);

    await click('button', 'Continue to write');
    act(() => {
      const el = root.querySelector<HTMLInputElement>('[aria-label="Type Acme to confirm"]')!;
      el.value = 'Acme';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => byText('button', 'Write the changes to Acme').click());
    await flush();
    await flush();
    // Write wrote the owner into the read's project BEFORE its migrate ran
    expect(project.migrate).toHaveBeenCalledTimes(1);
    expect(overlaySeen.at(-1)).toContain(`token_owner = "${users[1].url}"`);
    expect(root.textContent).toContain('After the deployment');
  });

  it('pre-selects the stored token owner on a later visit, and lets the admin change it', async () => {
    const stored = users[0].url;
    const { rdc, scratches, overlaySeen } = fullRdc(undefined, {
      storeHook: true,
      storedOwner: stored,
    });
    mount(
      <App
        connected={true}
        dataStorage={ds as any}
        loadRdc={async () => rdc}
        fetchOrgs={fetchOrgs}
        fetchUsers={async () => users}
      />,
    );
    await flush();
    await toPlan();
    await flush();
    // the first plan already used the stored owner
    expect(overlaySeen[0]).toContain(`token_owner = "${stored}"`);
    await click('button', 'Review the changes');
    await flush();
    expect(select().value).toBe(stored);
    expect((byText('button', 'Continue to write') as HTMLButtonElement).disabled).toBe(false);
    await choose(users[1].url);
    expect(scratches).toHaveLength(2);
    expect(overlaySeen.at(-1)).toContain(`token_owner = "${users[1].url}"`);
    expect(overlaySeen.at(-1)).not.toContain(stored);
  });

  it('asks nothing about a token owner when the plan creates no store extension', async () => {
    const { rdc } = fullRdc();
    const fetchUsers = vi.fn(async () => users);
    mount(
      <App
        connected={true}
        dataStorage={ds as any}
        loadRdc={async () => rdc}
        fetchOrgs={fetchOrgs}
        fetchUsers={fetchUsers}
      />,
    );
    await flush();
    await toPlan();
    await flush();
    await click('button', 'Review the changes');
    expect(root.querySelector('[aria-label="Token owner"]')).toBeNull();
    expect(fetchUsers).not.toHaveBeenCalled();
  });

  it('cannot plan or write with a build that has no migrate', async () => {
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    await toPlan();
    expect(root.textContent).toContain('This build of rdc cannot plan in the browser.');
    expect((byText('button', 'Review the changes') as HTMLButtonElement).disabled).toBe(true);
  });

  it('goes back from Read to Connect', async () => {
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Use test as the source');
    await click('button', 'Deploy from test');
    await type('rdc-conn-token', 'stok');
    await click('button', 'Check token');
    await click('button', 'Read both orgs');
    await click('button', 'Back');
    expect(root.textContent).toContain('Connect to test');
  });

  // From the overview to a finished read, then on to Plan.
  async function toPlan() {
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Use test as the source');
    await click('button', 'Deploy from test');
    await type('rdc-conn-token', 'stok');
    await click('button', 'Check token');
    await click('button', 'Read both orgs');
    await flush();
    await click('button', 'Plan the deployment');
  }

  it('cancels from Plan to the overview without reading again', async () => {
    const { rdc, project } = fakeRdc();
    mount(
      <App
        connected={true}
        dataStorage={ds as any}
        loadRdc={async () => rdc}
        fetchOrgs={fetchOrgs}
      />,
    );
    await flush();
    await toPlan();
    expect(project.sync).toHaveBeenCalledTimes(2);
    expect(project.free).not.toHaveBeenCalled();
    await click('button', 'Cancel');
    expect(root.textContent).toContain('Acme deploys from');
    expect(project.sync).toHaveBeenCalledTimes(2);
    // leaving the deployment frees the read's project, once
    expect(project.free).toHaveBeenCalledTimes(1);
  });

  it('goes back from Plan to the kept read, and reads again only on request', async () => {
    const { rdc, project } = fakeRdc();
    mount(
      <App
        connected={true}
        dataStorage={ds as any}
        loadRdc={async () => rdc}
        fetchOrgs={fetchOrgs}
      />,
    );
    await flush();
    await toPlan();
    await click('button', 'Back');
    await flush();
    expect(root.textContent).toContain('Reading both orgs');
    expect(root.textContent).toContain('0 objects read');
    expect(root.textContent).toContain('pulled');
    expect(project.sync).toHaveBeenCalledTimes(2);
    await click('button', 'Read again');
    await flush();
    expect(project.sync).toHaveBeenCalledTimes(4);
  });

  it('offers Cancel on every wizard step', async () => {
    const { rdc } = fullRdc();
    mount(
      <App
        connected={true}
        dataStorage={ds as any}
        loadRdc={async () => rdc}
        fetchOrgs={fetchOrgs}
      />,
    );
    await flush();
    await toPlan();
    await flush();
    expect(byText('button', 'Cancel')).toBeDefined();
    await click('button', 'Review the changes');
    expect(byText('button', 'Cancel')).toBeDefined();
    await click('button', 'Continue to write');
    await click('button', 'Cancel');
    expect(root.textContent).toContain('Acme deploys from');
    await click('button', 'Deploy from test');
    expect(byText('button', 'Cancel')).toBeDefined();
  });

  it('opens own values from the overview, with the work-in-progress note', async () => {
    mount(<App connected={true} dataStorage={ds as any} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Use test as the source');
    await click('button', 'Edit');
    expect(root.textContent).toContain('What Acme keeps for itself');
    expect(root.textContent).toContain('Not available yet. Own values are stored with the project');
    controls().forEach((c) => expect(c.disabled).toBe(true));
    expect(byText('button', 'Save changes').hasAttribute('disabled')).toBe(true);
    expect(root.textContent).not.toContain('Always Acme');
    expect(root.textContent).not.toContain('Hook secrets');
    expect(root.querySelector('table')).toBeNull();
    expect(chromeSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it('says rdc is not in this build when it does not load', async () => {
    const missing = () => Promise.reject(new Error('console/rdc/rdc_wasm.js is not in this build'));
    mount(<App connected={true} dataStorage={ds as any} loadRdc={missing} fetchOrgs={fetchOrgs} />);
    await flush();
    expect(root.textContent).toContain('Bring tested configuration into Acme');
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Use test as the source');
    const deploy = byText('button', 'Deploy from test') as HTMLButtonElement;
    expect(deploy.disabled).toBe(true);
    expect(deploy.title).toContain('rdc_wasm.js is not in this build');
    expect(root.textContent).toContain('rdc_wasm.js is not in this build');
  });

  it('blocks Deploy while rdc loads and after it fails', async () => {
    let fail!: (e: Error) => void;
    const loading = new Promise<Rdc>((_r, rej) => (fail = rej));
    mount(
      <App
        connected={true}
        dataStorage={ds as any}
        loadRdc={() => loading}
        fetchOrgs={fetchOrgs}
      />,
    );
    await flush();
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Use test as the source');
    // still loading: blocked with the loading text
    expect((byText('button', 'Deploy from test') as HTMLButtonElement).disabled).toBe(true);
    act(() => fail(new Error('gone')));
    await flush();
    expect((byText('button', 'Deploy from test') as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks GET /organizations once for the connected org across a whole read', async () => {
    const { rdc } = fakeRdc();
    const f = vi.fn(fetchOrgs);
    mount(<App connected={true} dataStorage={ds as any} loadRdc={async () => rdc} fetchOrgs={f} />);
    await flush();
    await toPlan();
    const forTarget = f.mock.calls.filter(([d]) => d === 'https://acme.rossum.app');
    expect(forTarget).toHaveLength(1);
  });
});
