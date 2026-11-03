// src/cib/help.tsx
// The CIB deploy page's help: one section per part of the page. Each figure is the page's own
// component with sample props, frozen by HelpFigure, so it cannot drift from the UI. Every claim
// here was checked against cib.ts, engine.ts, release.ts and view.ts (the list is in the commit
// that added this file); change the text only with the code that backs it.
import { h, Fragment, createRef } from 'preact';
import HelpFigure from '../help/HelpFigure.jsx';
import type { HelpSection } from '../help/HelpPanel.jsx';
import Step from './components/Step.jsx';
import TargetStep from './components/TargetStep.jsx';
import CredentialsStep from './components/CredentialsStep.jsx';
import CoupaLoginStep from './components/CoupaLoginStep.jsx';
import DeployStep from './components/DeployStep.jsx';
import RunResult, { runTitle } from './components/RunResult.jsx';
import type { RunView } from './components/RunResult.jsx';
import { ownerLabel } from './components/OwnerCombobox.jsx';
import { verdict } from './cib.js';
import { PHASES } from './view.js';

// sample data: placeholders only
const RELEASE = 'v2.3.0';
const RUN_ID = 'cib-2026-11-03';
const OWNER = { username: 'admin.example', name: 'Alex Example', email: '' };
const noop = () => {};

const doneResult = {
  status: 'done',
  idmap: Object.fromEntries(Array.from({ length: 84 }, (_, i) => [`o${i}`, i])),
  invoked: Array.from({ length: 4 }, () => ({ status: 200 })),
  pendingImports: ['coupa_suppliers'],
};
// a finished deploy with one dataset still missing; restore did not run (no earlier teardown)
const RUN: RunView = {
  mode: 'deploy',
  running: false,
  failed: false,
  runId: RUN_ID,
  status: 'Finished: done',
  clock: '',
  phases: {
    counts: Object.fromEntries(
      PHASES.filter(([k]) => k !== 'restore').map(([k]) => [
        k,
        k === 'datasets' ? { done: 3, total: 4 } : { done: 1, total: 1 },
      ]),
    ),
    current: 'datasets',
  },
  outcome: {
    status: 'done',
    verdict: verdict(doneResult),
    notes: [],
    details: '{}',
    stats: { objects: 84, started: 4, invoked: 4, pending: 1 },
  },
  log: '',
  probeLeft: false,
};

