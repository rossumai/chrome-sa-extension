import { h, Fragment } from 'preact';
import * as store from '../store.js';
import { classifyMessage, explainBlocker } from '../culprit.js';
import { messageKey, blockerKey } from '../orchestrate.js';
import { schemaIdForDatapoint } from '../evidence.js';
import ReliabilityBadge from './ReliabilityBadge.jsx';
import CulpritChip from './CulpritChip.jsx';
import dg from '../../ui/fabry/Diagnosis.module.css';
import styles from './Inspector.module.css';

function AttrLine({ entry }: { entry: any }) {
  if (!entry) return null;
  if (entry.status === 'loading')
    return (
      <span class={styles.labelWhy + ' ' + styles.loading + ' ' + styles.aiPhase}>
        {entry.phase || 'thinking'}…
      </span>
    );
  if (entry.status === 'error') return <span class={styles.labelWhy}>AI attribution failed</span>;
  if (entry.status === 'done' && entry.verdict) {
    return (
      <span class={styles.aiVerdictInline}>
        <CulpritChip culprit={entry.verdict.culprit} />
        {entry.source === 'programmatic' ? (
          <ReliabilityBadge level={entry.reliability} />
        ) : (
          <ReliabilityBadge level={entry.verdict.confidence} />
        )}
        {entry.verdict.explanation ? (
          <span class={styles.why}>{entry.verdict.explanation}</span>
        ) : null}
      </span>
    );
  }
  return null;
}

function MsgRow({ m, idx }: { m: any; idx: number }) {
  const attr = store.attributions.value[messageKey(idx)];
  const field = schemaIdForDatapoint(store.data.value?.content?.content, m.datapointId);
  return (
    <div class={styles.mrow} data-evidence-id={`message:${m.idx}`}>
      <span class={`${styles.lv} ${styles['lv-' + m.level] ?? ''}`}>{m.level}</span>
      <div class={styles.mc}>
        <div class={styles.mtxt}>{m.content}</div>
        <div class={styles.mrow2}>
          {m.culprit ? <CulpritChip culprit={m.culprit} /> : <AttrLine entry={attr} />}
          {m.culprit ? (
            <ReliabilityBadge level={m.reliability} />
          ) : !attr ? (
            <ReliabilityBadge level="unavailable" />
          ) : null}
          {field ? <span class={styles.tag}>field {field}</span> : null}
          {m.isException ? <span class={styles.tag}>is_exception</span> : null}
          {m.requestId ? (
            <span class={styles.tag}>request_id {m.requestId.slice(0, 8)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function BlockedPanel() {
  const d = store.data.value;
  if (!d) return null;
  const ctx = { queue: d.resolved.queue, schemaById: {} };
  const messages = (d.annotation.messages || []).map((raw: any, idx: any) => ({
    ...classifyMessage(raw),
    idx,
  }));
  // Only error-type messages block automation (they feed the error_message
  // blocker); warnings/info are shown separately as non-blocking.
  const errorMsgs = messages.filter((m: any) => m.level === 'error');
  const otherMsgs = messages.filter((m: any) => m.level !== 'error');

  return (
    <div class={styles.panel}>
      <div class={styles.sect}>Automation blockers</div>
      {(d.blocker?.content || []).length === 0 && (
        <div class={dg.empty}>No automation blockers.</div>
      )}
      {(d.blocker?.content || []).map((raw: any, i: any) => {
        const b = explainBlocker(raw, ctx);
        return (
          <div class={styles.bcard} data-evidence-id={`blocker:${i}`}>
            <div class={styles.ttl}>
              <code>{b.type}</code>
              {b.schemaId ? <span> · {b.schemaId}</span> : null} <CulpritChip culprit={b.culprit} />{' '}
              <ReliabilityBadge level={b.reliability} />
            </div>
            <div class={styles.why}>{b.explanation}</div>
            <AttrLine entry={store.attributions.value[blockerKey(i)]} />
          </div>
        );
      })}

      <div class={styles.sect} style="margin-top:18px">
        Error messages ({errorMsgs.length}) <span class={styles.sectNote}>block automation</span>
      </div>
      {errorMsgs.length === 0 && <div class={dg.empty}>No error messages.</div>}
      {errorMsgs.map((m: any) => (
        <MsgRow m={m} idx={m.idx} />
      ))}

      {otherMsgs.length > 0 && (
        <Fragment>
          <div class={styles.sect} style="margin-top:18px">
            Other messages ({otherMsgs.length}){' '}
            <span class={styles.sectNote}>do not block automation</span>
          </div>
          {otherMsgs.map((m: any) => (
            <MsgRow m={m} idx={m.idx} />
          ))}
        </Fragment>
      )}
    </div>
  );
}
