// rdc (experimental): deployments into the connected org. The connected org is the target; the
// admin chooses one source org, gives a token for it, and rdc's sync engine (WebAssembly) reads
// both into a project held in memory only, with `noPush: true`, so nothing is written to either
// org. Plan, Review, Write, Done and the org's own values are shown as work in progress until
// rdc can do them in the browser. Only the chosen source is kept, in this org's own Data Storage
// (`sourceStore.ts`), never its token.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { domain, token } from '../store.js';
import { connectedOrg } from '../../console/store.js';
import { hostOf, type Source, type StepId } from '../deploy.js';
import { loadRdc as defaultLoadRdc, type Rdc } from '../wasm.js';
import { currentOrg } from '../../rossum/orgName.js';
import { isRateLimited, rateLimitMessage } from '../../net/rateLimit.js';
import { dataStorageFor, loadSource, saveSource, type DataStorage } from '../sourceStore.js';
import Band, { type BandTarget } from './Band.jsx';
import Overview from './Overview.jsx';
import ChooseSource, { fetchOrgs as defaultFetchOrgs, type FetchOrgs } from './ChooseSource.jsx';
import Connect from './Connect.jsx';
import Read, { type ReadResult } from './Read.jsx';
import { OwnValues, WipStep } from './WipSteps.jsx';
import styles from './App.module.css';

type Screen =
  'overview' | 'choose' | 'connect' | 'read' | 'plan' | 'review' | 'write' | 'done' | 'own';

// The band's step for each screen; the overview, its modal, own values and Done show the belt.
const STEP_OF: Partial<Record<Screen, StepId>> = {
  connect: 'connect',
  read: 'read',
  plan: 'plan',
  review: 'review',
  write: 'write',
};

const noteFor = (e: unknown) =>
  isRateLimited(e) ? rateLimitMessage(e) : (e as Error)?.message || String(e);

type Props = {
  connected: boolean | null;
  // Injectable for tests; production uses the real loader and `GET /organizations`.
  loadRdc?: () => Promise<Rdc>;
  fetchOrgs?: FetchOrgs;
  // Injectable for tests; production calls the connected org's Data Storage.
  dataStorage?: DataStorage;
};

