// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import OffSite from '../src/popup/components/OffSite.jsx';

async function waitFor(cond: () => unknown, timeout = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const NOW = Date.now();
const entry = (name: string, id: number, sandbox: boolean, at = NOW) =>
  JSON.stringify({
    at,
    located: true,
    org: { name, id, sandbox, groupPath: null, location: null },
  });

const TABS: any[] = [
  {
    id: 11,
    index: 3,
    windowId: 5,
    url: 'https://acme.rossum.app/document/9104377',
    title: 'Rossum',
  },
  {
    id: 12,
    index: 4,
    windowId: 5,
    url: 'https://acme.rossum.app/queues/3311/all',
    title: 'Rossum',
  },
  {
    id: 13,
    index: 0,
    windowId: 6,
    url: 'https://partner-sandbox.rossum.app/settings',
    title: 'Rossum',
  },
];

// What each tab answers to an injected reader: its org cache, or its session.
let caches: Record<number, string | null>;
let writeText: any;

beforeEach(() => {
  caches = {
    11: entry('Acme Corp', 482113, false),
    12: entry('Acme Corp', 482113, false),
    13: null,
  };
  writeText = vi.fn(async (_t: string) => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  vi.spyOn(window, 'close').mockImplementation(() => {});
  globalThis.chrome = {
    storage: { local: { set: vi.fn((_v: any, cb?: () => void) => cb?.()) } },
    tabs: { create: vi.fn(async (_p: any) => ({})), update: vi.fn(async () => ({})) },
    windows: { update: vi.fn(async () => ({})) },
    runtime: {
      getURL: (p: string) => `chrome-extension://test-id/${p}`,
      sendMessage: vi.fn(async (_m: any) => {}),
    },
    scripting: {
      executeScript: vi.fn(async ({ target, func }: any) => [
        {
          result:
            func.name === 'readOrgCache'
              ? caches[target.tabId]
              : { token: `tok-${target.tabId}`, domain: 'https://acme.rossum.app' },
        },
      ]),
    },
  } as any;
  document.body.innerHTML = '';
});

afterEach(() => {
  render(null, document.body);
  vi.restoreAllMocks();
});

// Inside act() so effects (the key listener) have run when mount returns.
function mount(props: Partial<Parameters<typeof OffSite>[0]> = {}) {
  act(() => {
    render(
      <OffSite
        tabs={TABS}
        viewed={[]}
        orgNameEnabled={true}
        orgEnvEnabled={false}
        notice={null}
        {...props}
      />,
      document.body,
    );
  });
}

const rows = () => [...document.body.querySelectorAll('.offsite-row')];

describe('OffSite — Rossum tabs open', () => {
  it('says there is nothing to do here, without the old warning', () => {
    mount();
    expect(document.body.textContent).toContain(
      'Nothing to do on this tab. Jump to an open Rossum tab:',
    );
    expect(document.body.textContent).not.toContain("isn't supported");
    expect(document.body.textContent).not.toContain('Works on Rossum');
  });

  it("names each tab by its organization, from the tab's org cache", async () => {
    mount();
    await waitFor(() => rows()[0].textContent!.includes('Acme Corp'));
    expect(rows()[0].textContent).toContain('482113');
    expect(document.body.querySelector('.env-chip')).toBeNull();
  });

  it('shows the environment chip only when Org env is on', async () => {
    mount({ orgEnvEnabled: true });
    await waitFor(() => document.body.querySelector('.env-chip'));
    expect(document.body.querySelector('.env-chip')!.textContent).toBe('Production');
  });

  it('falls back to the title on an expired cache', async () => {
    caches[11] = entry('Acme Corp', 482113, false, NOW - 25 * 3600e3);
    mount();
    await waitFor(() => rows()[1].textContent!.includes('Acme Corp'));
    expect(rows()[0].textContent).not.toContain('Acme Corp');
    expect(rows()[0].querySelector('.offsite-title')!.textContent).toContain('Rossum');
  });

  it('falls back to the title with Org info off', async () => {
    mount({ orgNameEnabled: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(document.body.textContent).not.toContain('Acme Corp');
  });

  it('says where each tab is, and its host', () => {
    mount();
    expect(rows()[0].textContent).toContain('Document 9104377');
    expect(rows()[0].textContent).toContain('acme.rossum.app');
    expect(rows()[1].textContent).toContain('Queue 3311');
  });

  it("opens the Console for a row's session, in that row's window", async () => {
    mount();
    rows()[2].querySelector<HTMLButtonElement>('.offsite-console')!.click();
    await waitFor(() => vi.mocked(chrome.tabs.create).mock.calls.length > 0);
    expect(vi.mocked(chrome.tabs.create).mock.calls[0][0]).toMatchObject({ index: 1, windowId: 6 });
  });

  it("copies that row's token", async () => {
    mount();
    rows()[1].querySelector<HTMLButtonElement>('.offsite-token')!.click();
    await waitFor(() => writeText.mock.calls.length > 0);
    expect(writeText).toHaveBeenCalledWith('tok-12');
  });

  it('switches with a digit, and with Enter to the first row', async () => {
    mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    await waitFor(() => vi.mocked(chrome.tabs.update).mock.calls.length > 0);
    expect(chrome.tabs.update).toHaveBeenCalledWith(12, { active: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await waitFor(() => vi.mocked(chrome.tabs.update).mock.calls.length > 1);
    expect(chrome.tabs.update).toHaveBeenLastCalledWith(11, { active: true });
  });
});

describe('OffSite — before the tab query resolves', () => {
  it('shows nothing, rather than a list that is about to change', () => {
    mount({ tabs: null, viewed: [{ id: '1', origin: 'https://acme.rossum.app', at: NOW }] });
    expect(document.body.textContent).toBe('');
  });
});

describe('OffSite — no Rossum tab', () => {
  const viewed = [
    { id: '1', origin: 'https://acme.rossum.app', at: NOW - 2 * 3600e3 },
    { id: '2', origin: 'https://partner-sandbox.rossum.app', at: NOW - 30 * 3600e3 },
    { id: '3', origin: 'https://acme.rossum.app', at: NOW - 40 * 3600e3 },
  ];

  it('lists the recent organizations, newest first, and opens one in a new tab', async () => {
    mount({ tabs: [], viewed });
    expect(document.body.textContent).toContain(
      'No Rossum tab is open. Pick up where you left off:',
    );
    expect(rows().map((r) => r.querySelector('.offsite-title')!.textContent)).toEqual([
      'acme.rossum.app',
      'partner-sandbox.rossum.app',
    ]);
    expect(rows()[1].textContent).toContain('yesterday');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    await waitFor(() => vi.mocked(chrome.tabs.create).mock.calls.length > 0);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://partner-sandbox.rossum.app' });
  });

  it('keeps the NetSuite and Coupa line', () => {
    mount({ tabs: [], viewed: [] });
    expect(document.body.textContent).toContain('Also works on NetSuite and Coupa.');
    expect(rows()).toHaveLength(0);
  });
});
