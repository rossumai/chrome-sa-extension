import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import * as store from '../store.js';
import { loadEnrichment } from '../index.jsx';
import { classifyRejection, type RejectionVerdict } from '../culprit.js';
import ReliabilityBadge from './ReliabilityBadge.jsx';
import CulpritChip from './CulpritChip.jsx';
import dg from '../../ui/fabry/Diagnosis.module.css';
import styles from './Inspector.module.css';

export default function RejectedPanel() {
  const d = store.data.value;
  const enr = store.enrichment.value;

  useEffect(() => {
    if (store.enrichment.value.workflow === null) loadEnrichment('workflow');
    if (store.enrichment.value.notes === null) loadEnrichment('notes');
  }, [store.annotationId.value]);

  const rej = d
    ? classifyRejection({
        annotation: d.annotation,
        workflowActivities: Array.isArray(enr.workflow) ? enr.workflow : [],
        notes: Array.isArray(enr.notes) ? enr.notes : [],
        usersById: d.resolved.usersById,
      })
    : ({ type: 'none' } as RejectionVerdict);

  if (!d) return null;
  if (rej.type === 'none')
    return <div class={dg.empty}>This annotation has not been rejected.</div>;

  const attr = store.attributions.value.reject;
  return (
    <div class={styles.panel}>
      <div
        class={`${styles.culprit} inspector-culprit-${rej.culprit?.kind || 'none'}`}
        data-evidence-id="reject"
      >
        <div class={styles.lbl}>Culprit · {rej.culprit?.kind}</div>
        <div class={styles.name}>
          {rej.culprit?.name} <ReliabilityBadge level={rej.reliability} />
        </div>
        <div class={styles.meta}>
          {rej.automatic ? 'Automatic' : 'Manual'}
          {rej.when ? ` · ${rej.when}` : ''}
          {rej.current ? '' : ' · (historical — not currently rejected)'}
        </div>
      </div>
      <div class={styles.reason}>
        <div class={styles.reasonLabel}>Reason</div>
        <div class={styles.body}>{rej.reason.text || 'Reason not recorded by the API.'}</div>
        <ReliabilityBadge level={rej.reason.reliability} />
      </div>
      {rej.type === 'hook' && (
        <div class={styles.aiAttr}>
          <div class={styles.aiNote}>
            Which extension rejected this — reasoned by Mr. Fabry from the queue's extension code +
            logs.
          </div>
          {!store.aiAvailable.value && (
            <div class={dg.empty}>AI attribution unavailable (agent offline).</div>
          )}
          {attr?.status === 'loading' && (
            <div class={styles.loading + ' ' + styles.aiPhase}>{attr.phase || 'thinking'}…</div>
          )}
          {attr?.status === 'error' && <div class={dg.empty}>AI attribution failed.</div>}
          {attr?.status === 'done' && (
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
