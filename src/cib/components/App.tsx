// src/cib/components/App.tsx
// CIB deploy: creates the Coupa Integration Baseline in the connected org with the JS engine
// (src/cib/engine.ts + cib.ts). The release is read from GitHub when a run starts (release.ts);
// the extension holds no CIB objects. The console's own Rossum session is the auth. The Coupa secret
// stays in this component's memory; the Data Storage checkpoint holds only placeholders.
// One column of numbered steps (design: 2026-10-30-cib-deploy-ux-refinement-design.md). The layout
// changed, the requests did not: every effect and engine call below is the one the form had before.
import { h, Fragment } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { domain, token } from '../store.js';
import { connectedOrg } from '../../console/store.js';
import { makeClient } from '../engine.js';
import type { Progress } from '../engine.js';
import {
  checkpointRelease,
  deployCib,
  deployCoupaProbe,
  findCoupaProbes,
  readTarget,
  teardownCoupaProbes,
  verdict,
} from '../cib.js';
import type { Target } from '../cib.js';
import { CIB_REPO, latestRelease, loadRelease } from '../release.js';
import { stopNote, trackPhase } from '../view.js';
import type { LoginRoute, PhaseLog } from '../view.js';
import Step from './Step.jsx';
import { ownerLabel } from './OwnerCombobox.jsx';
import type { Owner } from './OwnerCombobox.jsx';
import TargetStep from './TargetStep.jsx';
import CredentialsStep from './CredentialsStep.jsx';
import CoupaLoginStep from './CoupaLoginStep.jsx';
import DeployStep from './DeployStep.jsx';
import RunResult, { runTitle } from './RunResult.jsx';
import type { RunView } from './RunResult.jsx';
import HelpButton from '../../help/HelpButton.jsx';
import HelpWindow from '../../help/HelpWindow.jsx';
import { loadHelpRect } from '../../help/rect.js';
import { CIB_HELP } from '../help.jsx';
import styles from './App.module.css';

const ADMIN_GROUPS = ['admin', 'organization_group_admin'];
// asked for on the first Check/Deploy click (optional, so a store update adds no install-time prompt);
// without it the Coupa credentials check is skipped and the result says so
const COUPA_ORIGINS = ['https://*.coupahost.com/*', 'https://*.coupacloud.com/*'];
const PHASES: Record<string, string> = {
  release: 'Reading the release from GitHub',
  checks: 'Checks (read-only)',
  objects: 'Creating objects',
  patches: 'Setting secrets and activating hooks',
  memorisation: 'Memorisation collections',
  imports: 'Starting the Coupa imports',
  restore: 'Full first import (old MDH watermark)',
  datasets: 'Waiting for the datasets',
};
const NO_PHASES: PhaseLog = { counts: {}, current: null };

const host = (d: string) => {
  try {
    return new URL(d).host;
  } catch {
    return d;
  }
};

// the hook's page in the Rossum UI, from its API url
const hookPage = (url: string) =>
  `${domain.value}/extensions/my-extensions/${url.split('/').pop()}`;

