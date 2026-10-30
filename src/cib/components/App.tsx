// src/cib/components/App.tsx
// CIB deploy: creates the Coupa Integration Baseline in the connected org with the JS engine
// (src/cib/engine.ts + cib.ts). The release is read from GitHub when a run starts (release.ts);
// the extension holds no CIB objects. The console's own Rossum session is the auth. The Coupa secret
// stays in this component's memory; the Data Storage checkpoint holds only placeholders.
// One column of numbered steps (design: 2026-10-30-cib-deploy-ux-refinement-design.md). The layout
// changed, the requests did not: every effect and engine call below is the one the form had before.
import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { domain, token } from '../store.js';
import { connectedOrg } from '../../console/store.js';
import { makeClient } from '../engine.js';
import type { Progress } from '../engine.js';
import {
  deployCib,
  deployCoupaProbe,
  findCoupaProbes,
  REGIONS,
  teardownCoupaProbes,
  verdict,
} from '../cib.js';
import { CIB_REPO, listReleases, loadRelease, TOOL_REF, TOOL_REFS } from '../release.js';
import { stopNote, trackPhase } from '../view.js';
import type { LoginRoute, PhaseLog } from '../view.js';
import Step from './Step.jsx';
import OwnerCombobox, { ownerLabel } from './OwnerCombobox.jsx';
import type { Owner } from './OwnerCombobox.jsx';
import CoupaLoginStep from './CoupaLoginStep.jsx';
import RunResult, { runTitle } from './RunResult.jsx';
import type { RunView } from './RunResult.jsx';
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
    version: '',
    org: '',
    region: REGIONS[0],
    toolRef: TOOL_REF,
    owner: '',
    ownerQuery: '',
    ownerLabel: '',
    coupaUrl: '',
    coupaId: '',
    coupaSecret: '',
    run: `cib-${new Date().toISOString().slice(0, 10)}`,
    allow: false,
  });
  // the org id the session filled in, so the form can say so while it is unchanged
  const [sessionOrg, setSessionOrg] = useState('');
  // url of the Coupa check function in the org, while the user keeps it deployed
  const [probe, setProbe] = useState<string | null>(null);
  // which login route step 3 shows; UI only, the engine picks the function whenever it exists
  const [route, setRoute] = useState<LoginRoute>('browser');
  // token owner choices: active admins of the target org; `search` matches username, names and
  // email in part, without case (users API, checked on a test org 2026-10-20)
  const [owners, setOwners] = useState<Owner[]>([]);
  const adminIds = useRef<Promise<string> | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
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
  const resultRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const deployRef = useRef<HTMLButtonElement>(null);
  const resumeRef = useRef<HTMLDetailsElement>(null);
  const tLast = useRef(0);
  const set = (k: string) => (e: any) =>
    setV((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  useEffect(() => {
    if (!connected) return;
    // the org id, when the session sees exactly one organization
    makeClient(domain.value, token.value)
      .call('GET', 'organizations?page_size=2')
      .then((r) => {
        const res = r.data?.results;
        if (res?.length === 1) {
          setSessionOrg(String(res[0].id));
          setV((o) => (o.org ? o : { ...o, org: String(res[0].id) }));
        }
      });
    findCoupaProbes(makeClient(domain.value, token.value)).then(([h]) => {
      setProbe(h?.url ?? null);
      if (h) setRoute('org');
    });
    listReleases()
      .then((vs) => {
        setVersions(vs);
        setV((o) => (vs.includes(o.version) ? o : { ...o, version: vs[0] ?? '' }));
      })
      .catch((e) =>
        setError(`could not list the CIB releases of github.com/${CIB_REPO}: ${e.message}`),
      );
  }, [connected]);

  useEffect(() => {
    if (!connected || !/^\d+$/.test(v.org)) return setOwners([]);
    const c = makeClient(domain.value, token.value);
    adminIds.current ??= c.list('groups').then((gs) =>
      gs
        .filter((g) => ADMIN_GROUPS.includes(g.name))
        .map((g) => g.id)
        .join(','),
    );
    const t = setTimeout(async () => {
      const q = new URLSearchParams({
        organization: v.org,
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
  }, [connected, v.org, v.ownerQuery]);

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
          </div>
        </main>
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
      line(`${checkOnly ? 'check' : 'deploy'} CIB ${v.version} into organization ${v.org}`);
      const progress = (p: Progress) => {
        tLast.current = Date.now();
        setProg(p);
        setPhases((l) => trackPhase(l, p));
        setStatus(`${PHASES[p.phase] ?? p.phase}: ${p.done} / ${p.total}`);
      };
      const { deployConfig, ...rel } = await loadRelease(v.version, {
        onProgress: progress,
        toolRef: v.toolRef,
      });
      line(
        `read ${v.version} from github.com/${CIB_REPO}: ${rel.plan.ops.length} objects; deploy settings from ${deployConfig}`,
      );
      const r = await deployCib(makeClient(domain.value, token.value), {
        ...rel,
        orgId: +v.org,
        run: v.run.trim(),
        region: v.region,
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

  const s1 = !!(v.version && v.org && v.region && v.owner);
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
                  Reads a CIB release from{' '}
                  <a href={`https://github.com/${CIB_REPO}`} target="_blank" rel="noreferrer">
                    github.com/{CIB_REPO}
                  </a>{' '}
                  and creates it in the connected organization.
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
                <Step
                  n={1}
                  state={s1 ? 'complete' : 'current'}
                  title="Release and organization"
                  sub="Which CIB release goes where, and which admin the hooks run as."
                >
                  <div class={styles.g3}>
                    <div class={styles.field}>
                      <label class={styles.label} for="cib-version">
                        CIB version
                      </label>
                      <select
                        id="cib-version"
                        class={`input ${styles.input}`}
                        value={v.version}
                        onChange={set('version')}
                      >
                        {versions.map((o) => (
                          <option value={o}>{o}</option>
                        ))}
                      </select>
                      <span class={styles.hint}>
                        Newest first
                        {v.version && (
                          <>
                            {' · '}
                            <a
                              href={`https://github.com/${CIB_REPO}/releases/tag/${v.version}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              release notes ↗
                            </a>
                          </>
                        )}
                      </span>
                    </div>
                    <div class={styles.field}>
                      <label class={styles.label} for="cib-org">
                        Organization ID
                      </label>
                      <input
                        id="cib-org"
                        class={`input ${styles.input}`}
                        type="text"
                        required
                        value={v.org}
                        onInput={set('org')}
                      />
                      {sessionOrg && v.org === sessionOrg && (
                        <span class={`${styles.hint} ${styles.hintOk}`}>
                          ✓ Filled from your session
                        </span>
                      )}
                    </div>
                    <div class={styles.field}>
                      <label class={styles.label} for="cib-region">
                        Region
                      </label>
                      <select
                        id="cib-region"
                        class={`input ${styles.input}`}
                        value={v.region}
                        onChange={set('region')}
                      >
                        {REGIONS.map((o) => (
                          <option value={o}>{o}</option>
                        ))}
                      </select>
                      <span class={styles.hint}>
                        Must match the org's location. Check verifies it.
                      </span>
                    </div>
                  </div>
                  {/^v1\./.test(v.version) && (
                    <div class={styles.field}>
                      <label class={styles.label} for="cib-tool">
                        Deploy tool (v1.x settings)
                      </label>
                      <select
                        id="cib-tool"
                        class={`input ${styles.input} ${styles.narrow}`}
                        value={v.toolRef}
                        onChange={set('toolRef')}
                      >
                        {TOOL_REFS.map((o) => (
                          <option value={o}>{o}</option>
                        ))}
                      </select>
                      <span class={styles.hint}>
                        v1.x releases take their deploy settings from this tag of the deploy tool.
                      </span>
                    </div>
                  )}
                  <OwnerCombobox
                    query={v.ownerQuery}
                    owner={v.owner}
                    label={v.ownerLabel}
                    owners={owners}
                    orgId={v.org}
                    onQuery={(q) =>
                      setV((o) => ({ ...o, ownerQuery: q, owner: '', ownerLabel: '' }))
                    }
                    onPick={(u) =>
                      setV((o) => ({ ...o, owner: u.username, ownerLabel: ownerLabel(u) }))
                    }
                  />
                </Step>
                <Step
                  n={2}
                  state={s2 ? 'complete' : s1 ? 'current' : undefined}
                  title="Coupa credentials"
                  sub="The OAuth client the CIB hooks use to call Coupa."
                  footer={
                    <>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <rect x="4" y="11" width="16" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                      The secret stays in this page's memory. The deploy checkpoint stores only a
                      placeholder.
                    </>
                  }
                >
                  <div class={styles.field}>
                    <label class={styles.label} for="cib-coupa-url">
                      Coupa URL
                    </label>
                    <input
                      id="cib-coupa-url"
                      class={`input ${styles.input}`}
                      type="text"
                      required
                      placeholder="https://example.coupahost.com"
                      value={v.coupaUrl}
                      onInput={set('coupaUrl')}
                    />
                  </div>
                  <div class={styles.g2}>
                    <div class={styles.field}>
                      <label class={styles.label} for="cib-coupa-id">
                        Client ID
                      </label>
                      <input
                        id="cib-coupa-id"
                        class={`input ${styles.input}`}
                        type="text"
                        required
                        value={v.coupaId}
                        onInput={set('coupaId')}
                      />
                    </div>
                    <div class={styles.field}>
                      <label class={styles.label} for="cib-coupa-secret">
                        Client secret
                      </label>
                      <div class={styles.inputWrap}>
                        <input
                          id="cib-coupa-secret"
                          class={`input ${styles.input} ${styles.hasToggle}`}
                          type={(showSecret ? 'text' : 'password') as 'text'}
                          required
                          autocomplete="off"
                          value={v.coupaSecret}
                          onInput={set('coupaSecret')}
                        />
                        <button
                          type="button"
                          class={styles.eye}
                          onClick={() => setShowSecret((s) => !s)}
                        >
                          {showSecret ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>
                  </div>
                </Step>
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
                <Step
                  n={4}
                  state={s1 && s2 && !mode ? 'current' : undefined}
                  title="Deploy"
                  sub={
                    <>
                      <b>Check and deploy</b> runs the checks first and writes nothing if one fails.{' '}
                      <b>Check only</b> runs the checks and stops.
                    </>
                  }
                >
                  <details class={styles.resume} ref={resumeRef}>
                    <summary>
                      Resume and re-run · run ID <code>{v.run}</code>
                    </summary>
                    <div class={styles.g2}>
                      <div class={styles.field}>
                        <label class={styles.label} for="cib-run">
                          Run ID
                        </label>
                        <input
                          id="cib-run"
                          class={`input ${styles.input}`}
                          type="text"
                          required
                          value={v.run}
                          onInput={set('run')}
                          // a closed <details> hides it, and Chrome cannot point at a hidden field
                          onInvalid={() => resumeRef.current && (resumeRef.current.open = true)}
                        />
                        <span class={styles.hint}>
                          Deploy saves its progress under this ID. Deploy again with the same ID to
                          resume; a resumed run skips the checks.
                        </span>
                      </div>
                      <label class={styles.checkbox}>
                        <input type="checkbox" checked={v.allow} onChange={set('allow')} />
                        <span>
                          Continue a half-built deploy
                          <span class={styles.hint}>
                            Adopt CIB objects already in the org by name, instead of stopping at
                            them.
                          </span>
                        </span>
                      </label>
                    </div>
                  </details>
                  <div class={styles.actions}>
                    <button
                      class={`btn ${styles.btnLg}`}
                      name="check"
                      disabled={busy || !v.version}
                    >
                      Check only
                    </button>
                    <button
                      class={`btn btn-primary ${styles.btnLg} ${styles.deployBtn}`}
                      name="deploy"
                      ref={deployRef}
                      disabled={busy || !v.version}
                    >
                      Check and deploy
                    </button>
                  </div>
                </Step>
              </fieldset>
            </form>
            {runView && (
              <div ref={resultRef}>
                <Step
                  n={runView.running ? '…' : runView.failed ? '!' : 5}
                  state={runView.running ? 'current' : runView.failed ? undefined : 'complete'}
                  title={runTitle(runView, v.version)}
                  meta={runView.running ? clock : status}
                >
                  <RunResult run={runView} />
                </Step>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
