// rdc (experimental): rdc's sync engine, built to WebAssembly, run in the Console against the
// connected organization. ONE pull — `sync` with `noPush: true`, so nothing is written to the
// org — into a project held only in memory, then the pulled tree and the log. A prompt rdc
// raises is shown with its choices and waits for the user; Cancel answers "no answer".
// Proof of concept behind the experimental gate; see src/rdc/wasm.ts for how the build loads.
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { domain, token } from '../store.js';
import { connectedOrg } from '../../console/store.js';
import { ENV, answerFor, envInputFor, treeRows, type TreeRow } from '../core.js';
import { parseAnsi, type AnsiStyle } from '../ansi.js';
import { loadRdc, type CycleOutcome, type Prompt, type Rdc } from '../wasm.js';
import styles from './App.module.css';

const host = (d: string) => {
  try {
    return new URL(d).host;
  } catch {
    return d;
  }
};

// One SGR style as inline CSS. Dim is opacity, not a grey, so it stays readable in both themes.
function css(st: AnsiStyle): Record<string, string> {
  const o: Record<string, string> = {};
  if (st.color) o.color = st.color;
  if (st.bold) o.fontWeight = '600';
  if (st.dim) o.opacity = '0.6';
  if (st.italic) o.fontStyle = 'italic';
  if (st.underline) o.textDecoration = 'underline';
  return o;
}

// A log line from rdc, its colour rendered as spans — text nodes only, never HTML.
function LogLine({ line }: { line: string }) {
  return (
    <div class={styles.logLine}>
      {parseAnsi(line).map((seg) => (
        <span style={css(seg.style)}>{seg.text}</span>
      ))}
    </div>
  );
}

type Pending = { prompt: Prompt; answer: (key: string | null) => void };

async function organizations(d: string, t: string): Promise<unknown> {
  const res = await fetch(`${d}/api/v1/organizations`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(`GET /api/v1/organizations: HTTP ${res.status}`);
  return res.json();
}

export default function App({ connected }: { connected: boolean | null }) {
  // undefined while loading, null when it failed to load (the error says why)
  const [rdc, setRdc] = useState<Rdc | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [rows, setRows] = useState<TreeRow[] | null>(null);
  const [outcome, setOutcome] = useState<CycleOutcome | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  useEffect(() => {
    loadRdc().then(setRdc, (e: any) => {
      setRdc(null);
      setError(`rdc wasm did not load: ${e?.message || e}`);
    });
    // a prompt left open when the app unmounts reads as "no answer", so a sync never hangs
    return () => pendingRef.current?.answer(null);
  }, []);

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

  const ask = (prompt: Prompt) =>
    new Promise<string | null>((resolve) => {
      const p: Pending = {
        prompt,
        answer: (key) => {
          pendingRef.current = null;
          setPending(null);
          resolve(answerFor(prompt, key));
        },
      };
      pendingRef.current = p;
      setPending(p);
    });

  const pull = async () => {
    if (!rdc) return;
    setBusy(true);
    setError('');
    setLog([]);
    setRows(null);
    setOutcome(null);
    try {
      const env = envInputFor(
        domain.value,
        token.value,
        await organizations(domain.value, token.value),
        ENV,
      );
      if (typeof env === 'string') throw new Error(env);
      const project = rdc.Project.create('console', env);
      try {
        const o = await project.sync(ENV, { noPush: true }, ask, (line) =>
          setLog((l) => [...l, line]),
        );
        setOutcome(o);
        setRows(treeRows(project.files()));
      } finally {
        project.free();
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="app-root">
      <main class="main">
        <div class="connection-bar">
          <span class={'connection-dot' + (busy ? ' busy' : '')}></span>
          rdc (experimental) · Connected to {host(domain.value)}
          {connectedOrg.value ? ` · ${connectedOrg.value}` : ''}
          {rdc ? ` · rdc ${rdc.version()}` : ''}
        </div>
        {error && (
          <div class="error-banner">
            <span>{error}</span>
          </div>
        )}
        <div class={styles.body}>
          {rdc === undefined && <div class="empty-state">Loading rdc{'…'}</div>}
          {rdc && (
            <section class={styles.card}>
              <p class={styles.muted}>
                Pulls the connected organization into a project held in memory only. Nothing is
                written to the organization, nothing is kept after a reload.
              </p>
              <button class="btn btn-primary" disabled={busy} onClick={pull}>
                {busy ? 'Pulling…' : 'Pull'}
              </button>
            </section>
          )}
          {pending && (
            <section class={styles.card} role="dialog" aria-label="rdc asks">
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
            </section>
          )}
          {outcome && (
            <section class={styles.card}>
              Pulled {outcome.itemsPulled} items · {outcome.fileCount} files · {outcome.conflicts}{' '}
              conflicts
            </section>
          )}
          {log.length > 0 && (
            <section class={styles.card}>
              <div class={styles.title}>Log</div>
              <div class={styles.log}>
                {log.map((line) => (
                  <LogLine line={line} />
                ))}
              </div>
            </section>
          )}
          {rows && (
            <section class={styles.card}>
              <div class={styles.title}>Files</div>
              <ul class={styles.tree}>
                {rows.map((r) => (
                  <li key={r.key} style={{ paddingLeft: `${r.depth * 16}px` }}>
                    {r.dir ? `${r.name}/` : r.name}
                    {!r.dir && <span class={styles.muted}> {r.size} B</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
