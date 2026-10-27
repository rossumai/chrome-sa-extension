// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import App from '../src/rdc/components/App.jsx';
import { WipStep } from '../src/rdc/components/WipSteps.jsx';
import { domain, token } from '../src/rdc/store.js';
import type { Rdc } from '../src/rdc/wasm.js';

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

// The session sees Acme; the source token sees Acme Test.
const fetchOrgs = vi.fn(async (d: string, _t: string) =>
  d === 'https://acme.rossum.app'
    ? { results: [{ id: 31007, name: 'Acme' }] }
    : { results: [{ id: 20412, name: 'Acme Test' }] },
);

let root: HTMLElement;
let chromeSet: ReturnType<typeof vi.fn>;
let sessionSet: ReturnType<typeof vi.spyOn>;
const mount = (el: any) => act(() => void render(el, root));
const flush = () => act(async () => {});
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
    mount(<App connected={false} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    expect(root.textContent).toContain('Not connected');
  });

  it('shows the overview for the connected org', async () => {
    mount(<App connected={true} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
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
    mount(<App connected={true} loadRdc={loadRdc} fetchOrgs={two} />);
    await flush();
    expect(root.textContent).toContain('does not list exactly one organization');
    expect(byText('button', 'Choose the org to deploy from')).toBeUndefined();
  });

  it('walks from choosing a source through the work-in-progress steps', async () => {
    mount(<App connected={true} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Deploy from test');
    expect(root.textContent).toContain('Acme deploys from');

    await click('button', 'Deploy from test');
    expect(root.textContent).toContain('Connect to test');
    expect(root.querySelector('[data-step="connect"]')!.getAttribute('data-state')).toBe('current');
    await type('rdc-conn-token', 'stok');
    await click('button', 'Check token');
    await click('button', 'Read both orgs');
    await flush();
    expect(root.textContent).toContain('Reading both orgs');
    expect(root.textContent).toContain('pulled');

    await click('button', 'Plan the deployment');
    expect(root.textContent).toContain('Plan what to bring');
    expect(root.textContent).toContain(
      'Not available yet. Planning needs rdc migrate in the browser build',
    );
    expect(root.textContent).toContain('rdc migrate source target');
    expect(root.textContent).toContain('rdc sync target --dry-run');
    expect(controls().length).toBeGreaterThan(0);
    controls().forEach((c) => expect(c.disabled).toBe(true));

    await click('button', 'Review the changes');
    expect(root.textContent).toContain('Review the changes to Acme');
    expect(root.textContent).toContain("Not available yet. Reviewing needs rdc's list");
    controls().forEach((c) => expect(c.disabled).toBe(true));

    await click('button', 'Continue to write');
    expect(root.textContent).toContain('Write to Acme');
    expect(
      root.querySelector<HTMLInputElement>('[aria-label="Type Acme to confirm"]')!.disabled,
    ).toBe(true);
    expect(byText('button', 'Write the changes to Acme').hasAttribute('disabled')).toBe(true);
    expect(byText('button', 'See the result').hasAttribute('disabled')).toBe(true);
    controls().forEach((c) => expect(c.disabled).toBe(true));

    expect(chromeSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    expect(root.textContent).not.toMatch(/\d+ changes/);
    expect(document.body.textContent).not.toContain('Deployed to');
  });

  it('goes back from Read to Connect', async () => {
    mount(<App connected={true} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Deploy from test');
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
    await click('button', 'Deploy from test');
    await click('button', 'Deploy from test');
    await type('rdc-conn-token', 'stok');
    await click('button', 'Check token');
    await click('button', 'Read both orgs');
    await flush();
    await click('button', 'Plan the deployment');
  }

  it('cancels from Plan to the overview without reading again', async () => {
    const { rdc, project } = fakeRdc();
    mount(<App connected={true} loadRdc={async () => rdc} fetchOrgs={fetchOrgs} />);
    await flush();
    await toPlan();
    expect(project.sync).toHaveBeenCalledTimes(2);
    await click('button', 'Cancel');
    expect(root.textContent).toContain('Acme deploys from');
    expect(project.sync).toHaveBeenCalledTimes(2);
  });

  it('goes back from Plan to the kept read, and reads again only on request', async () => {
    const { rdc, project } = fakeRdc();
    mount(<App connected={true} loadRdc={async () => rdc} fetchOrgs={fetchOrgs} />);
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
    mount(<App connected={true} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    await toPlan();
    for (const next of ['Review the changes', 'Continue to write']) {
      expect(byText('button', 'Cancel')).toBeDefined();
      await click('button', next);
    }
    await click('button', 'Cancel');
    expect(root.textContent).toContain('Acme deploys from');
    await click('button', 'Deploy from test');
    expect(byText('button', 'Cancel')).toBeDefined();
  });

  it('opens own values from the overview, with the work-in-progress note', async () => {
    mount(<App connected={true} loadRdc={loadRdc} fetchOrgs={fetchOrgs} />);
    await flush();
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Deploy from test');
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
    mount(<App connected={true} loadRdc={missing} fetchOrgs={fetchOrgs} />);
    await flush();
    expect(root.textContent).toContain('Bring tested configuration into Acme');
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Deploy from test');
    const deploy = byText('button', 'Deploy from test') as HTMLButtonElement;
    expect(deploy.disabled).toBe(true);
    expect(deploy.title).toContain('rdc_wasm.js is not in this build');
    expect(root.textContent).toContain('rdc_wasm.js is not in this build');
  });

  it('disables Read both orgs on Connect when rdc is not in the build', async () => {
    let fail!: (e: Error) => void;
    const loading = new Promise<Rdc>((_r, rej) => (fail = rej));
    mount(<App connected={true} loadRdc={() => loading} fetchOrgs={fetchOrgs} />);
    await flush();
    await click('button', 'Choose the org to deploy from');
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'stok');
    await click('button', 'Find organizations');
    await click('button', 'Deploy from test');
    // still loading: blocked with the loading text
    expect((byText('button', 'Deploy from test') as HTMLButtonElement).disabled).toBe(true);
    act(() => fail(new Error('gone')));
    await flush();
    expect((byText('button', 'Deploy from test') as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks GET /organizations once for the connected org across a whole read', async () => {
    const { rdc } = fakeRdc();
    const f = vi.fn(fetchOrgs);
    mount(<App connected={true} loadRdc={async () => rdc} fetchOrgs={f} />);
    await flush();
    await toPlan();
    const forTarget = f.mock.calls.filter(([d]) => d === 'https://acme.rossum.app');
    expect(forTarget).toHaveLength(1);
  });

  it('previews Done without claiming a deployment', () => {
    mount(<WipStep step="done" sourceName="test" targetName="Acme" onBack={vi.fn()} />);
    expect(root.querySelector('h1')!.textContent).toBe('After the deployment');
    expect(root.textContent).toContain('Not available yet. Nothing can be written to this org');
    expect(root.textContent).not.toContain('Deployed to');
    expect(root.textContent).not.toMatch(/\d/);
  });
});
