import { h } from 'preact';
import * as store from '../store.js';
import { reImplement, stopImplement } from '../actions.js';
import { openArmDialog } from './ArmDialog.jsx';
import type { Deliverable } from '../collectionPlan.js';
import styles from './ImplementPanel.module.css';
import arch from './Architect.module.css';

// The status classes that carry a rule (idle and stopped keep the plain border; a pending task
// the plain dot).
const STATUS_CLASS: Record<string, string> = {
  passing: styles.statusPassing,
  failed: styles.statusFailed,
  blocked: styles.statusBlocked,
  uncertain: styles.statusUncertain,
  planning: styles.statusPlanning,
  running: styles.statusRunning,
};
const TASK_CLASS: Record<string, string> = {
  doing: styles.taskDoing,
  done: styles.taskDone,
  failed: styles.taskFailed,
};

// The write-enabled implement loop for ONE deliverable. Markup lifted verbatim from the deliverable
// pane's Implement tab when the pane was replaced by the unified view (2026-08-19). The Arm dialog
// still gates every run — that gate is the whole safety story and it did not move.
export default function ImplementPanel({ deliverable }: { deliverable: Deliverable }) {
  const impl = store.implement.value[deliverable.id];
  const result = store.results.value[deliverable.id];
  const active =
    !!impl &&
    store.implementRunning.value &&
    (impl.status === 'planning' || impl.status === 'running');

  function onImplement() {
    openArmDialog(1, () => reImplement(deliverable.id));
  }

  return (
    <div>
      <div class={styles.implementHd}>
        <span class={styles.implementTitle}>{'Implement this deliverable'}</span>
        {active ? (
          <button type="button" class={styles.implementStop} onClick={stopImplement}>
            {'Stop'}
          </button>
        ) : (
          <button
            type="button"
            class={styles.implementRun}
            disabled={store.implementRunning.value || store.running.value || result?.running}
            onClick={onImplement}
          >
            {'Implement ▷'}
          </button>
        )}
      </div>
      {!impl && (
        <p class={styles.implementHint}>
          {
            'Mr. Fabry plans this deliverable into tasks and implements them autonomously — write-enabled, bounded, and audited. You confirm before it starts.'
          }
        </p>
      )}
      {impl && (
        <div
          class={
            styles.implementBody +
            (STATUS_CLASS[impl.status as string] ? ' ' + STATUS_CLASS[impl.status as string] : '')
          }
        >
          <div class={styles.implementStatus}>
            {active ? h('span', { class: arch.spin }) : null}
            {impl.status === 'passing'
              ? '✓ implemented (check passed)'
              : impl.status === 'failed'
                ? '✗ could not satisfy'
                : impl.status === 'blocked'
                  ? '⚠ blocked'
                  : impl.status === 'uncertain'
                    ? '? could not verify (check error)'
                    : impl.status === 'stopped'
                      ? '■ stopped'
                      : impl.status === 'planning'
                        ? 'Planning tasks…'
                        : impl.status === 'running'
                          ? 'Implementing tasks…'
                          : ''}
            {impl.error && (
              <span class={styles.implementErr}>
                {' — '}
                {impl.error}
              </span>
            )}
          </div>
          {impl.tasks && impl.tasks.length > 0 && (
            <ol class={styles.tasklist}>
              {impl.tasks.map((t) => (
                <li
                  key={t.id}
                  class={
                    styles.task +
                    (TASK_CLASS[t.status as string] ? ' ' + TASK_CLASS[t.status as string] : '')
                  }
                >
                  <span class={styles.taskDot} />
                  <span class={styles.taskText}>{t.text}</span>
                  {t.origin && t.origin !== 'plan' && (
                    <span class={styles.taskOrigin}>{t.origin}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {impl.summary && <div class={styles.implementSummary}>{impl.summary}</div>}
          {impl.notes &&
            impl.notes.length > 0 &&
            impl.notes.map((n: any, i: any) => (
              <div key={i} class={styles.implementNote}>
                {n}
              </div>
            ))}
          {impl.writes && impl.writes.length > 0 && (
            <ul class={styles.implementAudit}>
              {impl.writes.map((w, i) => (
                <li key={i} class={w.ok ? undefined : styles.pending}>
                  <code>{w.tool}</code>
                  {w.argsSummary ? ' ' + w.argsSummary : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