export default function App({
  connected,
  loadRdc = defaultLoadRdc,
  fetchOrgs = defaultFetchOrgs,
  dataStorage,
}: Props) {
  // undefined while loading, null when it failed to load (rdcError says why)
  const [rdc, setRdc] = useState<Rdc | null | undefined>(undefined);
  const [rdcError, setRdcError] = useState('');
  // The target: the one organization the session lists. undefined while loading.
  const [target, setTarget] = useState<BandTarget | null | undefined>(undefined);
  const [targetError, setTargetError] = useState('');
  // What the target was resolved from, handed to Read so it asks the API nothing again.
  const [targetOrgs, setTargetOrgs] = useState<unknown>(null);
  const [screen, setScreen] = useState<Screen>('overview');
  // The source is remembered in this org's Data Storage; its token lives here only.
  const [source, setSource] = useState<Source | null>(null);
  // Why the source could not be loaded or saved, or empty.
  const [sourceNote, setSourceNote] = useState('');
  const ds = () => dataStorage ?? dataStorageFor(domain.value, token.value);
  const [sourceToken, setSourceToken] = useState('');
  // The last finished read, so Back from Plan shows it without syncing both orgs again.
  const [readResult, setReadResult] = useState<ReadResult | null>(null);

  useEffect(() => {
    loadRdc().then(setRdc, (e: any) => {
      setRdc(null);
      setRdcError(`rdc wasm did not load: ${e?.message || e}`);
    });
  }, []);

  useEffect(() => {
    if (!connected) return;
    let alive = true;
    setTarget(undefined);
    setTargetError('');
    fetchOrgs(domain.value, token.value).then(
      (orgs) => {
        if (!alive) return;
        const org = currentOrg(orgs);
        if (!org || org.id === null) {
          setTarget(null);
          setTargetError(
            'The session does not list exactly one organization, so which one to deploy into is unknown.',
          );
          return;
        }
        setTargetOrgs(orgs);
        // env: the Console has no Sandbox/Production flag at hand, so the band shows no chip
        const resolved = { name: org.name, host: hostOf(domain.value), orgId: org.id, env: null };
        // the page shows once the remembered source is known, so it does not flash the first visit
        loadSource(ds())
          .then(
            (saved) => alive && setSource(saved),
            (e) => alive && setSourceNote(`Could not load the saved source: ${noteFor(e)}`),
          )
          .finally(() => alive && setTarget(resolved));
      },
      (e) => {
        if (!alive) return;
        setTarget(null);
        setTargetError(
          isRateLimited(e)
            ? rateLimitMessage(e)
            : `Could not read this organization: ${(e as Error)?.message || e}`,
        );
      },
    );
    return () => {
      alive = false;
    };
  }, [connected]);

  if (!connected)
    return (
      <div class="app-root">
        <main class="main">
          <div class="connection-bar">
            <span class="connection-dot error"></span>
            Not connected — open a Rossum page and click Rossum Console in the extension popup
          </div>
        </main>
      </div>
    );

  const bar = (
    <div class="connection-bar">
      <span class="connection-dot"></span>
      rdc (experimental) · Connected to {hostOf(domain.value)}
      {connectedOrg.value ? ` · ${connectedOrg.value}` : ''}
      {rdc ? ` · rdc ${rdc.version()}` : ''}
    </div>
  );

  if (!target)
    return (
      <div class="app-root">
        <main class="main">
          {bar}
          {target === undefined ? (
            <div class="empty-state">Loading{'…'}</div>
          ) : (
            <div class="error-banner">
              <span>{targetError}</span>
            </div>
          )}
        </main>
      </div>
    );

  const name = target.name;
  const toOverview = () => setScreen('overview');
  // Leaving the deployment forgets the token and the read made with it.
  const leaveSource = () => {
    setSourceToken('');
    setReadResult(null);
    toOverview();
  };

  // Why nothing that needs rdc can start; the same text Read shows.
  const rdcBlock = rdc
    ? ''
    : rdc === undefined
      ? `Loading rdc${'…'}`
      : rdcError || 'rdc is not in this build.';

  let page;
  if (screen === 'own') page = <OwnValues targetName={name} onBack={toOverview} />;
  else if (source && screen === 'connect')
    page = (
      <Connect
        source={source}
        knownToken={sourceToken}
        fetchOrgs={fetchOrgs}
        blocked={rdcBlock}
        onBack={leaveSource}
        onCancel={leaveSource}
        onConnected={(t) => {
          setSourceToken(t);
          setReadResult(null);
          setScreen('read');
        }}
      />
    );
  else if (source && screen === 'read')
    page = (
      <Read
        rdc={rdc ?? null}
        rdcError={rdcError}
        rdcLoading={rdc === undefined}
        source={source}
        sourceToken={sourceToken}
        domain={domain.value}
        token={token.value}
        organizations={targetOrgs}
        kept={readResult}
        onDone={(r) => {
          setReadResult(r);
          setScreen('plan');
        }}
        onBack={() => setScreen('connect')}
        onCancel={leaveSource}
      />
    );
  else if (source && (screen === 'plan' || screen === 'review' || screen === 'write'))
    page = (
      <WipStep
        step={screen}
        sourceName={source.name}
        targetName={name}
        onBack={() =>
          setScreen(screen === 'plan' ? 'read' : screen === 'review' ? 'plan' : 'review')
        }
        // From Write, onNext leads to Done; its button stays disabled until writing works.
        onNext={() =>
          setScreen(screen === 'plan' ? 'review' : screen === 'review' ? 'write' : 'done')
        }
        onCancel={leaveSource}
      />
    );
  else if (source && screen === 'done')
    page = <WipStep step="done" sourceName={source.name} targetName={name} onBack={leaveSource} />;
  else
    page = (
      <Overview
        source={source}
        targetName={name}
        onChooseSource={() => setScreen('choose')}
        onDeploy={() => setScreen('connect')}
        blocked={rdcBlock}
        sourceNote={sourceNote}
        onEditOwn={() => setScreen('own')}
        chooser={
          screen === 'choose' && (
            <ChooseSource
              fetchOrgs={fetchOrgs}
              targetDomain={domain.value}
              targetOrgId={target.orgId}
              onCancel={toOverview}
              onChosen={(s, t) => {
                setSource(s);
                setSourceNote('');
                saveSource(ds(), s).catch((e) =>
                  setSourceNote(
                    `Could not save the source in this org, so it is used for this visit only: ${noteFor(e)}`,
                  ),
                );
                setSourceToken(t);
                setReadResult(null);
                toOverview();
              }}
            />
          )
        }
      />
    );

  return (
    <div class="app-root">
      <main class="main">
        {bar}
        <div class={styles.body}>
          <Band
            source={source}
            target={target}
            step={STEP_OF[screen] ?? null}
            lastDeployment={null}
          />
          {page}
        </div>
      </main>
    </div>
  );
}
