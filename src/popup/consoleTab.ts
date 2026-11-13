// The popup's way into a Console tab. The Console is an extension page of this extension,
// so chrome.extension.getViews hands the popup its very `window` (proven in Chrome for
// Testing 150, 2026-11-13): the popup reads the tab's session from its sessionStorage and
// asks it to switch app with an event its boot() listens for. Not available to the service
// worker, and not in jsdom; any failure reads as "no Console view".
import { isValidApp, SET_APP_EVENT, type AppId } from '../console/boot.js';

export type ConsoleTabState = { token: string | null; domain: string | null; app: AppId | null };

function viewOf(tabId: number): Window | null {
  try {
    return chrome.extension?.getViews?.({ type: 'tab', tabId })[0] ?? null;
  } catch {
    return null;
  }
}

export function readConsoleTab(tabId: number): ConsoleTabState | null {
  const view = viewOf(tabId);
  if (!view) return null;
  try {
    const store = view.sessionStorage;
    return {
      token: store.getItem('consoleToken'),
      domain: store.getItem('consoleDomain'),
      // JSON-encoded by writeTabState; only written once the Console has credentials.
      app: parseApp(store.getItem('consoleActiveApp')),
    };
  } catch {
    return null;
  }
}

function parseApp(raw: string | null): AppId | null {
  try {
    const app = raw === null ? null : JSON.parse(raw);
    return isValidApp(app) ? app : null;
  } catch {
    return null;
  }
}

// The event is built with the VIEW's CustomEvent, so it belongs to the Console's realm.
export function setConsoleApp(tabId: number, app: AppId): boolean {
  const view = viewOf(tabId) as (Window & typeof globalThis) | null;
  if (!view) return false;
  try {
    view.dispatchEvent(new view.CustomEvent(SET_APP_EVENT, { detail: app }));
    return true;
  } catch {
    return false;
  }
}
