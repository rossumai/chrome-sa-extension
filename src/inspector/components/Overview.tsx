import { h } from 'preact';
import * as store from '../store.js';
import IdLabel from './IdLabel.jsx';
import styles from './Inspector.module.css';

function idFromUrl(u: any) {
  const m = String(u || '').match(/\/(\d+)\/?$/);
  return m ? m[1] : null;
}

function userDisplayName(u: any) {
  if (!u) return null;
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return full || u.username || u.email || null;
}

export default function Overview() {
  const d = store.data.value;
  if (!d) return null;
  const a = d.annotation;
  const r = d.resolved;
  return (
    <div class={styles.ovh}>
      <div class={styles.ovhMain}>
        <div class={styles.ovhId}>#{a.id}</div>
        <div class={styles.ovhSub}>
          {a.queue ? (
            <IdLabel name={r.queue?.name} id={idFromUrl(a.queue)} prefix="queue " />
          ) : (
            'unknown queue'
          )}
          {a.prediction?.source ? ` · ${a.prediction.source}` : ''}
        </div>
        <div class={styles.chips}>
          <span class={styles.chip}>
            automated: <b>{String(!!a.automated)}</b>
          </span>
          {a.modifier ? (
            <span class={styles.chip}>
              modifier:{' '}
              <IdLabel
                name={userDisplayName(r.usersById?.[idFromUrl(a.modifier) as string])}
                id={idFromUrl(a.modifier)}
                prefix="user "
              />
            </span>
          ) : null}
          {a.schema ? (
            <span class={styles.chip}>
              schema: <IdLabel name={r.schema?.name} id={idFromUrl(a.schema)} prefix="schema " />
            </span>
          ) : null}
          {a.document ? (
            <span class={styles.chip}>
              document:{' '}
              <IdLabel
                name={r.document?.original_file_name}
                id={idFromUrl(a.document)}
                prefix="document "
              />
            </span>
          ) : null}
        </div>
      </div>
      <span class={`${styles.pill} ${styles['pill-' + a.status] ?? ''}`}>{a.status}</span>
    </div>
  );
}
