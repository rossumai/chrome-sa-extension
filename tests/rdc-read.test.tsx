// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import Connect from '../src/rdc/components/Connect.jsx';
import Read from '../src/rdc/components/Read.jsx';
import { rateLimitError } from '../src/net/rateLimit.js';
import type { Rdc, Prompt } from '../src/rdc/wasm.js';

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
const readProps = (rdc: Rdc | null, over: any = {}) => ({
  rdc,
  rdcError: '',
  source,
  sourceToken: 'stok',
  domain: 'https://acme.rossum.app',
  token: 'ttok',
  organizations: async () => orgs,
  onDone: vi.fn(),
  onBack: vi.fn(),
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
    await flush();
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(project.addEnv).toHaveBeenCalledTimes(1);
    expect(project.sync.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['source', { noPush: true }],
      ['target', { noPush: true }],
    ]);
    expect(project.free).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('pull queues');
    act(() => byText('button', 'Plan the deployment').click());
    expect(props.onDone).toHaveBeenCalledWith({
      source: { queues: 1, schemas: 1, hooks: 1, rules: 0, labels: 0 },
      target: { queues: 0, schemas: 0, hooks: 2, rules: 0, labels: 0 },
    });
  });

  it('frees the project and offers Retry when a sync fails', async () => {
    let n = 0;
    const { rdc, project } = fakeRdc(async () => {
      if (++n === 2) throw new Error('boom');
      return outcome;
    });
    const props = readProps(rdc);
    mount(<Read {...props} />);
    await flush();
    await flush();
    expect(project.free).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('boom');
    expect(props.onDone).not.toHaveBeenCalled();
    act(() => byText('button', 'Retry').click());
    await flush();
    await flush();
    expect(project.free).toHaveBeenCalledTimes(2);
    expect(root.textContent).not.toContain('boom');
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
    mount(
      <Read
        {...readProps(rdc, { organizations: async () => ({ results: [{ id: 1 }, { id: 2 }] }) })}
      />,
    );
    await flush();
    expect(root.textContent).toContain('does not list exactly one organization');
    expect(create).not.toHaveBeenCalled();
  });

  it('shows a rate limit as such', async () => {
    const { rdc } = fakeRdc(async () => outcome);
    const limited = rateLimitError({ headers: { get: () => '7' } }, 'HTTP 429');
    mount(
      <Read
        {...readProps(rdc, {
          organizations: async () => {
            throw limited;
          },
        })}
      />,
    );
    await flush();
    expect(root.textContent).toContain('rate-limiting');
  });

  it('answers a pending prompt with null on unmount', async () => {
    const prompt: Prompt = { kind: 'k', question: 'Which?', choices: [{ key: 'a', label: 'A' }] };
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

  it('answers null to a prompt raised after unmount and skips the target', async () => {
    const prompt: Prompt = { kind: 'k', question: 'Which?', choices: [{ key: 'a', label: 'A' }] };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let late: Promise<string | null> | undefined;
    const { rdc, project } = fakeRdc(async (_e, _o, ask) => {
      await gate;
      late = ask(prompt);
      return outcome;
    });
    mount(<Read {...readProps(rdc)} />);
    await flush();
    act(() => void render(null, root));
    release();
    await flush();
    await flush();
    await expect(late).resolves.toBeNull();
    expect(project.sync).toHaveBeenCalledTimes(1);
    expect(project.free).toHaveBeenCalledTimes(1);
  });

  it('sends a chosen answer', async () => {
    const prompt: Prompt = { kind: 'k', question: 'Which?', choices: [{ key: 'a', label: 'A' }] };
    let answer: Promise<string | null> | undefined;
    const { rdc } = fakeRdc(async (_e, _o, ask) => {
      answer = ask(prompt);
      await answer;
      return outcome;
    });
    mount(<Read {...readProps(rdc)} />);
    await flush();
    act(() => byText('button', 'A').click());
    await expect(answer).resolves.toBe('a');
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
      <Connect source={source} fetchOrgs={fetchOrgs} onConnected={onConnected} onBack={vi.fn()} />,
    );
    await type('rdc-conn-token', ' tok ');
    act(() => byText('button', 'Check token').click());
    await flush();
    expect(fetchOrgs).toHaveBeenCalledWith(source.domain, 'tok');
    act(() => byText('button', 'Read both orgs').click());
    expect(onConnected).toHaveBeenCalledWith('tok');
    expect(root.querySelector('[role="note"]')).not.toBeNull();
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
      />,
    );
    await type('rdc-conn-token', 'tok');
    act(() => byText('button', 'Check token').click());
    await flush();
    expect(root.textContent).toContain('rate-limiting');
    expect(root.textContent).not.toContain('cannot read');
  });
});
