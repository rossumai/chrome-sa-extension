// The popup on a tab the extension does nothing on — usually opened by mistake. One quiet
// line, then the way out: the open Rossum tabs (each named by its organization, with the
// Console and its token one click away), or, with none open, the organizations the user
// recently visited. Enter and 1-9 pick a row, Escape closes. The Console tab has its own
// view (ConsoleView.tsx).
import { h, Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { activateTab, openConsoleTab, runInTab } from '../utils.js';
import { readAuthInfo, readOrgCache } from '../tab-readers.js';
import { cachedOrg, ORG_CACHE_PREFIX, type Org } from '../../rossum/orgName.js';
import { track } from '../../usage/track.js';
import {
  hostOf,
  recentOrigins,
  relativeTime,
  rowForKey,
  tabPlace,
  type UnlockNotice,
} from '../offSite.js';
import { CheckIcon, ExternalIconSmall, InfoIcon, KeyIcon } from './icons.jsx';
import NoticeLine from './NoticeLine.jsx';

type Props = {
  tabs: chrome.tabs.Tab[] | null;
  viewed: unknown;
  orgNameEnabled: boolean;
  orgEnvEnabled: boolean;
  notice: UnlockNotice | null;
};

type RowError = { kind: 'reload' | 'login' | 'clipboard'; tab: chrome.tabs.Tab };

export function EnvChip({ org }: { org: Org }) {
  return (
    <span class={`env-chip ${org.sandbox ? 'env-chip-sandbox' : 'env-chip-production'}`}>
      {org.sandbox ? 'Sandbox' : 'Production'}
    </span>
  );
}

// `onPick` runs for a row picked by its key; the effect owns the listener, so a re-render
// with a new list re-binds it.
export function useRowKeys(count: number, onPick: (row: number) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return window.close();
      const row = rowForKey(e, count);
      if (row === null) return;
      e.preventDefault();
      onPick(row);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [count, onPick]);
}

