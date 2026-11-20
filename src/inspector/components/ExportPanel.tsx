import { h, Fragment } from 'preact';
import { useEffect } from 'preact/hooks';
import * as store from '../store.js';
import { loadEnrichment, loadQueueHooks } from '../index.jsx';
import { exportHookCandidates } from '../culprit.js';
import ReliabilityBadge from './ReliabilityBadge.jsx';
import CulpritChip from './CulpritChip.jsx';
import dg from '../../ui/fabry/Diagnosis.module.css';
import styles from './Inspector.module.css';

export default function ExportPanel() {
  const d = store.data.value;
  const a = d?.annotation;
  const failed = !!a && (a.status === 'failed_export' || !!a.export_failed_at);

  useEffect(() => {
    if (failed) {
      loadQueueHooks();
      if (store.enrichment.value.hookLogs === null) loadEnrichment('hookLogs');
    }
  }, [failed, store.annotationId.value]);

  if (!d) return null;
  if (!failed) return <div class={dg.empty}>No export failure recorded.</div>;

  const logs = store.enrichment.value.hookLogs;
  const logArr = Array.isArray(logs) ? logs : [];
  const hooks = Object.values(d.resolved.hooksById || {});
  const { failing, candidates } = exportHookCandidates(hooks, logArr);

  let culprit;
  let culpritBadge = null;
  if (failing) {
    culprit = (
      <Fragment>
        failed in extension <b>{failing.hookName}</b>
      </Fragment>
    );
  } else if (candidates.length === 1) {
    culprit = (
      <Fragment>
        likely extension <b>{candidates[0].hookName}</b> (the only export extension on this queue)
      </Fragment>
    );
  } else if (candidates.length > 1) {
    culprit = (
      <Fragment>
        one of {candidates.length} export extensions: {candidates.map((c) => c.hookName).join(', ')}{' '}
        — the failing one is not in the logs
      </Fragment>
    );
  } else {
    culprit = <Fragment>no export extension found on this queue</Fragment>;
    culpritBadge = 'unavailable';
  }

  let errText;
  if (failing && failing.error) errText = failing.error;
  else if (logs === 'unavailable') errText = 'Hook logs unavailable (403).';
  else if (logs === 'rate-limited') errText = 'Hook logs not loaded (rate-limited).';
  else if (Array.isArray(logs))
    errText = 'Export failed — the extension error is no longer in the logs.';
  else errText = 'Loading…';

  const attr = store.attributions.value.export;

  return (
    <div class={styles.panel}>
      <div class={styles.kv} data-evidence-id="export">
        <div class={styles.kvK}>Outcome</div>
        <div class="inspector-kv-v">
          <span class={styles.pill + ' ' + styles['pill-failed_export']}>failed export</span>
        </div>
        <div class={styles.kvK}>Failed at</div>
        <div class="inspector-kv-v">{a.export_failed_at || 'unknown'}</div>
        <div class={styles.kvK}>Export extension</div>
        <div class="inspector-kv-v">
          {culprit} <ReliabilityBadge level={culpritBadge} />
        </div>
        <div class={styles.kvK}>Error</div>
        <div class="inspector-kv-v">{errText}</div>
      </div>
      {!failing && candidates.length > 1 && attr && (
        <div class={styles.aiAttr}>
          <div class={styles.aiNote}>
            Which export extension failed — reasoned by Mr. Fabry from the queue's export extensions
            + logs.
          </div>
          {attr.status === 'loading' && (
            <div class={styles.loading + ' ' + styles.aiPhase}>{attr.phase || 'thinking'}…</div>
          )}
          {attr.status === 'error' && <div class={dg.empty}>AI attribution failed.</div>}
          {attr.status === 'done' && attr.verdict && (
            <div class={styles.aiVerdict}>
              <div class={styles.ttl}>
                <CulpritChip culprit={attr.verdict.culprit} />{' '}
                <ReliabilityBadge level={attr.verdict.confidence} />
              </div>
              {attr.verdict.explanation && <div class={styles.why}>{attr.verdict.explanation}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
