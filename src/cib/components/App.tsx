// src/cib/components/App.tsx
// CIB deploy: creates the Coupa Integration Baseline in the connected org with the JS engine
// (src/cib/engine.ts + cib.ts). The release is read from GitHub when a run starts (release.ts);
// the extension holds no CIB objects. The console's own Rossum session is the auth. The Coupa secret
// stays in this component's memory; the Data Storage checkpoint holds only placeholders.
// Laid out like the Audit Log Viewer: connection bar, a filters-style form, then the output.
import { h } from 'preact';
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
} from '../cib.js';
import { CIB_REPO, listReleases, loadRelease, TOOL_REF, TOOL_REFS } from '../release.js';
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

const host = (d: string) => {
  try {
    return new URL(d).host;
  } catch {
    return d;
  }
};

type Outcome = { status: string; blockers?: string[]; notes: string[]; details: string };

export default function App({ connected }: { connected: boolean | null }) {
  const [v, setV] = useState<Record<string, any>>({
    version: '',
    org: '',
    region: REGIONS[0],
    toolRef: TOOL_REF,
    owner: '',
    ownerQuery: '',
    coupaUrl: '',
    coupaId: '',
    coupaSecret: '',
    run: `cib-${new Date().toISOString().slice(0, 10)}`,
    allow: false,
  });
  // url of the Coupa check function in the org, while the user keeps it deployed
  const [probe, setProbe] = useState<string | null>(null);
  // token owner choices: active admins of the target org; `search` matches username, names and
  // email in part, without case (users API, checked on a test org 2026-10-20)
  const [owners, setOwners] = useState<{ username: string; label: string }[]>([]);
  const adminIds = useRef<Promise<string> | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<Progress | null>(null);
  const [status, setStatus] = useState('Idle');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState('');
  const [log, setLog] = useState('');
  const [clock, setClock] = useState('');
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
        if (res?.length === 1) setV((o) => (o.org ? o : { ...o, org: String(res[0].id) }));
      });
    findCoupaProbes(makeClient(domain.value, token.value)).then(([h]) => setProbe(h?.url ?? null));
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
      const list = res.map((u: any) => ({
        username: u.username,
        label: [u.username, `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()]
          .filter(Boolean)
          .join(' · '),
      }));
      setOwners(list);
      setV((o) => {
        const keep = list.some((u: any) => u.username === o.owner);
        return { ...o, owner: keep ? o.owner : list.length === 1 ? list[0].username : '' };
      });
    }, 300);
    return () => clearTimeout(t);
  }, [connected, v.org, v.ownerQuery]);

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
    setLog((o) => `${o}${new Date().toLocaleTimeString()} ${l}\n`);
  };

  // deploy or tear down the Coupa check function; only on the user's click, never as a side effect
  const probeAction = async (deploy: boolean) => {
    setBusy(true);
    setError('');
    try {
      const c = makeClient(domain.value, token.value);
      if (deploy) {
        const h = await deployCoupaProbe(c);
        setProbe(h.url);
        line(`Coupa check function deployed: ${h.url}`);
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
    setProg(null);
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
      setOutcome({
        status,
        blockers,
        notes,
        details: JSON.stringify({ ...rest, objects: idmap && Object.keys(idmap).length }, null, 1),
      });
      setStatus(`Finished: ${status}`);
      // the locally remembered check function may have been deleted elsewhere (another
      // tab, a manual cleanup, a different target org); re-sync so the UI stops pointing
      // at a dead hook and "Deploy check function" becomes available again
      if (probe && notes.some((n) => n.includes('could not give the Coupa secret')))
        findCoupaProbes(makeClient(domain.value, token.value)).then(([h]) =>
          setProbe(h?.url ?? null),
        );
    } catch (err: any) {
      setError(`${err.message} — press Deploy again with the same run ID to resume`);
      setStatus('Stopped with an error');
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  };

  const text = (
    k: string,
    label: string,
    opts: { secret?: boolean; hint?: string; grow?: boolean } = {},
  ) => (
    <label class={opts.grow ? 'filter filter-grow' : 'filter'}>
      <span class="filter-label">{label}</span>
      {opts.secret ? (
        <input class="input" type="password" required value={v[k]} onInput={set(k)} />
      ) : (
        <input
          class="input"
          type="text"
          required={k !== 'ownerQuery'}
          placeholder={opts.hint}
          value={v[k]}
          onInput={set(k)}
        />
      )}
    </label>
  );
  const select = (k: string, label: string, options: string[]) => (
    <label class="filter">
      <span class="filter-label">{label}</span>
      <select class="input" value={v[k]} onChange={set(k)}>
        {options.map((o) => (
          <option value={o}>{o}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div class="app-root">
      <main class="main">
        <div class="connection-bar">
          <span class={'connection-dot' + (busy ? ' busy' : '')}></span>
          CIB deploy · Connected to {host(domain.value)}
          {connectedOrg.value ? ` · ${connectedOrg.value}` : ''}
        </div>
        {error && (
          <div class="error-banner">
            <span>{error}</span>
          </div>
        )}
        <form
          class="filters"
          onSubmit={(e: any) => {
            e.preventDefault();
            run(e.submitter?.name === 'check');
          }}
        >
          <div class={styles.formCard}>
            <div class={styles.stepHeader}>
              <span class={styles.stepBadge}>1</span>
              <span class={styles.stepTitle}>Target organization</span>
            </div>
            <div class="filters-row">
              {select('version', 'CIB version', versions)}
              {text('org', 'Organization ID')}
              {select('region', 'Region', REGIONS)}
              {/^v1\./.test(v.version) &&
                select('toolRef', 'Deploy tool (v1.x settings)', TOOL_REFS)}
            </div>
            <div class="filters-row">
              {text('ownerQuery', 'Find token owner', { hint: 'name or email of an admin' })}
              <label class="filter filter-grow">
                <span class="filter-label">Token owner (admin of the organization)</span>
                <select class="input" required value={v.owner} onChange={set('owner')}>
                  <option value="">{owners.length ? 'Select an admin' : 'No admin matches'}</option>
                  {owners.map((u) => (
                    <option value={u.username}>{u.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div class={styles.formCard}>
            <div class={styles.stepHeader}>
              <span class={styles.stepBadge}>2</span>
              <span class={styles.stepTitle}>Coupa credentials</span>
            </div>
            <div class={styles.credRow}>
              {text('coupaUrl', 'Coupa URL', { hint: 'https://example.coupahost.com' })}
              {text('coupaId', 'Coupa client ID')}
              {text('coupaSecret', 'Coupa client secret', { secret: true })}
            </div>
          </div>
          <details class={`${styles.formCard} ${styles.advanced}`} open={!!probe}>
            <summary class={styles.advancedSummary}>
              <span class={styles.stepBadgeMuted}>i</span>
              <span class={styles.stepTitle}>
                Coupa check function
                <span class={styles.optionalTag}>optional</span>
              </span>
              <span class={styles.chevron}>▾</span>
            </summary>
            <div class={`${styles.advancedBody} ${styles.checkRow}`}>
              <span class={styles.check}>
                {probe
                  ? `Deployed (${probe}): Check calls Coupa from it. It works only if the organization lets functions call HTTPS hosts.`
                  : 'Not deployed: Check calls Coupa directly from this browser instead. Deploy this only if that does not work for the organization.'}
              </span>
              <div class={styles.checkActions}>
                <button
                  type="button"
                  class="btn btn-secondary"
                  disabled={busy || !!probe}
                  onClick={() => probeAction(true)}
                >
                  Deploy check function
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  disabled={busy || !probe}
                  onClick={() => probeAction(false)}
                >
                  Tear down check function
                </button>
              </div>
            </div>
          </details>
          <div class={`${styles.formCard} ${styles.actionCard}`}>
            <div class="filters-row">
              {text('run', 'Run ID (re-use to resume)')}
              <label class={styles.checkboxLabel}>
                <input type="checkbox" checked={v.allow} onChange={set('allow')} />
                Continue a half-built deploy
              </label>
              <div class="filters-actions">
                <button class="btn btn-secondary" name="check" disabled={busy || !v.version}>
                  Check
                </button>
                <button
                  class={`btn btn-primary ${styles.deployBtn}`}
                  name="deploy"
                  disabled={busy || !v.version}
                >
                  Deploy
                </button>
              </div>
            </div>
          </div>
        </form>
        <div class={styles.body}>
          <section class={styles.card}>
            <div class={styles.status}>
              <span>{status}</span>
              <span class={styles.muted}>{clock}</span>
            </div>
            <progress
              class={styles.bar}
              max={prog?.total || 1}
              value={busy && !prog ? undefined : (prog?.done ?? 0)}
            />
            {prog?.detail && <div class={styles.muted}>{prog.detail}</div>}
          </section>
          {outcome && (
            <section class={styles.card}>
              <div class={styles.status}>
                <span class={styles[outcome.status] ?? ''}>{outcome.status}</span>
              </div>
              {outcome.blockers?.map((b) => (
                <div class={styles.blocker}>{b}</div>
              ))}
              {outcome.notes.map((n) => (
                <div class={styles.muted}>{n}</div>
              ))}
              {outcome.details !== '{}' && (
                <details>
                  <summary class={`${styles.muted} ${styles.detailsSummary}`}>Details</summary>
                  <pre class={styles.pre}>{outcome.details}</pre>
                </details>
              )}
            </section>
          )}
          {log && (
            <section class={styles.card}>
              <span class="filter-label">Log</span>
              <pre class={styles.pre}>{log}</pre>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