export default function OffSite({ tabs, viewed, orgNameEnabled, orgEnvEnabled, notice }: Props) {
  const open = Array.isArray(tabs) ? tabs : [];
  // Until the tab query resolves (tabs === null) neither list is known: render nothing
  // rather than "No Rossum tab is open." for a moment, with keys bound to the wrong list.
  const known = tabs !== null;
  const recent = open.length ? [] : recentOrigins(viewed);
  const onPick = (row: number) => {
    if (open.length) activateTab(open[row]);
    else openOrigin(recent[row].origin);
  };
  useRowKeys(known ? open.length || recent.length : 0, onPick);
  if (!known) return null;

  const lead = open.length
    ? 'Nothing to do on this tab. Jump to an open Rossum tab:'
    : recent.length
      ? 'No Rossum tab is open. Pick up where you left off:'
      : 'No Rossum tab is open.';

  return (
    <div class="offsite">
      <NoticeLine notice={notice}>
        <p class="offsite-note">
          <InfoIcon />
          {lead}
        </p>
      </NoticeLine>
      {open.length ? (
        <OpenTabs tabs={open} orgNameEnabled={orgNameEnabled} orgEnvEnabled={orgEnvEnabled} />
      ) : recent.length ? (
        <section class="offsite-section">
          <h3 class="offsite-label">Recent organizations</h3>
          <ul class="offsite-list">
            {recent.map((r, i) => (
              <li class={`offsite-row${i === 0 ? ' is-first' : ''}`}>
                <button class="offsite-row-main" onClick={() => openOrigin(r.origin)}>
                  <span class="offsite-kbd">{i + 1}</span>
                  <span class="offsite-text">
                    <span class="offsite-title">{hostOf(r.origin)}</span>
                  </span>
                  <span class="offsite-ago">{relativeTime(r.at, Date.now())}</span>
                  <span class="offsite-act" aria-hidden="true">
                    Open <ExternalIconSmall />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {open.length ? null : <p class="offsite-foot">Also works on NetSuite and Coupa.</p>}
    </div>
  );
}

function openOrigin(origin: string) {
  chrome.tabs.create({ url: origin });
  window.close();
}

function OpenTabs({
  tabs,
  orgNameEnabled,
  orgEnvEnabled,
}: {
  tabs: chrome.tabs.Tab[];
  orgNameEnabled: boolean;
  orgEnvEnabled: boolean;
}) {
  // Each tab's organization, from the org-name feature's cache in that tab. A tab without
  // one (feature off, never loaded, expired) keeps its title.
  const [orgs, setOrgs] = useState<Record<number, Org | null>>({});
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState<RowError | null>(null);
  const showOrgs = orgNameEnabled || orgEnvEnabled;

  useEffect(() => {
    if (!showOrgs) return;
    let live = true;
    for (const t of tabs) {
      runInTab(t.id as number, readOrgCache, [ORG_CACHE_PREFIX]).then((raw) => {
        if (live) setOrgs((prev) => ({ ...prev, [t.id as number]: cachedOrg(raw, Date.now()) }));
      });
    }
    return () => {
      live = false;
    };
  }, [tabs, showOrgs]);

  // The row's own session, read in that tab — the same reader as the header's buttons.
  const withAuth = async (t: chrome.tabs.Tab, use: (auth: any) => void) => {
    setError(null);
    const auth = await runInTab(t.id as number, readAuthInfo);
    if (!auth) return setError({ kind: 'reload', tab: t });
    if (!auth.token || !auth.domain) return setError({ kind: 'login', tab: t });
    use(auth);
  };
  const onConsole = (t: chrome.tabs.Tab) =>
    withAuth(t, (auth) => {
      openConsoleTab(t as { index: number; windowId?: number }, auth, 'mdh');
      window.close();
    });
  const onToken = (t: chrome.tabs.Tab) =>
    withAuth(t, async (auth) => {
      try {
        await navigator.clipboard.writeText(auth.token);
      } catch {
        return setError({ kind: 'clipboard', tab: t });
      }
      track('sa_popup_copy_token');
      setCopied(t.id as number);
      setTimeout(() => setCopied(null), 1600);
    });

  return (
    <Fragment>
      <section class="offsite-section">
        <h3 class="offsite-label">
          Open Rossum tabs <span>most recent first</span>
        </h3>
        <ul class="offsite-list">
          {tabs.map((t, i) => {
            const org = orgs[t.id as number] ?? null;
            const host = hostOf(t.url || '');
            const place = tabPlace(t.url || '');
            const named = org && orgNameEnabled;
            return (
              <li class={`offsite-row${i === 0 ? ' is-first' : ''}`}>
                <button class="offsite-row-main" onClick={() => activateTab(t)} title={t.url}>
                  <span class="offsite-kbd">{i + 1}</span>
                  <span class="offsite-text">
                    <span class="offsite-title">
                      {named ? org.name : t.title || host}
                      {named && org.id !== null ? <span class="offsite-id">{org.id}</span> : null}
                      {org && orgEnvEnabled ? <EnvChip org={org} /> : null}
                    </span>
                    <span class="offsite-meta">
                      {place ? <b>{place}</b> : null}
                      {place ? ' · ' : null}
                      {host}
                    </span>
                  </span>
                </button>
                <span class="offsite-actions">
                  <button
                    class="offsite-act offsite-console"
                    onClick={() => onConsole(t)}
                    title="Open the Console on this organization"
                  >
                    Console
                  </button>
                  <button
                    class={`offsite-act offsite-icon offsite-token${copied === t.id ? ' copied' : ''}`}
                    onClick={() => onToken(t)}
                    aria-label="Copy API token"
                    title={copied === t.id ? 'Copied' : 'Copy API token'}
                  >
                    {copied === t.id ? <CheckIcon /> : <KeyIcon />}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <div class="offsite-hint">
        <span>
          <kbd>↵</kbd> switch to 1
        </span>
        <span>
          <kbd>1</kbd>–<kbd>{Math.min(tabs.length, 9)}</kbd> switch
        </span>
        <span>
          <kbd>esc</kbd> close
        </span>
      </div>
      {error ? <RowNotice error={error} /> : null}
    </Fragment>
  );
}

// The header's notices, worded the same, for the row whose session was read.
function RowNotice({ error }: { error: RowError }) {
  if (error.kind === 'reload') {
    return (
      <div class="tool-notice offsite-notice" role="alert">
        <span class="tool-notice-msg">
          Reload the Rossum tab — the extension was updated and lost its connection.
        </span>
        <button
          class="tool-notice-action"
          onClick={() => {
            chrome.tabs.reload(error.tab.id as number);
            window.close();
          }}
        >
          Reload tab
        </button>
      </div>
    );
  }
  return (
    <div class="tool-notice offsite-notice" role="alert">
      <span class="tool-notice-msg">
        {error.kind === 'clipboard'
          ? 'Could not copy to the clipboard. Click the key again.'
          : 'Sign in to Rossum in this tab first.'}
      </span>
    </div>
  );
}
