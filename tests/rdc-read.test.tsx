// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import Connect from '../src/rdc/components/Connect.jsx';
import Read from '../src/rdc/components/Read.jsx';
import { rateLimitError } from '../src/net/rateLimit.js';
import type { Rdc, Prompt } from '../src/rdc/wasm.js';
import { memoryDataStorage } from './support/rdcDataStorage.js';

const source = {
  name: 'test',
  domain: 'https://partner-sandbox.rossum.app',
  orgId: 20412,
  orgName: 'Acme Test',
};
const orgs = { results: [{ id: 99, name: 'Acme' }] };
const bytes = new Uint8Array([1]);
const outcome = {
  itemsPushed: 0,
  itemsPulled: 1,
  conflicts: 0,
  remoteDeletesResolved: 0,
  fileCount: 1,
};

let root: HTMLElement;
const mount = (el: any) => act(() => void render(el, root));
const flush = () => act(async () => {});
const settle = async () => {
  for (let i = 0; i < 12; i++) await flush();
};
const byText = (sel: string, text: string) =>
  [...root.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.trim() === text)!;
const type = (id: string, value: string) =>
  act(() => {
    const el = root.querySelector<HTMLInputElement>('#' + id)!;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function fakeRdc(sync: (...a: any[]) => Promise<any>) {
  const project = {
    addEnv: vi.fn(),
    sync: vi.fn(sync),
    files: vi.fn(
      () =>
        new Map<string, Uint8Array>([
          ['envs/source/queues/a/queue.json', bytes],
          ['envs/source/queues/a/schema.json', bytes],
          ['envs/source/hooks/h.json', bytes],
          ['envs/target/hooks/x.json', bytes],
          ['envs/target/hooks/y.json', bytes],
        ]),
    ),
    free: vi.fn(),
  };
  const create = vi.fn(() => project);
  return { rdc: { version: () => '1', Project: { create } } as unknown as Rdc, project, create };
}
const noEdits = {
  persisted: false,
  firstRead: false,
  directEdits: [],
  editsNote: '',
  tokenOwner: null,
};
const memoryDs = () =>
  vi.fn(async (op: string, _b: Record<string, unknown>) => (op === 'find' ? [] : {}));
const readProps = (rdc: Rdc | null, over: any = {}) => ({
  rdc,
  rdcError: '',
  source,
  sourceToken: 'stok',
  domain: 'https://acme.rossum.app',
  token: 'ttok',
  organizations: orgs,
  dataStorage: memoryDs(),
  onDone: vi.fn(),
  onBack: vi.fn(),
  onCancel: vi.fn(),
  ...over,
});

describe('Read', () => {
  it('syncs source then target with noPush only, and reports counts', async () => {
    const { rdc, project, create } = fakeRdc(async (_e, _o, _a, log) => {
      log('pull queues');
      return outcome;
    });
    const props = readProps(rdc);
    mount(<Read {...props} />);
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(project.addEnv).toHaveBeenCalledTimes(1);
    expect(project.sync.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['source', { noPush: true }],
      ['target', { noPush: true }],
    ]);
    // a finished read's project is handed to the page, not freed
    expect(project.free).not.toHaveBeenCalled();
    expect(root.textContent).toContain('pull queues');
    expect(root.textContent).toContain('cannot keep its sync state in the org');
    act(() => byText('button', 'Plan the deployment').click());
    expect(props.onDone).toHaveBeenCalledWith({
      counts: {
        source: { queues: 1, schemas: 1, hooks: 1, rules: 0, labels: 0 },
        target: { queues: 0, schemas: 0, hooks: 2, rules: 0, labels: 0 },
      },
      sourceLog: ['pull queues'],
      targetLog: ['pull queues'],
      targetName: 'Acme',
      ...noEdits,
      project,
    });
    // handed on: unmounting the step does not free it
    act(() => void render(null, root));
    expect(project.free).not.toHaveBeenCalled();
  });

  it('shows a kept read without syncing, and reads again on request', async () => {
    const { rdc, project } = fakeRdc(async () => outcome);
    const kept = {
      counts: {
        source: { queues: 4, schemas: 4, hooks: 0, rules: 0, labels: 0 },
        target: { queues: 0, schemas: 0, hooks: 0, rules: 0, labels: 0 },
      },
      sourceLog: ['kept line'],
      targetLog: [],
      targetName: 'Acme',
      ...noEdits,
    };
    mount(<Read {...readProps(rdc, { kept })} />);
    await flush();
    expect(project.sync).not.toHaveBeenCalled();
    expect(root.textContent).toContain('kept line');
    expect(root.textContent).toContain('8 objects read');
    act(() => byText('button', 'Read again').click());
    await settle();
    expect(project.sync).toHaveBeenCalledTimes(2);
    expect(root.textContent).not.toContain('kept line');
  });

  it('frees the project and offers Retry when a sync fails', async () => {
    let n = 0;
    const { rdc, project } = fakeRdc(async () => {
      if (++n === 2) throw new Error('boom');
      return outcome;
    });
    const props = readProps(rdc);
    mount(<Read {...props} />);
    await settle();
    expect(project.free).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('boom');
    expect(props.onDone).not.toHaveBeenCalled();
    act(() => byText('button', 'Retry').click());
    await settle();
    // the retry succeeded, so its project is kept for the Plan
    expect(project.free).toHaveBeenCalledTimes(1);
    expect(root.textContent).not.toContain('boom');
    act(() => void render(null, root));
    expect(project.free).toHaveBeenCalledTimes(2);
  });

  it('shows why when rdc did not load', async () => {
    const props = readProps(null, { rdcError: 'rdc wasm did not load: x' });
    mount(<Read {...props} />);
    await flush();
    expect(root.textContent).toContain('rdc wasm did not load: x');
    expect(byText('button', 'Plan the deployment').hasAttribute('disabled')).toBe(true);
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it('says so when the session lists more than one organization', async () => {
    const { rdc, create } = fakeRdc(async () => outcome);
    mount(<Read {...readProps(rdc, { organizations: { results: [{ id: 1 }, { id: 2 }] } })} />);
    await flush();
    expect(root.textContent).toContain('does not list exactly one organization');
    expect(create).not.toHaveBeenCalled();
  });

  it('shows loading as a neutral status, not an error alert', async () => {
    mount(<Read {...readProps(null, { rdcLoading: true, rdcError: '' })} />);
    await flush();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    const status = root.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Loading rdc');
    expect(status.className).not.toContain('err');
  });

  it('answers a pending prompt with null on unmount', async () => {
    const prompt: Prompt = {
      kind: 'conflict',
      question: 'Which?',
      choices: [{ key: 'a', label: 'A' }],
    };
    let answer: Promise<string | null> | undefined;
    const { rdc } = fakeRdc(async (_e, _o, ask) => {
      answer = ask(prompt);
      return outcome;
    });
    mount(<Read {...readProps(rdc)} />);
    await flush();
    expect(root.textContent).toContain('Which?');
    act(() => void render(null, root));
    await expect(answer).resolves.toBeNull();
  });

  it('answers null to prompts raised after unmount', async () => {
    const prompt: Prompt = {
      kind: 'conflict',
      question: 'Which?',
      choices: [{ key: 'a', label: 'A' }],
    };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const late: Promise<string | null>[] = [];
    const { rdc, project } = fakeRdc(async (_e, _o, ask) => {
      await gate;
      late.push(ask(prompt));
      return outcome;
    });
    mount(<Read {...readProps(rdc)} />);
    await flush();
    act(() => void render(null, root));
    release();
    await settle();
    // both reads had started together; each asks after the step is gone, and reads "no answer"
    expect(project.sync).toHaveBeenCalledTimes(2);
    expect(await Promise.all(late)).toEqual([null, null]);
    expect(project.free).toHaveBeenCalledTimes(1);
  });

  it('sends a chosen answer', async () => {
    const prompt: Prompt = {
      kind: 'conflict',
      question: 'Which?',
      choices: [{ key: 'a', label: 'A' }],
    };
    const answers: Record<string, Promise<string | null>> = {};
    const { rdc } = fakeRdc(async (env, _o, ask) => {
      answers[env] = ask(prompt);
      await answers[env];
      return outcome;
    });
    mount(<Read {...readProps(rdc)} />);
    await flush();
    act(() => byText('button', 'A').click());
    await expect(answers.source).resolves.toBe('a');
    await settle();
    act(() => byText('button', 'A').click());
    await expect(answers.target).resolves.toBe('a');
  });
});

describe('Read with the sync state kept in each org', () => {
  // A project whose tree is `before` until the target's pushless sync, then `after`.
  function persistedRdc(before: [string, string][], after: [string, string][]) {
    const enc = (t: string) => new TextEncoder().encode(t);
    let tree = new Map(before.map(([k, v]) => [k, enc(v)]));
    const calls: unknown[] = [];
    const project = {
      addEnv: vi.fn(),
      useStateStore: vi.fn((store: unknown) => void calls.push(['state', store])),
      sync: vi.fn(async (env: string, opts: any) => {
        calls.push([env, opts]);
        if (env === 'target' && opts.noPush) tree = new Map(after.map(([k, v]) => [k, enc(v)]));
        return outcome;
      }),
      files: vi.fn(() => new Map(tree)),
      writeFile: vi.fn((p: string, b: Uint8Array) => void tree.set(p, b as any)),
      free: vi.fn(),
    };
    const rdc = { version: () => '1', Project: { create: vi.fn(() => project) } } as unknown as Rdc;
    return { rdc, project, calls };
  }

  it('keeps state in each org, loads the target with a dry run, and remembers direct edits', async () => {
    const { rdc, calls } = persistedRdc(
      [
        ['envs/target/hooks/a.json', '1'],
        ['envs/target/rules/r.json', '1'],
      ],
      [
        ['envs/target/hooks/a.json', '2'],
        ['envs/target/rules/r.json', '1'],
      ],
    );
    const ds = vi.fn(async (op: string, _b: Record<string, unknown>) =>
      op === 'find' ? [{ kind: 'directEdits', paths: ['envs/target/labels/l.json'] }] : {},
    );
    const props = readProps(rdc, { dataStorage: ds });
    mount(<Read {...props} />);
    await settle();
    expect(calls.map((c: any) => (c[0] === 'state' ? 'state' : c))).toEqual([
      'state',
      ['source', { noPush: true }],
      ['target', { dryRun: true }],
      ['target', { noPush: true }],
    ]);
    const saved = ds.mock.calls.find((c) => c[0] === 'replace_one')![1] as any;
    expect(saved.replacement.paths).toEqual([
      'envs/target/hooks/a.json',
      'envs/target/labels/l.json',
    ]);
    const list = root.querySelector('[aria-label="Direct edits"]')!;
    expect(list.textContent).toContain('hooks/a.json');
    expect(list.textContent).toContain('labels/l.json');
    expect(list.textContent).not.toContain('rules/r.json');
    expect(root.textContent).not.toContain('cannot keep its sync state');
    act(() => byText('button', 'Plan the deployment').click());
    expect(props.onDone.mock.calls[0][0]).toMatchObject({
      persisted: true,
      firstRead: false,
      directEdits: ['envs/target/hooks/a.json', 'envs/target/labels/l.json'],
    });
  });

  it("gives rdc a store over each org's state collection, with that org's token", async () => {
    const { rdc, calls } = persistedRdc([], []);
    const orgs: Record<string, ReturnType<typeof memoryDataStorage>> = {};
    const stateStorage = vi.fn((domain: string, token: string) => {
      orgs[`${domain} ${token}`] = memoryDataStorage();
      return orgs[`${domain} ${token}`].ds;
    });
    mount(<Read {...readProps(rdc, { stateStorage })} />);
    await settle();
    expect(Object.keys(orgs).sort()).toEqual([
      'https://acme.rossum.app ttok',
      'https://partner-sandbox.rossum.app stok',
    ]);
    const store = (calls.find((c: any) => c[0] === 'state') as any)[1];
    await store.save('source', new Uint8Array([1]), null, 1);
    await store.save('target', new Uint8Array([2]), null, 1);
    expect(orgs['https://partner-sandbox.rossum.app stok'].docs.map((d) => d._id)).toEqual([
      'chrome-sa-extension/rdc-deployments/99/source',
    ]);
    expect(orgs['https://acme.rossum.app ttok'].docs.map((d) => d._id)).toEqual([
      'chrome-sa-extension/rdc-deployments/99/target',
    ]);
  });

  it('says a first read is the baseline, and lists nothing', async () => {
    // a new project's scaffold is not a stored tree
    const { rdc } = persistedRdc(
      [['envs/target/overlay.toml', '']],
      [
        ['envs/target/overlay.toml', ''],
        ['envs/target/hooks/a.json', '1'],
      ],
    );
    const ds = memoryDs();
    mount(<Read {...readProps(rdc, { dataStorage: ds })} />);
    await settle();
    expect(root.textContent).toContain('its current configuration is now the baseline');
    expect(root.querySelector('[aria-label="Direct edits"]')).toBeNull();
    expect(ds.mock.calls.some((c) => c[0] === 'replace_one')).toBe(false);
  });

  it('shows the edits for the visit when Data Storage refuses them', async () => {
    const { rdc } = persistedRdc(
      [['envs/target/hooks/a.json', '1']],
      [['envs/target/hooks/a.json', '2']],
    );
    const ds = vi.fn(async (_op: string, body: any) => {
      if (body?.query?.kind === 'mapping') return [];
      throw new Error('HTTP 403');
    });
    mount(<Read {...readProps(rdc, { dataStorage: ds })} />);
    await settle();
    expect(root.querySelector('[aria-label="Direct edits"]')!.textContent).toContain(
      'hooks/a.json',
    );
    expect(root.textContent).toContain('shown for this visit only: HTTP 403');
  });

  it('hands the stored slug mapping to rdc, and saves it when a sync changed it', async () => {
    const { rdc, project } = persistedRdc(
      [['envs/target/hooks/a.json', '1']],
      [
        ['envs/target/hooks/a.json', '1'],
        ['.rdc/mapping.toml', 'new'],
      ],
    );
    const ds = vi.fn(async (op: string, body: any) =>
      op === 'find' && body.query.kind === 'mapping'
        ? [{ kind: 'mapping', domain: source.domain, orgId: source.orgId, text: 'old' }]
        : op === 'find'
          ? []
          : {},
    );
    mount(<Read {...readProps(rdc, { dataStorage: ds })} />);
    await settle();
    expect(new TextDecoder().decode(project.writeFile.mock.calls[0][1])).toBe('old');
    expect(project.writeFile.mock.calls[0][0]).toBe('.rdc/mapping.toml');
    const saved = ds.mock.calls.find(
      (c) => c[0] === 'replace_one' && (c[1] as any).filter.kind === 'mapping',
    )![1] as any;
    expect(saved.replacement.text).toBe('new');
  });

  it("reading another source neither loads nor overwrites the first source's mapping", async () => {
    const { rdc, project } = persistedRdc(
      [['envs/target/hooks/a.json', '1']],
      [
        ['envs/target/hooks/a.json', '1'],
        ['.rdc/mapping.toml', '# stub'],
      ],
    );
    const a = { kind: 'mapping', domain: source.domain, orgId: source.orgId, text: 'rows of A' };
    const store = memoryDataStorage([a]);
    const b = { ...source, orgId: 777 };
    mount(<Read {...readProps(rdc, { dataStorage: store.ds, source: b })} />);
    await settle();
    expect(project.writeFile).not.toHaveBeenCalled();
    expect(store.docs).toContainEqual(a);
    expect(store.docs.find((d: any) => d.kind === 'mapping' && d.orgId === 777)).toMatchObject({
      text: '# stub',
    });
  });

  it('fails the read when the changed slug mapping cannot be saved', async () => {
    const { rdc, project } = persistedRdc(
      [['envs/target/hooks/a.json', '1']],
      [
        ['envs/target/hooks/a.json', '1'],
        ['.rdc/mapping.toml', 'new rows'],
      ],
    );
    const ds = vi.fn(async (op: string, body: any) => {
      if (op === 'find') return [];
      if (body.filter?.kind === 'mapping') throw new Error('HTTP 503');
      return {};
    });
    const props = readProps(rdc, { dataStorage: ds });
    mount(<Read {...props} />);
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('HTTP 503');
    expect(byText('button', 'Plan the deployment').hasAttribute('disabled')).toBe(true);
    expect(project.free).toHaveBeenCalledTimes(1);
  });

  it('stops before any sync when the slug mapping cannot be loaded', async () => {
    const { rdc, project } = persistedRdc([], []);
    const ds = vi.fn(async () => {
      throw new Error('HTTP 500');
    });
    mount(<Read {...readProps(rdc, { dataStorage: ds })} />);
    await settle();
    expect(project.sync).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('HTTP 500');
  });

  it("explains rdc's Web Lock refusal, and keeps rdc's words", async () => {
    const { rdc } = fakeRdc(async () => {
      throw new Error("env 'source' is already being synced in another tab");
    });
    mount(<Read {...readProps(rdc)} />);
    await settle();
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Another tab of this browser is reading or deploying');
    expect(alert.textContent).toContain('already being synced in another tab');
    expect(byText('button', 'Retry')).toBeTruthy();
  });

  it('says an abandoned read in this tab, not another tab, still holds the lock', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = fakeRdc(async () => {
      await gate;
      return outcome;
    });
    mount(<Read {...readProps(first.rdc)} />);
    await flush();
    // the admin leaves while the first read is still syncing, and comes back
    act(() => void render(null, root));
    const second = fakeRdc(async () => {
      throw new Error("env 'source' is already being synced in another tab");
    });
    mount(<Read {...readProps(second.rdc)} />);
    await settle();
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('still finishing an earlier run');
    expect(alert.textContent).not.toContain('Another tab of this browser');
    release();
    await settle();
  });

  it('shows the last log line above a prompt', async () => {
    const prompt: Prompt = {
      kind: 'conflict',
      question: '[1] it is id 5  [a] abort the sync > ',
      choices: [{ key: '1', label: 'it is id 5' }],
    };
    const { rdc } = fakeRdc(async (_e, _o, ask, log) => {
      log('labels/hold: an unfinished run may have made any of 2 labels');
      await ask(prompt);
      return outcome;
    });
    mount(<Read {...readProps(rdc)} />);
    await flush();
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('an unfinished run may have made any of 2 labels');
    act(() => byText('button', 'it is id 5').click());
  });
});

describe('Connect', () => {
  it('refuses a token that cannot read the chosen org and stays', async () => {
    const onConnected = vi.fn();
    mount(
      <Connect
        source={source}
        fetchOrgs={async () => ({ results: [{ id: 1 }] })}
        onConnected={onConnected}
        onBack={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await type('rdc-conn-token', 'tok');
    act(() => byText('button', 'Check token').click());
    await flush();
    expect(root.textContent).toContain('This token cannot read Acme Test, org 20412.');
    expect(byText('button', 'Read both orgs').hasAttribute('disabled')).toBe(true);
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('passes a token that lists the org and hands it on', async () => {
    const onConnected = vi.fn();
    const fetchOrgs = vi.fn(async () => ({ results: [{ id: 20412, name: 'Acme Test' }] }));
    mount(
      <Connect
        source={source}
        fetchOrgs={fetchOrgs}
        onConnected={onConnected}
        onBack={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await type('rdc-conn-token', ' tok ');
    act(() => byText('button', 'Check token').click());
    await flush();
    expect(fetchOrgs).toHaveBeenCalledWith(source.domain, 'tok');
    act(() => byText('button', 'Read both orgs').click());
    expect(onConnected).toHaveBeenCalledWith('tok');
    expect(root.querySelector('[role="note"]')).not.toBeNull();
  });

  it('shows a thrown non-Error value, not undefined', async () => {
    mount(
      <Connect
        source={source}
        fetchOrgs={async () => {
          throw 'boom';
        }}
        onConnected={vi.fn()}
        onBack={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await type('rdc-conn-token', 'tok');
    act(() => byText('button', 'Check token').click());
    await flush();
    expect(root.textContent).toContain('Could not check the token: boom');
    expect(root.textContent).not.toContain('undefined');
  });

  it('disables Read both orgs, with the reason, when rdc is blocked', async () => {
    mount(
      <Connect
        source={source}
        fetchOrgs={async () => ({ results: [{ id: 20412, name: 'Acme Test' }] })}
        blocked="rdc is not in this build."
        onConnected={vi.fn()}
        onBack={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await type('rdc-conn-token', 'tok');
    act(() => byText('button', 'Check token').click());
    await flush();
    const btn = byText('button', 'Read both orgs') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('rdc is not in this build.');
    expect(root.textContent).toContain('rdc is not in this build.');
  });

  it('shows a 429 as rate limited, not as no organizations', async () => {
    mount(
      <Connect
        source={source}
        fetchOrgs={async () => {
          throw rateLimitError({ headers: { get: () => null } }, 'HTTP 429');
        }}
        onConnected={vi.fn()}
        onBack={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await type('rdc-conn-token', 'tok');
    act(() => byText('button', 'Check token').click());
    await flush();
    expect(root.textContent).toContain('rate-limiting');
    expect(root.textContent).not.toContain('cannot read');
  });
});

describe('Read runs the source and the target reads at once', () => {
  // A project whose syncs the test drives: each call records itself and runs `sync`.
  function drivenRdc(sync: (env: string, opts: any, ask: any, log: any) => Promise<any>) {
    const events: string[] = [];
    const project = {
      addEnv: vi.fn(),
      useStateStore: vi.fn(),
      sync: vi.fn(async (env: string, opts: any, ask: any, log: any) => {
        const name = `${env} ${opts.dryRun ? 'dryRun' : 'noPush'}`;
        events.push(`start ${name}`);
        try {
          return await sync(env, opts, ask, log);
        } finally {
          events.push(`end ${name}`);
        }
      }),
      files: vi.fn(() => new Map<string, Uint8Array>()),
      writeFile: vi.fn(),
      free: vi.fn(),
    };
    const rdc = { version: () => '1', Project: { create: vi.fn(() => project) } } as unknown as Rdc;
    return { rdc, project, events };
  }
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('starts the target pair while the source read is still running, dry run before pull', async () => {
    const source = deferred();
    const { rdc, events } = drivenRdc(async (env) => {
      if (env === 'source') await source.promise;
      return outcome;
    });
    mount(<Read {...readProps(rdc)} />);
    await settle();
    // the source has not finished, yet the target's dry run and pull have both run
    expect(events).toEqual([
      'start source noPush',
      'start target dryRun',
      'end target dryRun',
      'start target noPush',
      'end target noPush',
    ]);
    source.resolve();
    await settle();
    expect(events.at(-1)).toBe('end source noPush');
    expect(byText('button', 'Plan the deployment').hasAttribute('disabled')).toBe(false);
  });

  it('lets the other read finish when one fails, and reports both', async () => {
    const { rdc, project, events } = drivenRdc(async (env) => {
      if (env === 'source') throw new Error('HTTP 502');
      return outcome;
    });
    const props = readProps(rdc);
    mount(<Read {...props} />);
    await settle();
    expect(events).toContain('end target noPush');
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Reading test failed: HTTP 502');
    expect(alert.textContent).toContain('Reading Acme finished');
    expect(byText('button', 'Plan the deployment').hasAttribute('disabled')).toBe(true);
    expect(project.free).toHaveBeenCalledTimes(1);
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it('shows two prompts that arrive at once one after the other, each with its org', async () => {
    const q = (question: string): Prompt => ({
      kind: 'conflict',
      question,
      choices: [{ key: 'k', label: `answer ${question}` }],
    });
    const answers: Record<string, unknown> = {};
    const { rdc } = drivenRdc(async (env, opts, ask, log) => {
      if (opts.dryRun) return outcome;
      log(`${env} context`);
      answers[env] = await ask(q(`${env}?`));
      return outcome;
    });
    mount(<Read {...readProps(rdc)} />);
    await settle();
    const dialogs = () => [...root.querySelectorAll('[role="dialog"]')];
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0].textContent).toContain('source?');
    expect(dialogs()[0].textContent).toContain('test');
    expect(dialogs()[0].textContent).toContain('source context');
    act(() => byText('button', 'answer source?').click());
    await settle();
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0].textContent).toContain('target?');
    expect(dialogs()[0].textContent).toContain('Acme');
    expect(dialogs()[0].textContent).toContain('target context');
    act(() => byText('button', 'answer target?').click());
    await settle();
    expect(answers).toEqual({ source: 'k', target: 'k' });
  });

  it('leaving the step answers every queued prompt with null and starts nothing more', async () => {
    const answers: unknown[] = [];
    const dry = deferred();
    const { rdc, events } = drivenRdc(async (env, opts, ask) => {
      if (opts.dryRun) {
        await dry.promise;
        return outcome;
      }
      answers.push(await ask({ kind: 'conflict', question: `${env}?`, choices: [] }));
      return outcome;
    });
    mount(<Read {...readProps(rdc)} />);
    await settle();
    act(() => void render(null, root));
    dry.resolve();
    await settle();
    expect(answers).toEqual([null]);
    // the target's dry run finished after the step was left, so its pull never started
    expect(events).not.toContain('start target noPush');
  });
});
