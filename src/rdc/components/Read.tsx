// Step 2: rdc's sync engine, in the browser, reads both orgs into one in-memory project. Each
// is a `sync` with `noPush: true`, the only option ever passed, so nothing is written to either
// org. The project is freed when the read ends; nothing is kept.
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { answerFor, envInputFor } from '../core.js';
import {
  KINDS,
  SOURCE_ENV,
  TARGET_ENV,
  countKinds,
  sourceEnvInput,
  type Kind,
  type Source,
} from '../deploy.js';
import { parseAnsi, type AnsiStyle } from '../ansi.js';
import type { Prompt, Rdc } from '../wasm.js';
import { currentOrg } from '../../rossum/orgName.js';
import { isRateLimited, rateLimitMessage } from '../../net/rateLimit.js';
import styles from './Deploy.module.css';

// One SGR style as inline CSS. Dim is opacity, not a grey, so it stays readable in both themes.
export function css(st: AnsiStyle): Record<string, string> {
  const o: Record<string, string> = {};
  if (st.color) o.color = st.color;
  if (st.bold) o.fontWeight = '600';
  if (st.dim) o.opacity = '0.6';
  if (st.italic) o.fontStyle = 'italic';
  if (st.underline) o.textDecoration = 'underline';
  return o;
}

// A log line from rdc, its colour rendered as spans: text nodes only, never HTML.
export function LogLine({ line }: { line: string }) {
  return (
    <div class={styles.logLine}>
      {parseAnsi(line).map((seg) => (
        <span style={css(seg.style)}>{seg.text}</span>
      ))}
    </div>
  );
}

export type Counts = { source: Record<Kind, number>; target: Record<Kind, number> };

type Props = {
  rdc: Rdc | null;
  rdcError: string;
  source: Source;
  sourceToken: string;
  domain: string;
  token: string;
  organizations: () => Promise<unknown>;
  onDone: (counts: Counts) => void;
};

type Pending = { prompt: Prompt; answer: (key: string | null) => void };

const total = (c: Record<Kind, number>) => KINDS.reduce((n, k) => n + c[k.kind], 0);

export default function Read({
  rdc,
  rdcError,
  source,
  sourceToken,
  domain,
  token,
  organizations,
  onDone,
}: Props) {
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [targetName, setTargetName] = useState('');
  const [sourceLog, setSourceLog] = useState<string[]>([]);
  const [targetLog, setTargetLog] = useState<string[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  // The latest callbacks, so a read started once is not restarted by a parent re-render.
  const latest = useRef({ organizations });
  latest.current = { organizations };

  useEffect(() => {
    if (!rdc) return;
    let alive = true;
    const ask = (prompt: Prompt) =>
      new Promise<string | null>((resolve) => {
        const p: Pending = {
          prompt,
          answer: (key) => {
            if (pendingRef.current === p) pendingRef.current = null;
            if (alive) setPending(null);
            resolve(answerFor(prompt, key));
          },
        };
        pendingRef.current = p;
        if (alive) setPending(p);
      });
    (async () => {
      setBusy(true);
      setError('');
      setCounts(null);
      setSourceLog([]);
      setTargetLog([]);
      try {
        const orgs = await latest.current.organizations();
        if (!alive) return;
        const target = envInputFor(domain, token, orgs, TARGET_ENV);
        if (typeof target === 'string') throw new Error(target);
        setTargetName(currentOrg(orgs)?.name ?? '');
        const src = sourceEnvInput(source, sourceToken);
        if (typeof src === 'string') throw new Error(src);
        const project = rdc.Project.create('console', target);
        try {
          project.addEnv(src);
          await project.sync(SOURCE_ENV, { noPush: true }, ask, (l) => {
            if (alive) setSourceLog((x) => [...x, l]);
          });
          await project.sync(TARGET_ENV, { noPush: true }, ask, (l) => {
            if (alive) setTargetLog((x) => [...x, l]);
          });
          const files = project.files();
          if (alive)
            setCounts({
              source: countKinds(files, SOURCE_ENV),
              target: countKinds(files, TARGET_ENV),
            });
        } finally {
          project.free();
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
      // a prompt left open when the page goes reads as "no answer", so a sync never hangs
      pendingRef.current?.answer(null);
    };
  }, [rdc, attempt, source, sourceToken, domain, token]);

  const noRdc = !rdc;
  const noRdcText = rdcError || 'rdc is not in this build.';
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
          {targetName || 'this org'}. Nothing is written yet.
        </p>
      </div>
      {noRdc && (
        <div class={`${styles.note} ${styles.err}`} role="alert">
          {noRdcText}
        </div>
      )}
      {error && (
        <div class={`${styles.note} ${styles.err}`} role="alert">
          <span>{error}</span>
          <button
            class="btn btn-secondary"
            disabled={busy}
            onClick={() => setAttempt((a) => a + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <div class={styles.grid2}>
        {panel(source.name, sourceLog, counts?.source ?? null)}
        {panel(targetName || 'This org', targetLog, counts?.target ?? null)}
      </div>
      {pending && (
        <div class={`${styles.panel} ${styles.ask}`} role="dialog" aria-label="rdc asks">
          <div class={styles.panelB}>
            <div class={styles.question}>{pending.prompt.question}</div>
            <div class={styles.choices}>
              {pending.prompt.choices.map((c) => (
                <button class="btn btn-secondary" onClick={() => pending.answer(c.key)}>
                  {c.label}
                </button>
              ))}
              <button class="btn btn-secondary" onClick={() => pending.answer(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div class={styles.foot}>
        <span class={styles.sp}></span>
        <button
          class="btn btn-primary"
          disabled={!counts || noRdc}
          title={noRdc ? noRdcText : undefined}
          onClick={() => counts && onDone(counts)}
        >
          Plan the deployment
        </button>
      </div>
    </div>
  );
}
