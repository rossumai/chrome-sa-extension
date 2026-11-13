// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import ConsoleView, { ConsoleHeaderActions } from '../src/popup/components/ConsoleView.jsx';

async function waitFor(cond: () => unknown, timeout = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const DOMAIN = 'https://partner-sandbox.rossum.app';
let store: Map<string, string>;
let view: any;
let fetchMock: any;
let writeText: any;
let tabs: any[];

beforeEach(() => {
  store = new Map([
    ['consoleToken', 'tok-c'],
    ['consoleDomain', DOMAIN],
    ['consoleActiveApp', '"audit"'],
  ]);
  view = {
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null },
    CustomEvent: class {
      type: string;
      detail: unknown;
      constructor(type: string, init: any) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    dispatchEvent: vi.fn((_e: any) => true),
  };
  fetchMock = vi.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      results: [{ name: 'Example', id: 517920, sandbox: true, organization_group: null }],
    }),
  }));
  globalThis.fetch = fetchMock;
  writeText = vi.fn(async (_t: string) => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  vi.spyOn(window, 'close').mockImplementation(() => {});
  tabs = [];
  globalThis.chrome = {
    extension: { getViews: vi.fn((p: any) => (p.tabId === 7 ? [view] : [])) },
    tabs: {
      query: vi.fn(async () => tabs),
      create: vi.fn(async (_p: any) => ({})),
      update: vi.fn(async () => ({})),
    },
    windows: { update: vi.fn(async () => ({})) },
    runtime: { sendMessage: vi.fn(async (_m: any) => {}) },
  } as any;
  document.body.innerHTML = '';
});

afterEach(() => {
  render(null, document.body);
  vi.restoreAllMocks();
});

function mount(props: Partial<Parameters<typeof ConsoleView>[0]> = {}) {
  act(() => {
    render(
      <ConsoleView
        tabId={7}
        unlocked={false}
        orgNameEnabled={true}
        orgEnvEnabled={false}
        notice={null}
        {...props}
      />,
      document.body,
    );
  });
}

const rows = () => [...document.body.querySelectorAll<HTMLButtonElement>('.console-app')];

describe('ConsoleView — the app list', () => {
  it('lists the public apps in rail order, numbered, with their full names', () => {
    mount();
    expect(rows().map((r) => r.querySelector('.console-app-name')!.textContent)).toEqual([
      'Data',
      'Audit',
      'CIB',
      'Builder',
      'Inspector',
      'Fabry',
      'Galaxy',
    ]);
    expect(rows()[0].textContent).toContain('Dataset Management');
    expect(rows()[6].querySelector('.offsite-kbd')!.textContent).toBe('7');
    expect(document.body.textContent).toContain('Switch app in this tab');
  });

  it('adds Academy and rdc when unlocked', () => {
    mount({ unlocked: true });
    expect(rows()).toHaveLength(9);
    expect(rows()[8].textContent).toContain('Deployments between orgs');
  });

  it("marks the tab's current app", () => {
    mount();
    expect(rows()[1].classList.contains('is-current')).toBe(true);
    expect(rows()[1].textContent).toContain('here');
  });

  it('switches that Console tab on a click, and closes', () => {
    mount();
    rows()[6].click();
    expect(view.dispatchEvent.mock.calls[0][0].detail).toBe('galaxy');
    expect(window.close).toHaveBeenCalled();
  });

  it('switches with a digit', () => {
    mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(view.dispatchEvent.mock.calls[0][0].detail).toBe('builder');
  });

  it('only closes when the current app is picked', () => {
    mount();
    rows()[1].click();
    expect(view.dispatchEvent).not.toHaveBeenCalled();
    expect(window.close).toHaveBeenCalled();
  });
});

describe('ConsoleView — the connected organization', () => {
  it('names the organization once it is read with the Console session', async () => {
    mount();
    expect(document.body.querySelector('.console-org')!.textContent).toContain(
      'partner-sandbox.rossum.app',
    );
    await waitFor(() => document.body.textContent!.includes('Example'));
    expect(document.body.querySelector('.console-org')!.textContent).toContain('517920');
    expect(fetchMock.mock.calls[0][0]).toBe(`${DOMAIN}/api/v1/organizations`);
    expect(document.body.querySelector('.env-chip')).toBeNull();
  });

  it('adds the environment chip with Org env on', async () => {
    mount({ orgEnvEnabled: true });
    await waitFor(() => document.body.querySelector('.env-chip'));
    expect(document.body.querySelector('.env-chip')!.textContent).toBe('Sandbox');
  });

  it('reads nothing with Org info off, and shows the host', async () => {
    mount({ orgNameEnabled: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.querySelector('.console-org')!.textContent).toContain(
      'partner-sandbox.rossum.app',
    );
  });

  it('console view without a token', async () => {
    store.delete('consoleToken');
    store.delete('consoleActiveApp');
    mount();
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Example');
    rows()[2].click();
    expect(view.dispatchEvent.mock.calls[0][0].detail).toBe('cib');
  });
});

describe('ConsoleHeaderActions', () => {
  function mountHeader() {
    act(() => {
      render(<ConsoleHeaderActions tabId={7} />, document.body);
    });
  }
  const key = () => document.body.querySelector<HTMLButtonElement>('.token-btn')!;
  const rossum = () => document.body.querySelector<HTMLButtonElement>('.console-btn');

  it("copies the Console tab's token", async () => {
    mountHeader();
    key().click();
    await waitFor(() => writeText.mock.calls.length > 0);
    expect(writeText).toHaveBeenCalledWith('tok-c');
    await waitFor(() => key().classList.contains('copied'));
  });

  it('disables the key without a token', () => {
    store.delete('consoleToken');
    mountHeader();
    expect(key().disabled).toBe(true);
  });

  it("switches to the newest Rossum tab on the Console's organization", async () => {
    tabs = [
      { id: 1, windowId: 1, url: 'https://acme.rossum.app/documents', lastAccessed: 9 },
      { id: 2, windowId: 1, url: `${DOMAIN}/queues/1`, lastAccessed: 5 },
    ];
    mountHeader();
    rossum()!.click();
    await waitFor(() => vi.mocked(chrome.tabs.update).mock.calls.length > 0);
    expect(chrome.tabs.update).toHaveBeenCalledWith(2, { active: true });
  });

  it('opens the organization when no tab of it is open', async () => {
    tabs = [{ id: 1, windowId: 1, url: 'https://acme.rossum.app/documents' }];
    mountHeader();
    rossum()!.click();
    await waitFor(() => vi.mocked(chrome.tabs.create).mock.calls.length > 0);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: DOMAIN });
  });

  it('hides the Rossum tab button without a domain', () => {
    store.delete('consoleDomain');
    mountHeader();
    expect(rossum()).toBeNull();
  });
});
