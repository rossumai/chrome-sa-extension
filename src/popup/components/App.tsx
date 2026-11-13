import { h, Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import Toggle from './Toggle.jsx';
import MdhProvenancePanel from './MdhProvenancePanel.jsx';
import ReviewingLockBanner from './ReviewingLockBanner.jsx';
import UsageStrip, { UsageFooterButton, stripVisible } from './UsageStrip.jsx';
import { track } from '../../usage/track.js';
import { writeConsent } from '../usageConsent.js';
import { openConsoleTab, runInTab, detectSite, findRossumTabs, isConsoleTab } from '../utils.js';
import { readAuthInfo, readPageFlag, togglePageFlag } from '../tab-readers.js';
import { createUnlockCounter } from '../experimental.js';
import { ExternalIcon, ExternalIconSmall, KeyIcon, CheckIcon } from './icons.jsx';
import { openPanelForTab } from '../../sidepanel/panelScope.js';
import { ORG_NAME_KEY, orgNameOn } from '../../rossum/orgName.js';
import { VIEWED_KEY } from '../../inspector/viewed.js';
import OffSite from './OffSite.jsx';
import ConsoleView, { ConsoleHeaderActions } from './ConsoleView.jsx';
import { UnlockNoticeText } from './NoticeLine.jsx';
import { readConsoleTab } from '../consoleTab.js';
import type { UnlockNotice } from '../offSite.js';

const STORAGE_TOGGLES = [
  'schemaAnnotationsEnabled',
  'resourceIdsEnabled',
  'orgNameEnabled',
  'orgEnvEnabled',
  'expandFormulasEnabled',
  'expandReasoningFieldsEnabled',
  'scrollLockEnabled',
  'netsuiteFieldNamesEnabled',
  'coupaFieldNamesEnabled',
  // Not a toggle shown anywhere: the hidden-features gate (5 clicks on the
  // version hash). Loaded with the rest so the click handler can toggle it.
  'experimentalUnlocked',
];

// Each id is both the React state key and the page-side localStorage key.
const PAGE_FLAG_TOGGLES = ['devFeaturesEnabled', 'devDebugEnabled'];

// Chrome Web Store "Support" tab for this extension. The item id matches the
// install link in README.md.
const SUPPORT_URL =
  'https://chromewebstore.google.com/detail/bljkbinljmhdbipklfcljongikhmnneh/support';

function combineUrlWithCustomPath(originalUrl: any, customPath: any) {
  const match = originalUrl.match(/^https?:\/\/[^/?#]+/);
  if (!match) return originalUrl;
  const normalizedPath = customPath.startsWith('/') ? customPath : `/${customPath}`;
  return match[0] + normalizedPath;
}

export default function App({ tab }: { tab?: any }) {
  const site = detectSite(tab?.url || '');
  const isConsole = !site && isConsoleTab(tab?.url || '');
  const version = chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version;

  const [storageValues, setStorageValues] = useState<any>(null);
  const [messageValues, setMessageValues] = useState<Record<string, any>>({
    devFeaturesEnabled: false,
    devDebugEnabled: false,
  });
  const [authError, setAuthError] = useState<{ kind: string } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [rossumTabs, setRossumTabs] = useState<any>(null);
  const [unlockNotice, setUnlockNotice] = useState<UnlockNotice | null>(null);
  const [unlockCounter] = useState(() => createUnlockCounter());
  // Read on its own, NOT via STORAGE_TOGGLES: that loop coerces with !!, which
  // would turn "never answered" into "declined" for every existing install.
  // Three-valued, plus `undefined` for "storage hasn't resolved yet".
  const [consent, setConsent] = useState<boolean | null | undefined>(undefined);
  // Has the overlay ever been shown? Separate from consent so the ask appears
  // exactly ONCE; `undefined` until storage resolves, which is what keeps the
  // overlay from flashing on every popup open.
  const [asked, setAsked] = useState<boolean | undefined>(undefined);
  // Reopened-from-the-footer state. Never persisted: it is a view mode, not a
  // preference.
  const [reviewingUsage, setReviewingUsage] = useState(false);
  // Deliberately WITHOUT `reviewing`: this is "the first ask is on screen", not
  // "the surface is on screen". A footer reopen must not look like a fresh ask.
  const askOnScreen = stripVisible({ consent });

  // Persist "asked" only once the ask has actually PAINTED. Writing it in the
  // storage callback meant a popup dismissed within that tick consumed the single
  // automatic ask without ever showing it — and it never returns.
  //
  // Since 2026-08-19 this no longer gates the ask itself (the strip keys on
  // `consent`, so it persists until answered). It is kept because it is what
  // makes the footer control reachable, and its meaning — "the ask has been
  // shown" — is unchanged.
  // `asked === false` is load-bearing, not defensive: the strip stays on screen
  // for every open until it is answered, so without it this would re-write the
  // flag on each one. undefined = storage unresolved, true = already recorded.
  useEffect(() => {
    if (!askOnScreen || asked !== false) return;
    Promise.resolve(chrome.storage.local.set({ usageAsked: true })).catch(() => {});
  }, [askOnScreen, asked]);

  // Off Rossum, NetSuite and Coupa only: the open Rossum tabs, and the recently viewed
  // annotations' organizations for when none is open.
  const [viewed, setViewed] = useState<unknown>(null);
  useEffect(() => {
    if (site) return;
    findRossumTabs().then(setRossumTabs);
    Promise.resolve(chrome.storage.local.get([VIEWED_KEY]))
      .then((vals) => setViewed(vals?.[VIEWED_KEY]))
      .catch(() => {});
  }, [site]);

  useEffect(() => {
    chrome.storage.local
      .get(STORAGE_TOGGLES)
      .then((vals) => {
        const filled: Record<string, boolean> = {};
        for (const key of STORAGE_TOGGLES) {
          filled[key] = key === ORG_NAME_KEY ? orgNameOn(vals[key]) : !!vals[key];
        }
        setStorageValues(filled);
      })
      .catch(() => {
        // Also gates first paint — degrade to the defaults rather than a blank popup.
        const filled: Record<string, boolean> = {};
        for (const key of STORAGE_TOGGLES)
          filled[key] = key === ORG_NAME_KEY && orgNameOn(undefined);
        setStorageValues(filled);
      });
  }, []);

  useEffect(() => {
    chrome.storage.local
      .get(['usageConsent', 'usageAsked'])
      .then((vals) => {
        if (vals.usageConsent === true) setConsent(true);
        else if (vals.usageConsent === false) setConsent(false);
        else setConsent(null);
        setAsked(vals.usageAsked === true);
      })
      .catch(() => {
        // This read gates first paint, so a rejection must never leave the popup
        // blank: fall back to "not consented, don't ask" — the footer control is
        // still rendered, so usage data remains reachable.
        setConsent(null);
        setAsked(true);
      });
    track('sa_popup_open');
  }, []);

  useEffect(() => {
    if (!site) return;
    for (const key of PAGE_FLAG_TOGGLES) {
      runInTab(tab.id, readPageFlag, [key]).then((val) => {
        setMessageValues((prev) => ({ ...prev, [key]: !!val }));
      });
    }
  }, [site]);

  const showMdhPanel = site === 'rossum';
  useEffect(() => {
    document.body.classList.toggle('popup-wide', showMdhPanel);
  }, [showMdhPanel]);

  // Written straight to storage, NOT via the worker: the popup can be destroyed
  // immediately after this click, and a message needs the worker to wake first
  // (measured ~50ms, during which a reopened popup read "off").
  const onUsageAnswer = (value: any) => {
    setConsent(value);
    setAsked(true);
    setReviewingUsage(false);
    Promise.resolve(writeConsent(value)).catch(() => {});
  };

  const setStorageToggle = async (key: any, value: any) => {
    setStorageValues((prev: any) => ({ ...prev, [key]: value }));
    await chrome.storage.local.set({ [key]: value });
    chrome.tabs.reload(tab.id);
  };

  // 5 quick clicks on the version hash flip the extension's one hidden-features
  // gate, mirrored live into the Console via chrome.storage.onChanged — no tab
  // reload needed. It hides exactly one thing today: the Academy, badged EXP on
  // the Console rail and reachable only from there. Mr. Fabry is public and no
  // longer sits behind this. Until 2026-08-11 this wrote a second key,
  // `trainingUnlocked`, in the same call; that key is retired.
  const onVersionClick = async () => {
    if (!unlockCounter.click() || !storageValues) return;
    const next = !storageValues.experimentalUnlocked;
    // Read before the write: the Console's own effect moves it off a gated app at once.
    const consoleApp = isConsole ? readConsoleTab(tab.id)?.app : null;
    const fellBack = !next && (consoleApp === 'academy' || consoleApp === 'rdc');
    setStorageValues((prev: any) => ({ ...prev, experimentalUnlocked: next }));
    // Written straight to storage, never via the worker — same cold-start
    // race as the usage-consent write above.
    await chrome.storage.local.set({ experimentalUnlocked: next });
    if (next) track('sa_popup_experimental_unlock');
    setUnlockNotice({ unlocked: next, fellBack });
    setTimeout(() => setUnlockNotice(null), 2500);
  };

  const setMessageToggle = async (key: any) => {
    // togglePageFlag returns the flag's NEW value. Using it (rather than the
    // locally cached messageValues, which starts false and is filled by a slow
    // executeScript round-trip) keeps the reported direction authoritative and
    // the local state in step with the page.
    const next = await runInTab(tab.id, togglePageFlag, [key]);
    if (typeof next === 'boolean') {
      setMessageValues((prev) => ({ ...prev, [key]: next }));
      chrome.tabs.reload(tab.id);
    }
  };

  const onMasterDataHub = () => {
    chrome.tabs.create({
      url: combineUrlWithCustomPath(tab.url, '/svc/master-data-hub/web/management'),
      index: tab.index + 1,
    });
  };

  const fetchAuthAndOpen = async (opener: any) => {
    setAuthError(null);
    // executeScript runs in the popup's (always-live) extension context, so it
    // survives extension upgrades that orphan content scripts. A null result
    // means the host permission failed or the tab is gone.
    const auth = await runInTab(tab.id, readAuthInfo);
    if (!auth) {
      setAuthError({ kind: 'reload' });
      return;
    }
    if (!auth.token || !auth.domain) {
      setAuthError({ kind: 'login' });
      return;
    }
    opener(tab, auth);
  };

  // Rossum admins can copy a token from the backoffice; partners and other
  // external users cannot, so the popup hands over the session's own token.
  // It goes to the clipboard only: never rendered, stored or tracked.
  const onCopyToken = () =>
    fetchAuthAndOpen(async (_tab: any, auth: any) => {
      try {
        await navigator.clipboard.writeText(auth.token);
      } catch {
        setAuthError({ kind: 'clipboard' });
        return;
      }
      track('sa_popup_copy_token');
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1600);
    });

  const onRossumConsole = () =>
    fetchAuthAndOpen((tab: any, auth: any) => openConsoleTab(tab, auth, 'mdh'));

  // Chrome cannot keep a popup open on blur — no API prevents it — so the pin
  // hands the same MDH card to a side panel, which survives clicking and
  // scrolling the page. Opened per TAB, not per window, so the panel stays
  // scoped to Rossum tabs (see src/sidepanel/panelScope.js). open() MUST run
  // inside this click: it is the user gesture Chrome requires. Feature-detected,
  // so a pre-114 Chrome (no chrome.sidePanel) never sees the button.
  const canPinSidePanel = !!chrome.sidePanel?.open;
  const onPinSidePanel = async () => {
    try {
      await openPanelForTab(tab.id, chrome.sidePanel);
      window.close();
    } catch {
      // Gesture refused or the API is unavailable — leave the popup open.
    }
  };

  const onReloadTab = () => {
    chrome.tabs.reload(tab.id);
    window.close();
  };

  const dimClass = (ctx: any) => (site && site !== ctx ? ' dimmed' : '');

  if (storageValues === null || consent === undefined || asked === undefined) {
    // Avoid first-paint flicker before storage has resolved — including consent
    // and the asked flag, so the overlay can never appear to someone who has
    // already seen it.
    return null;
  }

  return (
    <Fragment>
      <div class="accent-bar"></div>

      <header class="header">
        <div class="brand-badge">SA</div>
        <span class="brand-name">Rossum SA</span>
        {site ? (
          <div class="header-actions">
            <button
              class={`token-btn${tokenCopied ? ' copied' : ''}${dimClass('rossum')}`}
              onClick={onCopyToken}
              aria-label="Copy API token"
            >
              {tokenCopied ? <CheckIcon /> : <KeyIcon />}
              <span class="token-tip" role="status">
                {tokenCopied ? 'Copied' : 'Copy API token'}
              </span>
            </button>
            <button
              class={`mdh-btn${dimClass('rossum')}`}
              onClick={onMasterDataHub}
              title="Open Master Data Hub"
            >
              <span>Master Data Hub</span>
              <ExternalIconSmall />
            </button>
            <button class="console-btn" onClick={onRossumConsole}>
              <span>Rossum Console</span>
              <ExternalIcon />
            </button>
          </div>
        ) : isConsole ? (
          <ConsoleHeaderActions tabId={tab.id} />
        ) : null}
      </header>

      {/* The first ask, IN FLOW rather than over the popup — it blocks nothing,
          so it stays until answered instead of being spent on one showing. Sits
          outside the site branch below for the same reason the overlay used to:
          it must reach people whose current tab isn't Rossum/NetSuite/Coupa. */}
      <UsageStrip consent={consent} reviewing={reviewingUsage} onAnswer={onUsageAnswer} />

      {isConsole ? (
        <ConsoleView
          tabId={tab.id}
          unlocked={storageValues.experimentalUnlocked}
          orgNameEnabled={storageValues.orgNameEnabled}
          orgEnvEnabled={storageValues.orgEnvEnabled}
          notice={unlockNotice}
        />
      ) : !site ? (
        <OffSite
          tabs={rossumTabs}
          viewed={viewed}
          orgNameEnabled={storageValues.orgNameEnabled}
          orgEnvEnabled={storageValues.orgEnvEnabled}
          notice={unlockNotice}
        />
      ) : (
        <div id="mainContent">
          <div class="content-row">
            {showMdhPanel ? (
              <div class="content-col content-col-mdh">
                <MdhProvenancePanel
                  tab={tab}
                  onPin={canPinSidePanel ? onPinSidePanel : undefined}
                />
              </div>
            ) : null}

            <div class="content-col content-col-toggles">
              <section class={`card${dimClass('rossum')}`} data-context="rossum">
                <h3 class="section-title">Rossum</h3>

                <div class="toggle-group toggle-group--cols-2">
                  <span class="group-label">Overlays</span>
                  <Toggle
                    id="schemaAnnotationsEnabled"
                    label="Schema IDs"
                    hint="Overlay schema_id"
                    checked={storageValues.schemaAnnotationsEnabled}
                    onChange={(v) => setStorageToggle('schemaAnnotationsEnabled', v)}
                  />
                  <Toggle
                    id="resourceIdsEnabled"
                    label="Resource IDs"
                    hint="Overlay object IDs"
                    checked={storageValues.resourceIdsEnabled}
                    onChange={(v) => setStorageToggle('resourceIdsEnabled', v)}
                  />
                  {/* The one toggle that defaults ON (see orgNameOn). The Overlays
                      group is two columns so this adds no row: a third full-width row
                      overflowed the height-capped popup when the usage-consent strip
                      was showing (measured 2026-09-27). */}
                  <Toggle
                    id="orgNameEnabled"
                    label="Org info"
                    hint="Header & Console"
                    checked={storageValues.orgNameEnabled}
                    onChange={(v) => setStorageToggle('orgNameEnabled', v)}
                  />
                  <Toggle
                    id="orgEnvEnabled"
                    label="Org env"
                    hint="Sandbox / prod"
                    checked={storageValues.orgEnvEnabled}
                    onChange={(v) => setStorageToggle('orgEnvEnabled', v)}
                  />
                </div>

                <div class="toggle-group">
                  <span class="group-label">Behavior</span>
                  <Toggle
                    id="expandFormulasEnabled"
                    label="Expand formulas"
                    hint="Auto-open formula source code"
                    checked={storageValues.expandFormulasEnabled}
                    onChange={(v) => setStorageToggle('expandFormulasEnabled', v)}
                  />
                  <Toggle
                    id="expandReasoningFieldsEnabled"
                    label="Expand reasoning"
                    hint="Auto-open reasoning field options"
                    checked={storageValues.expandReasoningFieldsEnabled}
                    onChange={(v) => setStorageToggle('expandReasoningFieldsEnabled', v)}
                  />
                  <Toggle
                    id="scrollLockEnabled"
                    label="Sidebar scroll lock"
                    hint="Keep annotation sidebar scroll position"
                    checked={storageValues.scrollLockEnabled}
                    onChange={(v) => setStorageToggle('scrollLockEnabled', v)}
                  />
                </div>

                <div class="toggle-group toggle-group--cols-2">
                  <span class="group-label">Developer</span>
                  <Toggle
                    id="devFeaturesEnabled"
                    label="Dev features"
                    hint="devFeaturesEnabled"
                    checked={messageValues.devFeaturesEnabled}
                    onChange={() => setMessageToggle('devFeaturesEnabled')}
                  />
                  <Toggle
                    id="devDebugEnabled"
                    label="Dev debug"
                    hint="devDebugEnabled"
                    checked={messageValues.devDebugEnabled}
                    onChange={() => setMessageToggle('devDebugEnabled')}
                  />
                </div>
              </section>

              <div class="card-row">
                <section class={`card${dimClass('netsuite')}`} data-context="netsuite">
                  <h3 class="section-title">NetSuite</h3>
                  <Toggle
                    id="netsuiteFieldNamesEnabled"
                    label="Field names"
                    hint="Show field IDs on form labels"
                    checked={storageValues.netsuiteFieldNamesEnabled}
                    onChange={(v) => setStorageToggle('netsuiteFieldNamesEnabled', v)}
                  />
                </section>

                <section class={`card${dimClass('coupa')}`} data-context="coupa">
                  <h3 class="section-title">
                    Coupa <span class="beta-badge">beta</span>
                  </h3>
                  <Toggle
                    id="coupaFieldNamesEnabled"
                    label="Field names"
                    hint="Show API names on form labels"
                    checked={storageValues.coupaFieldNamesEnabled}
                    onChange={(v) => setStorageToggle('coupaFieldNamesEnabled', v)}
                  />
                </section>
              </div>

              {authError ? (
                <div class={`tool-notice${dimClass('rossum')}`} role="alert">
                  {authError.kind === 'reload' ? (
                    <Fragment>
                      <span class="tool-notice-msg">
                        Reload the Rossum tab — the extension was updated and lost its connection.
                      </span>
                      <button class="tool-notice-action" onClick={onReloadTab}>
                        Reload tab
                      </button>
                    </Fragment>
                  ) : authError.kind === 'clipboard' ? (
                    <span class="tool-notice-msg">
                      Could not copy to the clipboard. Click the key again.
                    </span>
                  ) : (
                    <span class="tool-notice-msg">Sign in to Rossum in this tab first.</span>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          {site === 'rossum' ? <ReviewingLockBanner tab={tab} /> : null}
        </div>
      )}

      <footer class="footer">
        {/* Version hash with the usage-data control beside it, rather than a
            third item floating in the middle of the footer. */}
        <div class="footer-left">
          {/* On Rossum, NetSuite and Coupa the notice takes this group's place for 2.5 s —
              never a third item in the row, which wrapped the footer at 380px. Off those
              sites it takes the line under the header instead (NoticeLine). */}
          {unlockNotice && site ? (
            <UnlockNoticeText notice={unlockNotice} />
          ) : (
            <Fragment>
              <span class="version" onClick={onVersionClick}>
                {version}
              </span>
              <UsageFooterButton
                asked={asked}
                consent={consent}
                onToggle={() => setReviewingUsage((v) => !v)}
              />
            </Fragment>
          )}
        </div>
        <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" class="footer-link">
          Support & feedback
          <ExternalIconSmall />
        </a>
      </footer>
    </Fragment>
  );
}
