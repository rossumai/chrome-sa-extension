// The popup on a Console tab: which organization THIS tab is connected to, and its apps
// as a numbered list in the rail's order (keys 1-9 match the rail top to bottom), which
// switches this tab. The header's token and "Rossum tab" buttons are ConsoleHeaderActions.
// The tab's session and app are read through consoleTab.ts.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { visibleApps } from '../../console/apps.jsx';
import { loadOrg } from '../../rossum/orgSource.js';
import type { Org } from '../../rossum/orgName.js';
import { track } from '../../usage/track.js';
import { fetchJson } from '../mdh-provenance.js';
import { activateTab, findRossumTabs } from '../utils.js';
import { readConsoleTab, setConsoleApp } from '../consoleTab.js';
import { hostOf, type UnlockNotice } from '../offSite.js';
import { CheckIcon, ExternalIcon, KeyIcon } from './icons.jsx';
import { EnvChip, useRowKeys } from './OffSite.jsx';
import NoticeLine from './NoticeLine.jsx';

type Props = {
  tabId: number;
  unlocked: boolean;
  orgNameEnabled: boolean;
  orgEnvEnabled: boolean;
  notice: UnlockNotice | null;
};

export default function ConsoleView({
  tabId,
  unlocked,
  orgNameEnabled,
  orgEnvEnabled,
  notice,
}: Props) {
  const [state] = useState(() => readConsoleTab(tabId));
  const [org, setOrg] = useState<Org | null>(null);
  const apps = visibleApps(unlocked);

  // The Console's organization, by the loader the header and the Console share, with the
  // Console's own session. Not cached, as the Console's own load is not.
  useEffect(() => {
    const { token, domain } = state ?? {};
    if (!token || !domain || !(orgNameEnabled || orgEnvEnabled)) return;
    let live = true;
    loadOrg({
      get: (path) => fetchJson(domain + path, token),
      withLocation: true,
      show: (o) => {
        if (!live) return false;
        setOrg(o);
      },
    });
    return () => {
      live = false;
    };
  }, [state, orgNameEnabled, orgEnvEnabled]);

  const pick = (row: number) => {
    const app = apps[row];
    if (app.id !== state?.app) setConsoleApp(tabId, app.id);
    window.close();
  };
  useRowKeys(apps.length, pick);

  const host = hostOf(state?.domain || '');
  const named = org && orgNameEnabled;
  return (
    <div class="offsite">
      {state?.domain ? (
        <div class={`console-org${org?.sandbox ? ' is-sandbox' : ''}`}>
          <span class="offsite-title">
            {named ? org.name : host}
            {named && org.id !== null ? <span class="offsite-id">{org.id}</span> : null}
            {org && orgEnvEnabled ? <EnvChip org={org} /> : null}
          </span>
          {named ? (
            <span class="offsite-meta">
              This Console is connected to <b>{host}</b>
              {org.location ? ` · ${org.location}` : null}
            </span>
          ) : null}
        </div>
      ) : null}
      <section class="offsite-section">
        <NoticeLine notice={notice}>
          <h3 class="offsite-label">Switch app in this tab</h3>
        </NoticeLine>
        <ul class="console-apps">
          {apps.map((a, i) => (
            <li>
              <button
                class={`console-app${a.id === state?.app ? ' is-current' : ''}${notice?.unlocked && a.gated ? ' is-new' : ''}`}
                onClick={() => pick(i)}
                title={a.title}
              >
                <span class="offsite-kbd">{i + 1}</span>
                <span class="console-app-icon">{a.icon}</span>
                <span class="console-app-name">{a.label}</span>
                <span class="console-app-desc">{a.description}</span>
                {a.beta ? <span class="console-app-badge">beta</span> : null}
                {a.exp ? <span class="console-app-badge is-exp">exp</span> : null}
                {a.id === state?.app ? <span class="console-app-here">here</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// The header's buttons on a Console tab: copy THIS tab's token, and go to its organization
// in Rossum — the newest open tab on it, else a new one.
export function ConsoleHeaderActions({ tabId }: { tabId: number }) {
  const [state] = useState(() => readConsoleTab(tabId));
  const [copied, setCopied] = useState(false);
  const token = state?.token;
  const domain = state?.domain;

  const onCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      return;
    }
    track('sa_popup_copy_token');
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const onRossum = async () => {
    if (!domain) return;
    const open = (await findRossumTabs()).find((t) => originOf(t.url) === domain);
    if (open) return activateTab(open);
    chrome.tabs.create({ url: domain });
    window.close();
  };

  return (
    <div class="header-actions">
      <button
        class={`token-btn${copied ? ' copied' : ''}`}
        onClick={onCopy}
        disabled={!token}
        aria-label="Copy API token"
      >
        {copied ? <CheckIcon /> : <KeyIcon />}
        <span class="token-tip" role="status">
          {copied ? 'Copied' : token ? 'Copy API token' : 'This Console is not connected'}
        </span>
      </button>
      {domain ? (
        <button class="console-btn" onClick={onRossum} title={`Open ${hostOf(domain)}`}>
          <span>Rossum tab</span>
          <ExternalIcon />
        </button>
      ) : null}
    </div>
  );
}

function originOf(url: string | undefined): string | null {
  try {
    return new URL(url as string).origin;
  } catch {
    return null;
  }
}
