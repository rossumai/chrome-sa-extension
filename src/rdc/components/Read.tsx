// Step 2: rdc's sync engine, in the browser, reads both orgs into one project. Each read is a
// `sync` with `noPush: true`, so no configuration is written; rdc keeps each env's sync state and
// tree in that env's own org (`keepStateInOrgs`), so they survive a refresh. Every read of the
// target moves rdc's base, after which rdc no longer sees an edit made directly in the target; so
// the target is first loaded with a dry run (which writes nothing), and the files that changed
// between the two are remembered as direct edits until a Write. A finished read hands its
// project to the page for the Plan; otherwise the project is freed here.
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { answerFor, diffEnvTree, envInputFor, isFirstRead } from '../core.js';
import {
  KINDS,
  STATE_COLLECTION,
  keepStateInOrgs,
  SOURCE_ENV,
  TARGET_ENV,
  countKinds,
  sourceEnvInput,
  type Kind,
  type Source,
} from '../deploy.js';
import type { Prompt, Rdc, RdcProject } from '../wasm.js';
import {
  addDirectEdits,
  dataStorageFor,
  loadMapping,
  saveMapping,
  type DataStorage,
} from '../sourceStore.js';
import { MAPPING_PATH, readMapping } from '../plan.js';
import { currentOrg } from '../../rossum/orgName.js';
import { isRateLimited, rateLimitMessage } from '../../net/rateLimit.js';
import { OVERLAY_PATH, readHookTokenOwner } from '../tokenOwner.js';
import { AskPanel } from './Ask.jsx';
import { LogLine } from './Log.jsx';
import { explainRunError, tracked } from '../runs.js';
import styles from './Deploy.module.css';

export type Counts = { source: Record<Kind, number>; target: Record<Kind, number> };

// A finished read, kept by the page so going back to this step shows it without syncing again.
export type ReadResult = {
  counts: Counts;
  sourceLog: string[];
  targetLog: string[];
  targetName: string;
  // rdc keeps its sync state in each org; false with a build that cannot (then nothing is kept).
  persisted: boolean;
  // No stored tree for the target yet: this read is its baseline.
  firstRead: boolean;
  // Target files changed directly in the org since the last deployment.
  directEdits: string[];
  // Why the direct edits could not be loaded or saved, or empty.
  editsNote: string;
  // The hooks' token owner stored in the target's overlay, or null.
  tokenOwner: string | null;
  // The read's project, owned by the page from here on (it frees it). Absent on a kept read
  // handed back to this step.
  project?: RdcProject;
};

type Found = Omit<ReadResult, 'counts' | 'sourceLog' | 'targetLog' | 'targetName' | 'project'>;

type Props = {
  rdc: Rdc | null;
  rdcError: string;
  // rdc is still loading: shown as a neutral status, not an error.
  rdcLoading?: boolean;
  source: Source;
  sourceToken: string;
  domain: string;
  token: string;
  // The `GET /organizations` answer the page already resolved the target from.
  organizations: unknown;
  // The target org's Data Storage, where the direct edits are remembered.
  dataStorage: DataStorage;
  // Data Storage in rdc's state collection of the org at a domain, with a token. Injectable for
  // tests; production calls the org.
  stateStorage?: (domain: string, token: string) => DataStorage;
  // A finished read to show instead of syncing; "Read again" starts a fresh one.
  kept?: ReadResult | null;
  onDone: (result: ReadResult) => void;
  onBack: () => void;
  onCancel: () => void;
};

// A prompt from one env's run; `env` says which org it is about.
type Pending = { env: string; prompt: Prompt; answer: (key: string | null) => void };

const total = (c: Record<Kind, number>) => KINDS.reduce((n, k) => n + c[k.kind], 0);

