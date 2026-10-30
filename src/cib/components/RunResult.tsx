// src/cib/components/RunResult.tsx
// Step 5: what the last run did. Everything shown comes from the engine as it is (verdict(),
// blockers, notes, progress); this component only arranges it.
import { h } from 'preact';
import { PHASES, phaseStates, splitVerdict } from '../view.js';
import type { PhaseLog } from '../view.js';
import styles from './App.module.css';

export type RunView = {
  mode: 'check' | 'deploy';
  running: boolean;
  failed: boolean;
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
  const copy = () => navigator.clipboard?.writeText(run.log).catch(() => {});
  return (
    <div class={styles.stepBody}>
      {run.running && run.detail && <div class={styles.hint}>{run.detail}</div>}
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
        {states.map((s) => (
          <span class={`${styles.seg} ${styles['seg_' + s]}`}></span>
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
        <details class={styles.log} open={run.failed} data-log>
          <summary>
            <span>Log · {run.log.trimEnd().split('\n').length} lines</span>
            <button
              type="button"
              class="btn btn-sm"
              onClick={(e) => {
                e.preventDefault();
                copy();
              }}
            >
              Copy
            </button>
          </summary>
          <pre class={styles.pre}>{run.log}</pre>
        </details>
      )}
    </div>
  );
}
