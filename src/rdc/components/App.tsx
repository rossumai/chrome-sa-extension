// rdc (experimental): deployments into the connected org. The connected org is the target; the
// admin chooses one source org, gives a token for it, and rdc's sync engine (WebAssembly) reads
// both into one project with `noPush: true`. rdc keeps each env's sync state in that env's own
// org's Data Storage; no configuration is written by a read. The chosen source and the direct
// edits seen in this org are kept in this org's own Data Storage (`sourceStore.ts`), never a
// token. The page owns a finished read's project and frees it when the read is replaced or left.
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
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
import { OwnValues } from './WipSteps.jsx';
import Plan from './Plan.jsx';
import Review from './Review.jsx';
import Write, { Done, type WriteResult } from './Write.jsx';
import {
  DEFAULT_PLAN,
  overwrittenEdits,
  tokenOwnerMissing,
  type PlanChoice,
  type Planned,
} from '../plan.js';
import { runPlan } from '../runPlan.js';
import { fetchUsers as defaultFetchUsers, type FetchUsers } from '../users.js';
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
  // Injectable for tests; production lists the target org's users.
  fetchUsers?: FetchUsers;
};

export default function App({
  connected,
  loadRdc = defaultLoadRdc,
  fetchOrgs = defaultFetchOrgs,
  dataStorage,
  fetchUsers = defaultFetchUsers,
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
  const [readResult, setReadResultState] = useState<ReadResult | null>(null);
  // A replaced read's project is freed: only the current read's project is kept. A kept read
  // handed back by Read has no project of its own and keeps the current one.
  const setReadResult = (r: ReadResult | null) => {
    setReadResultState((old) => {
      const next = r && !r.project && old?.project ? { ...r, project: old.project } : r;
      if (old?.project && old.project !== next?.project) old.project.free();
      return next;
    });
  };
  // The plan and the write's result belong to the current read.
  const [choice, setChoice] = useState<PlanChoice>(DEFAULT_PLAN);
  const [planned, setPlanned] = useState<Planned | null>(null);
  // The hooks' token owner: from the target's stored overlay, or chosen in Review.
  const [tokenOwner, setTokenOwner] = useState<string | null>(null);
  const [replanning, setReplanning] = useState(false);
  const [replanError, setReplanError] = useState('');
  const [written, setWritten] = useState<WriteResult | null>(null);
  const resetPlan = () => {
    setChoice(DEFAULT_PLAN);
    setPlanned(null);
    setTokenOwner(null);
    setWritten(null);
  };
  const readRef = useRef<ReadResult | null>(null);
  readRef.current = readResult;
  useEffect(() => () => readRef.current?.project?.free(), []);

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
  // A scratch copy of the read's project, to plan on.
  const copy = () => new rdc!.Project(readResult!.project!.files());
  // Leaving the deployment forgets the token and the read made with it.
  const leaveSource = () => {
    setSourceToken('');
    setReadResult(null);
    resetPlan();
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
          resetPlan();
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
        dataStorage={ds()}
        kept={readResult && { ...readResult, project: undefined }}
        onDone={(r) => {
          // a fresh read (with its own project) makes the last plan stale
          if (r.project) {
            resetPlan();
            setTokenOwner(r.tokenOwner);
          }
          setReadResult(r);
          setScreen('plan');
        }}
        onBack={() => setScreen('connect')}
        onCancel={leaveSource}
      />
    );
  else if (source && readResult && screen === 'plan')
    page = (
      <Plan
        project={readResult.project ?? null}
        copy={copy}
        tokenOwner={tokenOwner}
        persisted={readResult.persisted}
        sourceName={source.name}
        targetName={name}
        choice={choice}
        onChoice={(c) => {
          setChoice(c);
        }}
        planned={planned}
        onPlanned={setPlanned}
        onBack={() => setScreen('read')}
        onNext={() => setScreen('review')}
        onCancel={leaveSource}
      />
    );
  else if (source && readResult && planned && screen === 'review')
    page = (
      <Review
        planned={planned}
        overwritten={overwrittenEdits(planned.result, planned.plan, readResult.directEdits)}
        sourceName={source.name}
        targetName={name}
        tokenOwner={tokenOwner}
        replanning={replanning}
        replanError={replanError}
        loadUsers={() => fetchUsers(domain.value, token.value)}
        onTokenOwner={(url) => {
          // the plan is made again with the owner, so Review shows what Write will send
          setTokenOwner(url);
          setReplanning(true);
          setReplanError('');
          runPlan(copy, choice, url, () => {})
            .then(setPlanned, (e) => setReplanError(String((e as Error)?.message || e)))
            .finally(() => setReplanning(false));
        }}
        onBack={() => setScreen('plan')}
        onNext={() => setScreen('write')}
        onCancel={leaveSource}
      />
    );
  else if (source && readResult?.project && screen === 'write')
    page = (
      <Write
        project={readResult.project}
        source={source}
        targetName={name}
        choice={choice}
        dataStorage={ds()}
        directEdits={readResult.directEdits}
        plan={planned?.plan ?? null}
        tokenOwner={tokenOwner}
        blocked={
          planned && tokenOwnerMissing(planned, tokenOwner)
            ? "Choose in Review who owns the hooks' tokens."
            : ''
        }
        onWritten={(r) => {
          setWritten(r);
          setScreen('done');
        }}
        onTreeChanged={() => setPlanned(null)}
        onBack={() => setScreen(planned ? 'review' : 'plan')}
        onCancel={leaveSource}
      />
    );
  else if (source && written && screen === 'done')
    page = <Done result={written} targetName={name} onBack={leaveSource} />;
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
