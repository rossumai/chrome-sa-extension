import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import * as store from '../store.js';
import { loadQueueHooks, loadEnrichment } from '../index.jsx';
import { buildPipeline } from '../culprit.js';
import dg from '../../ui/fabry/Diagnosis.module.css';
import styles from './Inspector.module.css';

export default function PipelinePanel() {
  const d = store.data.value;

  useEffect(() => {
    loadQueueHooks();
    if (store.enrichment.value.hookLogs === null) loadEnrichment('hookLogs');
  }, [store.annotationId.value]);

  if (!d) return null;
  const hooks = Object.values(d.resolved.hooksById || {});
  if (!d.resolved._hooksLoaded && !hooks.length)
    return <div class={styles.loading}>Loading extensions…</div>;

  const logs = store.enrichment.value.hookLogs;
  const phases = buildPipeline(hooks, Array.isArray(logs) ? logs : []);

  return (
    <div class={styles.panel}>
      {phases.length === 0 && <div class={dg.empty}>No active extensions on this queue.</div>}
      {phases.map((p) => (
        <div class={styles.phase}>
          <div class={styles.sect}>
            {p.label} <span class={styles.sectNote}>{p.event}</span>
          </div>
          <ol class={styles.pipe}>
            {p.nodes.map((n, i) => (
              <li
                class={
                  styles.pipeNode + (n.run ? ' ' + (n.run.failed ? styles.failed : styles.ran) : '')
                }
              >
                <div class={styles.row}>
                  <span class={styles.rank}>{i + 1}</span>
                  <span class={styles.nm}>{n.name}</span>
                  <span class={styles.tag}>{n.type}</span>
                  {n.run ? (
                    n.run.failed ? (
                      <span class={styles.pipeStatus + ' ' + styles.fail}>failed</span>
                    ) : (
                      <span class={styles.pipeStatus + ' ' + styles.ok}>ran</span>
                    )
                  ) : (
                    <span
                      class={styles.pipeStatus + ' ' + styles.none}
                      title="Only failures are reliably logged; absence of a log usually means it ran fine."
                    >
                      no log {'—'} likely ran
                    </span>
                  )}
                  {n.run && n.run.durationMs != null ? (
                    <span class={styles.tag}>{n.run.durationMs} ms</span>
                  ) : null}
                </div>
                {n.run && n.run.message ? <div class={styles.pipeMsg}>{n.run.message}</div> : null}
              </li>
            ))}
          </ol>
        </div>
      ))}
      <div class={styles.note}>
        Pipeline order comes from the queue's extension config (
        <code class={styles.code}>run_after</code>) and is always accurate. Run status comes from
        hook logs, which are retention-limited — a step with <b>no log</b> may still have run
        successfully; in practice only failures are reliably recorded.
      </div>
    </div>
  );
}
