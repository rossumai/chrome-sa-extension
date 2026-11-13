// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import App from '../src/popup/components/App.jsx';

async function waitFor(cond: any, timeout = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const TOKEN = 'b3f1c07e9d24a6158f0e7c3b2a19d48e6f5a9a2c';
let auth: any;
let writeText: any;

beforeEach(() => {
  auth = { token: TOKEN, domain: 'https://org.rossum.app' };
  writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({ usageAsked: true })),
        set: vi.fn(async () => {}),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
    } as any,
    tabs: { query: vi.fn(async () => []), reload: vi.fn() },
    runtime: {
      getManifest: () => ({ version: '1.0', version_name: 'test' }),
      getURL: (p: any) => `chrome-extension://test-id/${p}`,
      sendMessage: vi.fn(async (_msg: any) => {}),
    },
    // Every in-page reader gets `auth`; the MDH card sees no annotation and stays idle.
    scripting: {
      executeScript: vi.fn(async () => [{ result: auth && { ...auth, annotationId: null } }]),
    },
  } as any;
  document.body.innerHTML = '';
});

afterEach(() => {
  render(null, document.body);
});

async function mount(url = 'https://org.rossum.app/documents') {
  render(<App tab={{ id: 2, index: 0, url }} />, document.body);
  await waitFor(() => document.body.querySelector('.token-btn'));
  return document.body.querySelector<HTMLButtonElement>('.token-btn')!;
}

describe('copy API token', () => {
  it('copies the Rossum tab token and shows Copied', async () => {
    const btn = await mount();
    expect(btn.getAttribute('aria-label')).toBe('Copy API token');
    btn.click();
    await waitFor(() => btn.classList.contains('copied'));
    expect(writeText).toHaveBeenCalledWith(TOKEN);
    expect(btn.textContent).toContain('Copied');
  });

  it('records a name-only usage event, never the token', async () => {
    const btn = await mount();
    btn.click();
    await waitFor(() => btn.classList.contains('copied'));
    const sent = vi.mocked(chrome.runtime.sendMessage).mock.calls.map((c) => JSON.stringify(c));
    expect(sent.some((s) => s.includes('sa_popup_copy_token'))).toBe(true);
    expect(sent.some((s) => s.includes(TOKEN))).toBe(false);
  });

  it('asks to sign in when the tab has no token', async () => {
    auth = { token: null, domain: 'https://org.rossum.app' };
    const btn = await mount();
    btn.click();
    await waitFor(() => document.body.querySelector('.tool-notice'));
    expect(document.body.querySelector('.tool-notice')!.textContent).toContain('Sign in');
    expect(writeText).not.toHaveBeenCalled();
    expect(btn.classList.contains('copied')).toBe(false);
  });

  it('asks to reload when the tab cannot be read', async () => {
    auth = null;
    const btn = await mount();
    btn.click();
    await waitFor(() => document.body.querySelector('.tool-notice-action'));
    expect(document.body.querySelector('.tool-notice-action')!.textContent).toContain('Reload');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says so when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const btn = await mount();
    btn.click();
    await waitFor(() => document.body.querySelector('.tool-notice'));
    expect(document.body.querySelector('.tool-notice')!.textContent).toContain('clipboard');
    expect(btn.classList.contains('copied')).toBe(false);
  });

  it('is dimmed off Rossum', async () => {
    const btn = await mount('https://acme.app.netsuite.com/app/center/card.nl');
    expect(btn.classList.contains('dimmed')).toBe(true);
  });
});
