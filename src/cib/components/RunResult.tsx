// src/cib/components/RunResult.tsx
// Step 5: what the last run did. Everything shown comes from the engine as it is (verdict(),
// blockers, notes, progress); this component only arranges it.
import { h, Fragment } from 'preact';
import { PHASES, phasePercent, phaseStates, splitVerdict, stopNote } from '../view.js';
import type { PhaseLog } from '../view.js';
import styles from './App.module.css';

export type RunView = {
  mode: 'check' | 'deploy';
  running: boolean;
  failed: boolean;
  // the message of the error a run threw
  error?: string;
  runId: string;
  status: string;
  clock: string;
  detail?: string;
  phases: PhaseLog;
  outcome: {
    status: string;
    verdict: { tone: 'ok' | 'warn' | 'fail'; text: string };
    blockers?: string[];
    notes: string[];
    details: string;
    stats?: { objects: number; started: number; invoked: number; pending: number };
  } | null;
  log: string;
  // a Coupa check function is still in the org
  probeLeft: boolean;
};

export const runTitle = (run: RunView, version: string): string => {
  if (run.running) return `${run.mode === 'deploy' ? 'Deploying' : 'Checking'} CIB ${version}`;
  if (run.failed && !run.outcome) return run.mode === 'deploy' ? 'Deploy stopped' : 'Check stopped';
  return run.mode === 'deploy' ? 'Deploy result' : 'Check result';
};

const ICON = { ok: '✓', warn: '!', fail: '✕' };

export default function RunResult({ run }: { run: RunView }) {
  const o = run.outcome;
  const states = phaseStates(run.phases, run.running ? 'running' : run.failed ? 'fail' : 'ok');
  const v = o && splitVerdict(o.verdict.text);
  const notes = [
    ...(o?.notes ?? []),
    ...(o?.status === 'done' && run.probeLeft
      ? ['The Coupa check function is still deployed. Remove it in step 3.']
      : []),
  ];
  const lines = run.log.trimEnd().split('\n').length;
  const copy = () => navigator.clipboard?.writeText(run.log).catch(() => {});
  return (
    <div class={styles.stepBody}>
      {run.running && (
        // one line of fixed height: release file paths differ in length on every progress event,
        // and a wrapping line moved everything below it. Cut at the START, where the repo and tag
        // repeat, so the file name stays readable
        <div class={`${styles.hint} ${styles.detail}`} title={run.detail} data-detail>
          <span dir="ltr">{run.detail}</span>
        </div>
      )}
      {run.error && !run.running && (
        <div class={`${styles.verdict} ${styles.fail}`} data-verdict>
          <span class={styles.verdictIco}>⏸</span>
          <div>
            <b>Stopped with an error</b>
            <div class={styles.errText}>{run.error}</div>
            <div>{stopNote(run.mode, run.phases.current, run.runId)}</div>
          </div>
        </div>
      )}
      {o && v && (
        <div class={`${styles.verdict} ${styles[o.verdict.tone]}`} data-verdict>
          <span class={styles.verdictIco}>{ICON[o.verdict.tone]}</span>
          <div>
            <b>{v.head}</b>
            {v.rest && <div>{v.rest}</div>}
          </div>
        </div>
      )}
      {o?.stats && (
        <div class={styles.stats}>
          <div class={styles.stat} data-stat="objects">
            <b>{o.stats.objects}</b>
            <span>objects created</span>
          </div>
          <div class={styles.stat} data-stat="imports">
            <b>
              {o.stats.started} / {o.stats.invoked}
            </b>
            <span>imports started</span>
          </div>
          <div
            class={`${styles.stat} ${o.stats.pending ? styles.statWarn : ''}`}
            data-stat="missing"
            data-warn={o.stats.pending ? 'true' : 'false'}
          >
            <b>{o.stats.pending}</b>
            <span>
              {o.stats.pending === 1 ? 'dataset still missing' : 'datasets still missing'}
            </span>
          </div>
        </div>
      )}
      {!!o?.blockers?.length && (
        <div class={styles.issues}>
          <div class={styles.groupHead}>
            Blockers <span class={styles.count}>{o.blockers.length}</span>
          </div>
          {o.blockers.map((b) => (
            <div class={`${styles.issue} ${styles.issueBlock}`}>
              <span>✕</span>
              <span>{b}</span>
            </div>
          ))}
        </div>
      )}
      {!!notes.length && (
        <div class={styles.issues}>
          <div class={styles.groupHead}>
            {o?.blockers?.length ? 'Notes, not blocking' : 'Notes'}{' '}
            <span class={styles.count}>{notes.length}</span>
          </div>
          {notes.map((n) => (
            <div class={`${styles.issue} ${styles.issueNote}`}>
              <span>i</span>
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}
      <div class={styles.phaseBar}>
        {states.map((s, i) => (
          <span
            class={`${styles.seg} ${styles['seg_' + s]}`}
            style={
              s === 'now' ? `--p:${phasePercent(run.phases.counts[PHASES[i][0]])}%` : undefined
            }
          ></span>
        ))}
      </div>
      <ul class={styles.phaseList}>
        {PHASES.map(([k, label, ro], i) => {
          const c = run.phases.counts[k];
          return (
            <li class={styles['ph_' + states[i]]} data-phase={k} data-state={states[i]}>
              <span class={styles.phMark}>
                {states[i] === 'done'
                  ? '✓'
                  : states[i] === 'fail'
                    ? '!'
                    : states[i] === 'now'
                      ? ''
                      : i + 1}
              </span>
              {label}
              {ro && <span class={styles.ro}>read-only</span>}
              <span class={styles.phCount}>{c ? `${c.done}/${c.total}` : ''}</span>
            </li>
          );
        })}
      </ul>
      {o && o.details !== '{}' && (
        <details class={styles.log}>
          <summary>Details (JSON)</summary>
          <pre class={styles.pre}>{o.details}</pre>
        </details>
      )}
      {run.log && (
        <div class={styles.log} data-log>
          <div class={styles.logHead}>
            <span>Log · {lines === 1 ? '1 line' : `${lines} lines`}</span>
            <button type="button" class="btn btn-sm" onClick={copy}>
              Copy
            </button>
          </div>
          <pre class={styles.pre}>
            {run.log.split('\n').map((l, i) => {
              // the time, greyed, so the messages read as one column
              const m = /^(\d\d:\d\d:\d\d) /.exec(l);
              return (
                <>
                  {i ? '\n' : ''}
                  {m ? (
                    <>
                      <span class={styles.logTime}>{m[1]}</span>
                      {l.slice(8)}
                    </>
                  ) : (
                    l
                  )}
                </>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}