export const CIB_HELP: HelpSection[] = [
  {
    id: 'what',
    chip: 'What it does',
    title: 'What CIB deploy does',
    keywords:
      'coupa integration baseline engines workspaces queues schemas inboxes hooks rules memorisation collections imports release github v2 bundled read-only writes check only check and deploy',
    body: (
      <>
        <p>
          CIB deploy creates the <b>Coupa Integration Baseline</b> in the Rossum organization you
          are signed in to: its engines, workspaces, queues, schemas, inboxes, hooks and rules. It
          then creates the memorisation collections and starts the Coupa imports.
        </p>
        <p>
          Nothing of CIB is bundled with the extension. When a run starts, the page reads the latest
          release of <code>rossumai/rossum-coupa-integration</code> from GitHub. Only v2.x releases
          can be deployed.
        </p>
        <p>
          Opening the page and filling in the form only read the organization. <b>Check only</b>{' '}
          creates no CIB object. <b>Check and deploy</b> is the one button that creates CIB. The
          buttons in step 3 create or remove only the optional check function.
        </p>
      </>
    ),
  },
  {
    id: 'before',
    chip: 'Before you start',
    title: 'Before you start',
    keywords:
      'sign in session one organization console region deployment location prod-eu prod-eu2 prod-us2 prod-jp oauth client id secret scopes required admin token owner',
    body: (
      <ul>
        <li>
          Sign in to the organization you deploy into, and open the Console from it. The session
          must see exactly one organization, or the page cannot run.
        </li>
        <li>
          The organization group's deployment location must be one of prod-eu, prod-eu2, prod-us2 or
          prod-jp.
        </li>
        <li>
          A Coupa <b>OAuth client</b> (client ID and secret) with the scopes the release requires.
          Check names a missing scope when it can test the credentials.
        </li>
        <li>
          An <b>active admin</b> of the organization, to own the token the CIB hooks run with.
        </li>
      </ul>
    ),
  },
  {
    id: 'step1',
    chip: 'Step 1',
    title: 'Step 1 · Target and token owner',
    keywords:
      'release latest checkpoint resume organization session region deployment location token owner admin search name email',
    body: (
      <>
        <p>
          You choose only the token owner. CIB goes to the organization of your session, and the
          page reads the release and the region for you.
        </p>
        <HelpFigure
          callouts={[
            {
              target: 'release',
              note: (
                <>
                  <b>Release</b> — the latest published release on GitHub. When the run ID has a
                  checkpoint, the release that run started with: a resume keeps it.
                </>
              ),
            },
            {
              target: 'org',
              note: (
                <>
                  <b>Organization</b> — the one organization your session sees. To deploy somewhere
                  else, sign in to that organization and open the Console again.
                </>
              ),
            },
            {
              target: 'region',
              note: (
                <>
                  <b>Region</b> — the organization group's deployment location. It picks each hook's
                  regional service URL.
                </>
              ),
            },
            {
              target: '[data-help="owner"] input',
              note: (
                <>
                  <b>Token owner</b> — the CIB hooks run as this user. Only active admins of the
                  organization are listed. Type to search by name or email.
                </>
              ),
            },
          ]}
        >
          <TargetStep
            release={RELEASE}
            resumeRelease={null}
            runId={RUN_ID}
            target={{ orgId: 123456, orgName: 'Acme Sandbox', region: 'prod-eu2' }}
            targetErrors={[]}
            query=""
            owner={OWNER.username}
            label={ownerLabel(OWNER)}
            owners={[OWNER]}
            state="complete"
            onQuery={noop}
            onPick={noop}
          />
        </HelpFigure>
      </>
    ),
  },
  {
    id: 'step2',
    chip: 'Step 2',
    title: 'Step 2 · Coupa credentials',
    keywords:
      'coupa url instance oauth2 token client id client secret memory reload placeholder checkpoint data storage',
    body: (
      <>
        <p>All three fields are required.</p>
        <HelpFigure
          callouts={[
            {
              target: '[data-help="coupa-url"] input',
              note: (
                <>
                  <b>Coupa URL</b> — the instance root. The hooks add paths such as{' '}
                  <code>oauth2/token</code> to it, so leave out any path. A missing{' '}
                  <code>https://</code> or trailing slash is added for you.
                </>
              ),
            },
            {
              target: '[data-help="client-secret"] input',
              note: (
                <>
                  <b>Client secret</b> — kept only in this page's memory. Reloading the page forgets
                  it, and you type it again.
                </>
              ),
            },
            {
              target: 'secret-note',
              note: (
                <>
                  The deploy gives the secret to the hooks that need it. The checkpoint in Data
                  Storage holds only a placeholder.
                </>
              ),
            },
          ]}
        >
          <CredentialsStep
            coupaUrl="https://example.coupahost.com"
            coupaId="cib-client"
            coupaSecret="xxxxxxxxxxxx"
            onInput={() => noop}
            showSecret={false}
            onToggleSecret={noop}
            state="current"
          />
        </HelpFigure>
      </>
    ),
  },
  {
    id: 'step3',
    chip: 'Step 3',
    title: 'Step 3 · Test the Coupa login (optional)',
    keywords:
      'coupa login test browser permission check function hook organization ip addresses https functions remove scope secret',
    body: (
      <>
        <p>
          Check logs in to Coupa once with the client ID and secret, so a wrong secret or a missing
          scope stops the run before anything is written. The deploy does not need this step.
        </p>
        <p>
          The choice only changes what the step shows. While a check function exists in the
          organization, Check always logs in through it.
        </p>
        <HelpFigure
          callouts={[
            {
              target: 'route-browser',
              note: (
                <>
                  <b>This browser</b> — the default. Chrome asks once for permission to reach Coupa.
                  If you refuse, Check skips the login test and says so in its notes.
                </>
              ),
            },
            {
              target: 'route-org',
              note: (
                <>
                  <b>The Rossum organization</b> — a function hook in the organization logs in from
                  Rossum's servers, for when Coupa accepts only known IP addresses. The organization
                  must allow functions to call HTTPS hosts. The function is not part of CIB: remove
                  it when you have finished.
                </>
              ),
            },
          ]}
        >
          <CoupaLoginStep
            route="browser"
            probe={null}
            probePage={null}
            busy={false}
            onRoute={noop}
            onCreate={noop}
            onRemove={noop}
          />
        </HelpFigure>
      </>
    ),
  },
  {
    id: 'step4',
    chip: 'Step 4',
    title: 'Step 4 · Deploy',
    keywords:
      'check only check and deploy blockers nothing written run id checkpoint resume re-run skips checks continue half-built adopt by name',
    body: (
      <HelpFigure
        callouts={[
          {
            target: 'check',
            note: (
              <>
                <b>Check only</b> — runs the read-only checks and stops. It creates no CIB object.
              </>
            ),
          },
          {
            target: 'deploy',
            note: (
              <>
                <b>Check and deploy</b> — runs the same checks. If one of them blocks, it stops and
                writes nothing; otherwise it creates CIB.
              </>
            ),
          },
          {
            target: 'resume',
            note: (
              <>
                <b>Resume and re-run</b> — the deploy saves its progress under the run ID. Deploy
                again with the same ID to resume; a resumed run skips the checks.{' '}
                <b>Continue a half-built deploy</b> adopts CIB objects already in the organization
                by name, instead of stopping at them.
              </>
            ),
          },
        ]}
      >
        <DeployStep
          runId={RUN_ID}
          allow={false}
          onRunIdInput={noop}
          onAllowChange={noop}
          ready={true}
          busy={false}
          state="current"
          deployRef={createRef()}
          resumeRef={createRef()}
        />
      </HelpFigure>
    ),
  },
  {
    id: 'step5',
    chip: 'Step 5',
    title: 'Step 5 · Read the result',
    keywords:
      'result verdict succeeded open items blocked stopped error datasets still missing 180 s dataset management imports checkpoint phases read-only full first import',
    body: (
      <>
        <HelpFigure
          callouts={[
            {
              target: 'verdict',
              note: (
                <>
                  <b>Verdict</b> — green: the deploy succeeded, or the check passed. Amber: deployed
                  with open items, or the run ID has a checkpoint to resume. Red: blocked with
                  nothing written, or the run stopped with an error.
                </>
              ),
            },
            {
              target: '[data-stat="missing"]',
              note: (
                <>
                  <b>Datasets still missing</b> — the run waited 180 s for the Coupa datasets, then
                  stopped waiting. Look in Dataset Management to see whether a dataset has appeared
                  since. The checkpoint stays: Check and deploy with the same run ID re-runs the
                  imports.
                </>
              ),
            },
            {
              target: 'phases',
              note: (
                <>
                  <b>Phases</b> — the first two are read-only. A deploy that stops after them keeps
                  its progress in the run's checkpoint. <i>Full first import</i> runs only after an
                  earlier teardown.
                </>
              ),
            },
          ]}
        >
          <Step n={5} state="complete" title={runTitle(RUN, RELEASE)} meta={RUN.status}>
            <RunResult run={RUN} />
          </Step>
        </HelpFigure>
        <p>When every dataset is present, the run is complete and deletes its checkpoint.</p>
      </>
    ),
  },
  {
    id: 'trouble',
    chip: 'Troubleshooting',
    title: 'When something goes wrong',
    keywords:
      'stopped with an error resume deploy blocked nothing was written blockers cib objects already exist continue half-built one organization github 403 429 rate limit 60 calls hook template rossum support timeout',
    body: (
      <ul>
        <li>
          <b>Stopped with an error</b> — the message says whether anything was written. When Check
          and deploy stopped after the checks, fix the cause and press <b>Resume deploy</b>: the
          checkpoint keeps what was created.
        </li>
        <li>
          <b>Blocked: nothing was written</b> — read the blockers in step 5, fix them, and run
          again.
        </li>
        <li>
          <b>The organization already holds CIB objects</b> — a second deploy would duplicate them.
          To finish a half-built deploy, open <i>Resume and re-run</i> and tick{' '}
          <b>Continue a half-built deploy</b>.
        </li>
        <li>
          <b>The session does not see exactly one organization</b> — sign in to the organization to
          deploy into, then open the Console again.
        </li>
        <li>
          <b>GitHub answered 403 or 429</b> — without sign-in, GitHub allows 60 calls per hour. Try
          again later.
        </li>
        <li>
          <b>A hook template is not visible, or hooks need a longer timeout</b> — ask Rossum
          support, as the blocker says.
        </li>
      </ul>
    ),
  },
];
