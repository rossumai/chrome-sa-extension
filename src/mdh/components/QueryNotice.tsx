import { h, Fragment } from 'preact';
import * as cache from '../cache.js';
import { slowCause, type QueryRun } from '../queryStatus.js';
import ctl from '../../ui/controls.module.css';
import styles from './QueryNotice.module.css';

// The results area's explanation of a query that is slow, failed, or has not
// answered yet over a previous answer (spec 2026-11-23-mdh-loading-states §3.4).
export default function QueryNotice({
  kind,
  run,
  elapsedS,
  collection,
  totalCount,
  stages,
  onOpenIndexes,
  onRunAgain,
  onRunOnSample,
}: {
  kind: 'stale' | 'slow' | 'failed';
  run: QueryRun;
  elapsedS: number;
  collection: string;
  totalCount?: number | null;
  stages: any[];
  onOpenIndexes?: () => void;
  onRunAgain?: () => void;
  onRunOnSample?: () => void;
}) {
  if (kind === 'stale') {
    return (
      <div class={`${styles.notice} ${styles.info}`} role="status">
        <span class={styles.spinner} aria-hidden="true" />
        <div>
          <b class={styles.title}>Showing the previous run</b>
          The results below are from before your edit and will be replaced.
        </div>
      </div>
    );
  }

  // The prefetch keeps the collection's indexes in the cache; without them the
  // notice claims no cause rather than guess one.
  const cause = slowCause(stages, cache.get(collection, 'indexes'));
  const field = cause && <code class={styles.code}>{cause.field}</code>;

  if (kind === 'slow') {
    const cancel = run.phase === 'running' ? run.cancel : undefined;
    return (
      <div class={`${styles.notice} ${styles.warn}`} role="status">
        <span class={styles.spinner} aria-hidden="true" />
        <div class={styles.body}>
          <b class={styles.title}>
            This query is taking a while {'—'} {elapsedS} s
          </b>
          {totalCount != null && (
            <>
              {collection} has {totalCount.toLocaleString('en-US')} records
              {cause ? (
                <>
                  {' '}
                  and {field} has no index, so the first <code class={styles.code}>$match</code>{' '}
                  reads every record.
                </>
              ) : (
                '.'
              )}{' '}
            </>
          )}
          {totalCount == null && cause && (
            <>
              {field} has no index, so the first <code class={styles.code}>$match</code> reads every
              record.{' '}
            </>
          )}
          Data Storage stops a request after 30 s.
          {cause && (
            <ul class={styles.list}>
              <li>Add an index on {field} in Indexes</li>
              <li>
                or narrow the <code class={styles.code}>$match</code>
              </li>
            </ul>
          )}
        </div>
        <div class={styles.actions}>
          <button type="button" class={`${ctl.btn} ${ctl.btnSm}`} onClick={onOpenIndexes}>
            Open Indexes
          </button>
          {cancel && (
            <button
              type="button"
              class={`${ctl.btn} ${ctl.btnSm} ${ctl.btnDanger}`}
              onClick={cancel}
            >
              Cancel query
            </button>
          )}
        </div>
      </div>
    );
  }

  const timedOut = run.phase === 'failed' && run.timedOut;
  const message = run.phase === 'failed' ? run.message : '';
  return (
    <div class={`${styles.notice} ${styles.danger}`} role="alert">
      <span class={styles.icon} aria-hidden="true">
        {timedOut ? '⏱' : '!'}
      </span>
      <div class={styles.body}>
        {timedOut ? (
          <>
            <b class={styles.title}>The query did not finish within 30 s</b>
            Data Storage stops every request after 30 s.
            {cause && (
              <>
                {' '}
                On a collection this size, a <code class={styles.code}>$match</code> on an unindexed
                field reads every record.
              </>
            )}
            <ul class={styles.list}>
              {cause && <li>Add an index on {field}, then run again</li>}
              <li>
                Try it on a sample: Run on a sample adds{' '}
                <code class={styles.code}>{'{"$sample": {"size": 10000}}'}</code> first
              </li>
            </ul>
          </>
        ) : (
          <>
            <b class={styles.title}>The query failed</b>
            {message}
          </>
        )}
      </div>
      <div class={styles.actions}>
        {timedOut && (
          <button type="button" class={`${ctl.btn} ${ctl.btnSm}`} onClick={onRunOnSample}>
            Run on a sample
          </button>
        )}
        <button
          type="button"
          class={`${ctl.btn} ${ctl.btnSm} ${ctl.btnPrimary}`}
          onClick={onRunAgain}
        >
          Run again
        </button>
      </div>
    </div>
  );
}
