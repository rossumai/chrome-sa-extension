// @vitest-environment jsdom
// Where the "Experimental features unlocked / hidden" notice (5 clicks on the version hash)
// goes: never as a third item in the footer row, which wrapped the footer at 380px.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import App from '../src/popup/components/App.jsx';

async function waitFor(cond: () => unknown, timeout = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const CONSOLE_URL = 'chrome-extension://test-id/console/console.html';
let state: any;
let consoleApp: string;

beforeEach(() => {
  state = { usageAsked: true };
  consoleApp = '"rdc"';
  const view = {
    sessionStorage: {
      getItem: (k: string) =>
        ({ consoleToken: null, consoleDomain: null, consoleActiveApp: consoleApp })[k] ?? null,
    },
    CustomEvent,
    dispatchEvent: vi.fn(),
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({ ...state })),
        set: vi.fn(async (obj: any) => Object.assign(state, obj)),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
    } as any,
    tabs: { query: vi.fn(async () => []), reload: vi.fn() },
    extension: { getViews: vi.fn(() => [view]) },
    runtime: {
      getManifest: () => ({ version: '1.0', version_name: 'test' }),
      getURL: (p: string) => `chrome-extension://test-id/${p}`,
      sendMessage: vi.fn(),
    },
    scripting: {
      executeScript: vi.fn(async () => [
        { result: { token: null, domain: 'https://org.rossum.app', annotationId: null } },
      ]),
    },
  } as any;
  document.body.innerHTML = '';
});

afterEach(() => {
  render(null, document.body);
});

async function mountApp(url: string, seed: any = {}) {
  Object.assign(state, seed);
  render(<App tab={{ id: 1, index: 0, url }} />, document.body);
  await waitFor(() => document.body.querySelector('.version'));
}

function clickVersion() {
  const el = document.body.querySelector<HTMLElement>('.version')!;
  for (let i = 0; i < 5; i++) el.click();
}

const notice = () => document.body.querySelector('.unlock-notice');

describe('the unlock notice', () => {
  it('replaces the note line on an unrelated tab, never joining the footer', async () => {
    await mountApp('https://example.com/');
    clickVersion();
    await waitFor(notice);
    expect(document.body.querySelector('.footer .unlock-notice')).toBeNull();
    expect(document.body.querySelector('.offsite-note')).toBeNull();
    expect(notice()!.textContent).toContain('Experimental features unlocked');
    expect(notice()!.textContent).toContain('Academy, rdc added');
  });

  it("takes the footer's left group on a Rossum tab, keeping the footer two items wide", async () => {
    await mountApp('https://org.rossum.app/documents');
    clickVersion();
    await waitFor(notice);
    expect(document.body.querySelector('.footer-left .unlock-notice')).not.toBeNull();
    expect(document.body.querySelector('.footer')!.children).toHaveLength(2);
  });

  it('on the Console, replaces the app list label and marks the new apps', async () => {
    consoleApp = '"audit"';
    await mountApp(CONSOLE_URL);
    clickVersion();
    await waitFor(notice);
    expect(document.body.textContent).not.toContain('Switch app in this tab');
    const fresh = [...document.body.querySelectorAll('.console-app.is-new')];
    expect(fresh.map((r) => r.querySelector('.console-app-name')!.textContent)).toEqual([
      'Academy',
      'rdc',
    ]);
  });

  it('says the Console fell back to Data when hiding moved it off a gated app', async () => {
    await mountApp(CONSOLE_URL, { experimentalUnlocked: true });
    clickVersion();
    await waitFor(notice);
    expect(notice()!.textContent).toContain('Experimental features hidden');
    expect(notice()!.textContent).toContain('switched to Data');
  });

  it('does not, when the Console was on a public app', async () => {
    consoleApp = '"audit"';
    await mountApp(CONSOLE_URL, { experimentalUnlocked: true });
    clickVersion();
    await waitFor(notice);
    expect(notice()!.textContent).not.toContain('switched to Data');
  });
});
