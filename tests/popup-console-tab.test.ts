import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readConsoleTab, setConsoleApp } from '../src/popup/consoleTab.js';

class FakeEvent {
  type: string;
  detail: unknown;
  constructor(type: string, init: { detail: unknown }) {
    this.type = type;
    this.detail = init.detail;
  }
}

let store: Map<string, string>;
let view: any;
let getViews: any;

beforeEach(() => {
  store = new Map([
    ['consoleToken', 'tok'],
    ['consoleDomain', 'https://acme.rossum.app'],
    ['consoleActiveApp', '"audit"'],
  ]);
  view = {
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null },
    CustomEvent: FakeEvent,
    dispatchEvent: vi.fn((_e: any) => true),
  };
  getViews = vi.fn((props: { tabId?: number }) => (props.tabId === 7 ? [view] : []));
  globalThis.chrome = { extension: { getViews } } as any;
});

describe('readConsoleTab', () => {
  it('reads the view for the given tab id', () => {
    expect(readConsoleTab(7)).toEqual({
      token: 'tok',
      domain: 'https://acme.rossum.app',
      app: 'audit',
    });
    expect(getViews).toHaveBeenCalledWith({ type: 'tab', tabId: 7 });
    expect(readConsoleTab(8)).toBeNull();
  });

  it('reads an unknown or absent app as none', () => {
    store.set('consoleActiveApp', 'garbage');
    expect(readConsoleTab(7)!.app).toBeNull();
    store.delete('consoleActiveApp');
    expect(readConsoleTab(7)!.app).toBeNull();
  });

  it('reads a throwing getViews as no view', () => {
    getViews.mockImplementation(() => {
      throw new Error('no');
    });
    expect(readConsoleTab(7)).toBeNull();
  });
});

describe('setConsoleApp', () => {
  it("dispatches the switch on that tab's window", () => {
    expect(setConsoleApp(7, 'galaxy')).toBe(true);
    const event = view.dispatchEvent.mock.calls[0][0];
    expect(event.type).toBe('sa-console-set-app');
    expect(event.detail).toBe('galaxy');
  });

  it('reports false without a view', () => {
    expect(setConsoleApp(8, 'galaxy')).toBe(false);
    getViews.mockImplementation(() => {
      throw new Error('no');
    });
    expect(setConsoleApp(7, 'galaxy')).toBe(false);
  });
});