export default function App({ connected }: { connected: boolean | null }) {
  const [v, setV] = useState<Record<string, any>>({
    owner: '',
    ownerQuery: '',
    ownerLabel: '',
    coupaUrl: '',
    coupaId: '',
    coupaSecret: '',
    run: `cib-${new Date().toISOString().slice(0, 10)}`,
    allow: false,
  });
  // what step 1 shows and the run uses: read, never chosen (design: 2026-11-02-cib-deploy-auto-target-design.md)
  const [release, setRelease] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  // why the release or the target could not be read; the run stays disabled
  const [targetErrors, setTargetErrors] = useState<string[]>([]);
  // the release the current run uses: the checkpoint's on a resume, else the latest
  const [runRelease, setRunRelease] = useState('');
  // the release the run ID's checkpoint was started with: a run resumes with it, so step 1 shows it
  const [resumeRelease, setResumeRelease] = useState<string | null>(null);
  // url of the Coupa check function in the org, while the user keeps it deployed
  const [probe, setProbe] = useState<string | null>(null);
  // which login route step 3 shows; UI only, the engine picks the function whenever it exists
  const [route, setRoute] = useState<LoginRoute>('browser');
  // token owner choices: active admins of the target org; `search` matches username, names and
  // email in part, without case (users API, checked on a test org 2026-10-20)
  const [owners, setOwners] = useState<Owner[]>([]);
  const adminIds = useRef<Promise<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<Progress | null>(null);
  const [phases, setPhases] = useState<PhaseLog>(NO_PHASES);
  const [status, setStatus] = useState('Idle');
  const [mode, setMode] = useState<'check' | 'deploy' | null>(null);
  const [outcome, setOutcome] = useState<RunView['outcome']>(null);
  const [runFailed, setRunFailed] = useState(false);
  const [error, setError] = useState('');
  // why the last run threw; step 5 shows it beside the phases
  const [runError, setRunError] = useState('');
  // the error came from a Check and deploy run, so the same run ID can be resumed
  const [canResume, setCanResume] = useState(false);
  const [log, setLog] = useState('');
  const [clock, setClock] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [runSeq, setRunSeq] = useState(0);
  // help makes no request, so it works connected or not, and while a run is busy
  const [helpOpen, setHelpOpen] = useState(false);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const resultRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const deployRef = useRef<HTMLButtonElement>(null);
  const resumeRef = useRef<HTMLDetailsElement>(null);
  const tLast = useRef(0);
  const set = (k: string) => (e: any) =>
    setV((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  useEffect(() => {
    if (!connected) return;
    const fail = (e: Error) => setTargetErrors((l) => [...l, e.message]);
    readTarget(makeClient(domain.value, token.value)).then(setTarget, fail);
    latestRelease().then(setRelease, (e) =>
      fail(
        new Error(`could not read the latest CIB release of github.com/${CIB_REPO}: ${e.message}`),
      ),
    );
    findCoupaProbes(makeClient(domain.value, token.value)).then(([h]) => {
      setProbe(h?.url ?? null);
      if (h) setRoute('org');
    });
  }, [connected]);

  useEffect(() => {
    if (!connected || !target) return setOwners([]);
    const c = makeClient(domain.value, token.value);
    adminIds.current ??= c.list('groups').then((gs) =>
      gs
        .filter((g) => ADMIN_GROUPS.includes(g.name))
        .map((g) => g.id)
        .join(','),
    );
    const t = setTimeout(async () => {
      const q = new URLSearchParams({
        organization: String(target.orgId),
        groups: await adminIds.current!,
        is_active: 'true',
        ordering: 'username',
        page_size: '10',
        search: v.ownerQuery.trim(),
      });
      const res = (await c.call('GET', `users?${q}`)).data?.results ?? [];
      const list: Owner[] = res.map((u: any) => ({
        username: u.username,
        name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim(),
        email: u.email ?? '',
      }));
      setOwners(list);
      setV((o) => {
        if (list.some((u) => u.username === o.owner)) return o;
        const one = list.length === 1 ? list[0] : null;
        return { ...o, owner: one?.username ?? '', ownerLabel: one ? ownerLabel(one) : '' };
      });
    }, 300);
    return () => clearTimeout(t);
  }, [connected, target, v.ownerQuery]);

  // re-read when the run ID changes and after each run, which can create or delete the checkpoint;
  // a failed read shows the latest release, and the run's own read decides
  useEffect(() => {
    const run = v.run.trim();
    if (!connected || busy || !run) return setResumeRelease(null);
    let live = true;
    const t = setTimeout(() => {
      checkpointRelease(makeClient(domain.value, token.value), run).then(
        (r) => live && setResumeRelease(r),
        () => live && setResumeRelease(null),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [connected, v.run, busy]);

  useEffect(() => void loadHelpRect(), []);

  const helpButton = (
    <HelpButton class={styles.helpAt} open={helpOpen} onToggle={() => setHelpOpen((o) => !o)} />
  );
  const help = helpOpen && (
    <HelpWindow
      title="CIB deploy help"
      placeholder="Search CIB help"
      sections={CIB_HELP}
      onClose={closeHelp}
    />
  );

  // a run that starts brings its result into view
  useEffect(() => {
    if (runSeq) resultRef.current?.scrollIntoView?.({ block: 'start' });
  }, [runSeq]);

  if (!connected)
    return (
      <div class="app-root">
        <main class="main">
          <div class="connection-bar">
            <span class="connection-dot error"></span>
            Not connected — open a Rossum page and click Rossum Console in the extension popup
            {helpButton}
          </div>
        </main>
        {help}
      </div>
    );

  const line = (l: string) => {
    tLast.current = Date.now();
    // HH:MM:SS whatever the browser's language, so every line's message starts in one column
    setLog((o) => `${o}${new Date().toTimeString().slice(0, 8)} ${l}\n`);
  };

  // deploy or tear down the Coupa check function; only on the user's click, never as a side effect
  const probeAction = async (deploy: boolean) => {
    setBusy(true);
    setError('');
    setCanResume(false);
    try {
      const c = makeClient(domain.value, token.value);
      if (deploy) {
        const h = await deployCoupaProbe(c);
        setProbe(h.url);
        line(`Coupa check function deployed: ${hookPage(h.url)}`);
      } else {
        const n = await teardownCoupaProbes(c);
        setProbe(null);
        line(`Coupa check function torn down (${n} deleted)`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const run = async (checkOnly: boolean) => {
    // first, while the click still counts as a user gesture
    const coupaOk =
      !probe && (await chrome.permissions.request({ origins: COUPA_ORIGINS }).catch(() => false));
    setBusy(true);
    setOutcome(null);
    setError('');
    setCanResume(false);
    setRunError('');
    setRunFailed(false);
    setProg(null);
    setPhases(NO_PHASES);
    setMode(checkOnly ? 'check' : 'deploy');
    setRunSeq((n) => n + 1);
    setStatus('Starting');
    const t0 = (tLast.current = Date.now());
    const tick = setInterval(() => {
      const s = (t: number) => Math.round((Date.now() - t) / 1000);
      setClock(`elapsed ${s(t0)} s · last activity ${s(tLast.current)} s ago`);
    }, 1000);
    try {
      const c = makeClient(domain.value, token.value);
      // a run with a checkpoint keeps the release it started with, whatever is latest now
      const tag = (await checkpointRelease(c, v.run.trim())) ?? release;
      setRunRelease(tag);
      if (tag !== release)
        line(`run ${v.run.trim()} was started with CIB ${tag}; it continues with it`);
      line(`${checkOnly ? 'check' : 'deploy'} CIB ${tag} into organization ${target!.orgId}`);
      const progress = (p: Progress) => {
        tLast.current = Date.now();
        setProg(p);
        setPhases((l) => trackPhase(l, p));
        setStatus(`${PHASES[p.phase] ?? p.phase}: ${p.done} / ${p.total}`);
      };
      const { deployConfig, ...rel } = await loadRelease(tag, { onProgress: progress });
      line(
        `read ${tag} from github.com/${CIB_REPO}: ${rel.plan.ops.length} objects; deploy settings from ${deployConfig}`,
      );
      const r = await deployCib(c, {
        ...rel,
        orgId: target!.orgId,
        run: v.run.trim(),
        region: target!.region,
        coupa: {
          baseUrl: v.coupaUrl.trim(),
          clientId: v.coupaId.trim(),
          clientSecret: v.coupaSecret,
        },
        coupaFetch: coupaOk ? fetch : undefined,
        coupaProbe: probe ?? undefined,
        tokenOwnerUsername: v.owner,
        allowExisting: v.allow,
        checkOnly,
        onEvent: line,
        onProgress: progress,
      });
      const { idmap, blockers, notes, status, ...rest } = r;
      const vd = verdict(r);
      const invoked = r.invoked ?? [];
      setOutcome({
        status,
        verdict: vd,
        blockers,
        notes,
        details: JSON.stringify({ ...rest, objects: idmap && Object.keys(idmap).length }, null, 1),
        stats:
          status === 'done'
            ? {
                objects: Object.keys(idmap ?? {}).length,
                started: invoked.filter((x: any) => x.status >= 200 && x.status < 300).length,
                invoked: invoked.length,
                pending: (r.pendingImports ?? []).length,
              }
            : undefined,
      });
      setRunFailed(vd.tone === 'fail');
      setStatus(`Finished: ${status}`);
      // the locally remembered check function may have been deleted elsewhere (another
      // tab, a manual cleanup, a different target org); re-sync so the UI stops pointing
      // at a dead hook and "Create check function" becomes available again
      if (probe && notes.some((n) => n.includes('could not give the Coupa secret')))
        findCoupaProbes(makeClient(domain.value, token.value)).then(([h]) =>
          setProbe(h?.url ?? null),
        );
    } catch (err: any) {
      line(`error: ${err.message}`);
      setRunError(err.message);
      setCanResume(!checkOnly);
      setRunFailed(true);
      setStatus('Stopped with an error');
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  };

  const shownRelease = resumeRelease ?? release;
  const ready = !!(shownRelease && target);
  const s1 = !!(ready && v.owner);
  const s2 = !!(v.coupaUrl && v.coupaId && v.coupaSecret);
  const runView: RunView | null = mode && {
    mode,
    running: busy && !!mode,
    failed: runFailed,
    error: runError || undefined,
    runId: v.run.trim(),
    status,
    clock,
    detail: prog?.detail,
    phases,
    outcome,
    log,
    probeLeft: !!probe,
  };

  return (
    <div class="app-root">
      <main class="main">
        <div class="connection-bar">
          <span class={'connection-dot' + (busy ? ' busy' : '')}></span>
          CIB deploy · Connected to {host(domain.value)}
          {connectedOrg.value ? ` · ${connectedOrg.value}` : ''}
          {helpButton}
        </div>
        <div class={styles.scroll}>
          <div class={styles.page}>
            {error && (
              <div class={styles.errorBox}>
                <span>{error}</span>
              </div>
            )}
            {runError && (
              <div class={styles.errorBox} data-run-error>
                <span>
                  <b>{runError}</b> {stopNote(mode!, phases.current, v.run.trim())}
                </span>
                {canResume && !busy && (
                  <button
                    type="button"
                    class="btn btn-sm"
                    onClick={() =>
                      // through the form, so the same validation as Check and deploy applies
                      formRef.current?.requestSubmit(deployRef.current)
                    }
                  >
                    Resume deploy
                  </button>
                )}
              </div>
            )}
            <header class={styles.hero}>
              <div class={styles.heroIcon}>
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M12 2 2 7l10 5 10-5-10-5z" />
                  <path d="m2 17 10 5 10-5" />
                  <path d="m2 12 10 5 10-5" />
                </svg>
              </div>
              <div>
                <h1>Deploy the Coupa Integration Baseline</h1>
                <p>
                  Creates the latest CIB release from{' '}
                  <a href={`https://github.com/${CIB_REPO}`} target="_blank" rel="noreferrer">
                    github.com/{CIB_REPO}
                  </a>{' '}
                  in the organization you are signed in to.
                </p>
              </div>
            </header>
            <form
              ref={formRef}
              onSubmit={(e: any) => {
                e.preventDefault();
                run(e.submitter?.name === 'check');
              }}
            >
              <fieldset class={styles.fieldset} disabled={busy}>
                <TargetStep
                  release={release}
                  resumeRelease={resumeRelease}
                  runId={v.run}
                  target={target}
                  targetErrors={targetErrors}
                  query={v.ownerQuery}
                  owner={v.owner}
                  label={v.ownerLabel}
                  owners={owners}
                  state={s1 ? 'complete' : 'current'}
                  onQuery={(q) => setV((o) => ({ ...o, ownerQuery: q, owner: '', ownerLabel: '' }))}
                  onPick={(u) =>
                    setV((o) => ({ ...o, owner: u.username, ownerLabel: ownerLabel(u) }))
                  }
                />
                <CredentialsStep
                  coupaUrl={v.coupaUrl}
                  coupaId={v.coupaId}
                  coupaSecret={v.coupaSecret}
                  onInput={set}
                  showSecret={showSecret}
                  onToggleSecret={() => setShowSecret((s) => !s)}
                  state={s2 ? 'complete' : s1 ? 'current' : undefined}
                />
                <Step
                  n={3}
                  state="optional"
                  title={
                    <>
                      Test the Coupa login <span class={styles.tag}>optional</span>
                    </>
                  }
                  sub="The checks log in to Coupa once with the client ID and secret, so a wrong secret or a missing scope stops the run before anything is written. The deploy itself does not need this test."
                >
                  <CoupaLoginStep
                    route={route}
                    probe={probe}
                    probePage={probe && hookPage(probe)}
                    busy={busy}
                    onRoute={setRoute}
                    onCreate={() => probeAction(true)}
                    onRemove={() => probeAction(false)}
                  />
                </Step>
                <DeployStep
                  runId={v.run}
                  allow={v.allow}
                  onRunIdInput={set('run')}
                  onAllowChange={set('allow')}
                  ready={ready}
                  busy={busy}
                  state={s1 && s2 && !mode ? 'current' : undefined}
                  deployRef={deployRef}
                  resumeRef={resumeRef}
                />
              </fieldset>
            </form>
            {runView && (
              <div ref={resultRef}>
                <Step
                  n={runView.running ? '…' : runView.failed ? '!' : 5}
                  state={runView.running ? 'current' : runView.failed ? undefined : 'complete'}
                  title={runTitle(runView, runRelease)}
                  meta={runView.running ? clock : status}
                >
                  <RunResult run={runView} />
                </Step>
              </div>
            )}
          </div>
        </div>
      </main>
      {help}
    </div>
  );
}