export default function Read({
  rdc,
  rdcError,
  rdcLoading = false,
  source,
  sourceToken,
  domain,
  token,
  organizations,
  dataStorage,
  stateStorage = (d, t) => dataStorageFor(d, t, STATE_COLLECTION),
  kept,
  onDone,
  onBack,
  onCancel,
}: Props) {
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setErrorText] = useState('');
  // The page's words for rdc's error, decided when it arrives.
  const [hint, setHint] = useState<string | null>(null);
  const setError = (m: string) => {
    setErrorText(m);
    setHint(m ? explainRunError(m) : null);
  };
  const [targetName, setTargetName] = useState(kept?.targetName ?? '');
  const [sourceLog, setSourceLog] = useState<string[]>(kept?.sourceLog ?? []);
  const [targetLog, setTargetLog] = useState<string[]>(kept?.targetLog ?? []);
  const [counts, setCounts] = useState<Counts | null>(kept?.counts ?? null);
  const [found, setFound] = useState<Found | null>(
    kept
      ? {
          persisted: kept.persisted,
          firstRead: kept.firstRead,
          directEdits: kept.directEdits,
          editsNote: kept.editsNote,
          tokenOwner: kept.tokenOwner,
        }
      : null,
  );
  // The finished read's project until it is handed to the page or freed.
  const projectRef = useRef<RdcProject | null>(null);
  // Each env's last log line, shown above its prompt: rdc's question may be only its menu of keys.
  const [lastLine, setLastLine] = useState<Record<string, string>>({});
  // Only the first run may be skipped: a kept read is shown until the admin asks for a new one.
  const skipFirst = useRef(!!kept);
  // The prompt shown, the first of those waiting: the two reads run at once, so both can ask, and
  // they are answered one at a time in the order they asked.
  const [pending, setPending] = useState<Pending | null>(null);
  const queueRef = useRef<Pending[]>([]);

  useEffect(() => {
    if (!rdc) return;
    if (attempt === 0 && skipFirst.current) return;
    let alive = true;
    const ask = (env: string) => (prompt: Prompt) =>
      new Promise<string | null>((resolve) => {
        // a run the page has left asks nothing: it reads as "no answer" at once
        if (!alive) return resolve(null);
        const p: Pending = {
          env,
          prompt,
          answer: (key) => {
            queueRef.current = queueRef.current.filter((x) => x !== p);
            if (alive) setPending(queueRef.current[0] ?? null);
            resolve(answerFor(prompt, key));
          },
        };
        queueRef.current = [...queueRef.current, p];
        if (alive) setPending(queueRef.current[0]);
      });
    (async () => {
      setBusy(true);
      setError('');
      setCounts(null);
      setFound(null);
      setSourceLog([]);
      setTargetLog([]);
      projectRef.current?.free();
      projectRef.current = null;
      const srcLog = (l: string) => {
        if (alive) setSourceLog((x) => [...x, l]);
        if (alive) setLastLine((x) => ({ ...x, [SOURCE_ENV]: l }));
      };
      const tgtLog = (l: string) => {
        if (alive) setTargetLog((x) => [...x, l]);
        if (alive) setLastLine((x) => ({ ...x, [TARGET_ENV]: l }));
      };
      try {
        const target = envInputFor(domain, token, organizations, TARGET_ENV);
        if (typeof target === 'string') throw new Error(target);
        setTargetName(currentOrg(organizations)?.name ?? '');
        const src = sourceEnvInput(source, sourceToken);
        if (typeof src === 'string') throw new Error(src);
        const project = rdc.Project.create('console', target);
        let handed = false;
        try {
          project.addEnv(src);
          const persisted = keepStateInOrgs(
            project,
            {
              source: stateStorage(source.domain, sourceToken),
              target: stateStorage(domain, token),
            },
            target.orgId,
          );
          // rdc leaves the slug mapping to the host. A mapping that cannot be loaded stops the
          // read: migrating without it would delete and re-create every renamed object.
          const mapping = persisted ? await loadMapping(dataStorage, source) : null;
          if (mapping !== null) project.writeFile(MAPPING_PATH, new TextEncoder().encode(mapping));
          if (!alive) return;
          // The source read and the target pair run at once; the target's dry run must come
          // before its pull, for the direct-edit diff. When one fails, the other is left to finish:
          // rdc cannot abort a running sync, and a finished read has saved its state.
          const sourceRun = tracked(
            project.sync(SOURCE_ENV, { noPush: true }, ask(SOURCE_ENV), srcLog),
          );
          const targetRun = (async () => {
            // The target as the last run left it: a dry run loads the stored state and tree only.
            let before: Map<string, Uint8Array> | null = null;
            if (persisted) {
              await tracked(project.sync(TARGET_ENV, { dryRun: true }, ask(TARGET_ENV), tgtLog));
              // left: start nothing more
              if (!alive) return null;
              before = project.files();
            }
            await tracked(project.sync(TARGET_ENV, { noPush: true }, ask(TARGET_ENV), tgtLog));
            return before;
          })();
          const [s, t] = await Promise.allSettled([sourceRun, targetRun]);
          if (!alive) return;
          if (s.status === 'rejected' || t.status === 'rejected') {
            const outcome = (name: string, r: PromiseSettledResult<unknown>) =>
              r.status === 'fulfilled'
                ? `Reading ${name} finished.`
                : `Reading ${name} failed: ${isRateLimited(r.reason) ? rateLimitMessage(r.reason) : String((r.reason as Error)?.message || r.reason)}`;
            throw new Error(
              `${outcome(source.name, s)} ${outcome(currentOrg(organizations)?.name || 'this org', t)}`,
            );
          }
          const before = t.value;
          const files = project.files();
          const firstRead = !!before && isFirstRead(before, TARGET_ENV);
          const seen =
            before && !firstRead ? diffEnvTree(before, files, TARGET_ENV).map((c) => c.path) : [];
          let directEdits = seen;
          let editsNote = '';
          if (persisted) {
            // A sync that follows a hand rename adds a row to the mapping. Losing it is as bad
            // as not loading it, so a failed save fails the read.
            const now = readMapping(files);
            if (now !== null && now !== mapping) {
              try {
                await saveMapping(dataStorage, source, now);
              } catch (e) {
                throw new Error(
                  `The slug mapping could not be saved in this org: ${String((e as Error)?.message || e)}`,
                );
              }
            }
            try {
              directEdits = await addDirectEdits(
                dataStorage,
                `chrome-sa-extension:rdc-deployments:${target.apiBase}:${target.orgId}`,
                seen,
              );
            } catch (e) {
              editsNote = `The direct edits could not be remembered in this org, so they are shown for this visit only: ${String((e as Error)?.message || e)}`;
            }
          }
          if (!alive) return;
          setCounts({
            source: countKinds(files, SOURCE_ENV),
            target: countKinds(files, TARGET_ENV),
          });
          const overlay = files.get(OVERLAY_PATH);
          const tokenOwner = overlay ? readHookTokenOwner(new TextDecoder().decode(overlay)) : null;
          setFound({ persisted, firstRead, directEdits, editsNote, tokenOwner });
          projectRef.current = project;
          handed = true;
        } finally {
          if (!handed) project.free();
        }
      } catch (e) {
        if (alive)
          setError(isRateLimited(e) ? rateLimitMessage(e) : String((e as Error)?.message || e));
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
      // prompts left open when the page goes read as "no answer", so no sync hangs
      for (const p of queueRef.current) p.answer(null);
    };
  }, [rdc, attempt, source, sourceToken, domain, token]);

  // A finished read that was not handed on is freed when the step goes.
  useEffect(
    () => () => {
      projectRef.current?.free();
      projectRef.current = null;
    },
    [],
  );

  const shortPath = (p: string) => p.slice(`envs/${TARGET_ENV}/`.length);

  const noRdc = !rdc;
  const noRdcText = rdcLoading ? `Loading rdc${'…'}` : rdcError || 'rdc is not in this build.';
  const panel = (title: string, log: string[], c: Record<Kind, number> | null) => (
    <div class={styles.panel}>
      <div class={styles.panelHead}>
        <h2>{title}</h2>
        <span class={styles.sp}></span>
        {c && <span class={styles.tag}>{total(c)} objects read</span>}
      </div>
      <div class={styles.panelB}>
        {c && (
          <ul class={styles.counts}>
            {KINDS.map((k) => (
              <li>
                {k.label} {c[k.kind]}
              </li>
            ))}
          </ul>
        )}
        <div class={styles.term} aria-label={`Log for ${title}`}>
          {log.map((line) => (
            <LogLine line={line} />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div class={`${styles.wrap} ${styles.wz}`}>
      <div class={styles.wzH}>
        <h1>Reading both orgs</h1>
        <p>
          The Console reads the current configuration of {source.name} and of{' '}
          {targetName || 'this org'}. rdc keeps what it read of each org in that org's own Data
          Storage, so the next visit starts from it. No configuration is changed.
        </p>
      </div>
      {noRdc && rdcLoading && (
        <div class={styles.note} role="status">
          {noRdcText}
        </div>
      )}
      {noRdc && !rdcLoading && (
        <div class={`${styles.note} ${styles.err}`} role="alert">
          {noRdcText}
        </div>
      )}
      {error && (
        <div class={`${styles.note} ${styles.err}`} role="alert">
          <span>
            {hint && <b>{hint} </b>}
            {error}
          </span>
          <button
            class="btn btn-secondary"
            disabled={busy}
            onClick={() => setAttempt((a) => a + 1)}
          >
            Retry
          </button>
        </div>
      )}
      {found && !found.persisted && (
        <div class={styles.note} role="note">
          This build of rdc cannot keep its sync state in the org, so nothing is kept after this
          visit, and nothing can be written.
        </div>
      )}
      {found?.firstRead && (
        <div class={styles.note} role="note">
          First read of {targetName || 'this org'}: its current configuration is now the baseline.
        </div>
      )}
      {found && found.directEdits.length > 0 && (
        <div class={styles.panel} aria-label="Direct edits">
          <div class={styles.panelHead}>
            <h2>Changed directly in {targetName || 'this org'} since the last deployment</h2>
            <span class={styles.sp}></span>
            <span class={styles.tag}>{found.directEdits.length}</span>
          </div>
          <div class={styles.panelB}>
            <ul class={styles.counts}>
              {found.directEdits.map((p) => (
                <li>{shortPath(p)}</li>
              ))}
            </ul>
            <p class={styles.muted}>
              A deployment overwrites these; Review lists them again before you write.
            </p>
          </div>
        </div>
      )}
      {found?.editsNote && (
        <div class={`${styles.note} ${styles.err}`} role="alert">
          {found.editsNote}
        </div>
      )}
      <div class={styles.grid2}>
        {panel(source.name, sourceLog, counts?.source ?? null)}
        {panel(targetName || 'This org', targetLog, counts?.target ?? null)}
      </div>
      {pending && (
        <AskPanel
          pending={pending}
          lastLine={lastLine[pending.env] ?? ''}
          about={pending.env === SOURCE_ENV ? source.name : targetName || 'this org'}
        />
      )}
      <div class={styles.foot}>
        <button class="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <span class={styles.sp}></span>
        <button class="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        {counts && !busy && !noRdc && (
          <button class="btn btn-secondary" onClick={() => setAttempt((a) => a + 1)}>
            Read again
          </button>
        )}
        <button
          class="btn btn-primary"
          disabled={!counts || !found || noRdc}
          title={noRdc ? noRdcText : undefined}
          onClick={() => {
            if (!counts || !found) return;
            const project = projectRef.current ?? undefined;
            projectRef.current = null;
            onDone({ counts, sourceLog, targetLog, targetName, ...found, project });
          }}
        >
          Plan the deployment
        </button>
      </div>
    </div>
  );
}
