import { h } from 'preact';
import * as store from '../store.js';
import { clearRecents, relativeTime } from '../recents.js';
import styles from './Inspector.module.css';

// Landing view (variant B, owner-picked 2026-07-04): annotations the user
// recently OPENED IN THE ROSSUM UI, as a compact table — File / Queue / Status /
// When(viewed) / Id — Clear-all in the header, friendly empty state. Rows come
// from store.recents (viewed list, per-org, enriched via one sideloaded call).
export default function RecentAnnotations({ onSelect }: { onSelect: (id: string) => void }) {
  const list = store.recents.value;
  if (!list || list.length === 0) {
    return (
      <div class={styles.recentsEmpty}>
        Nothing viewed yet. Annotations you open in the Rossum UI will appear here {'—'} or paste an
        id above.
      </div>
    );
  }
  const now = Date.now();
  return (
    <div class={styles.recents}>
      <table class={styles.rectable}>
        <thead>
          <tr>
            <th>File</th>
            <th>Queue</th>
            <th>Status</th>
            <th>When</th>
            <th class={styles.rectableIdh}>
              Id{' '}
              <button type="button" class={styles.recentsClear} onClick={clearRecents}>
                Clear all
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr
              class="inspector-recent"
              title={`Inspect #${r.id}`}
              onClick={() => onSelect(String(r.id))}
            >
              <td class={styles.recentName}>{r.fileName || `#${r.id}`}</td>
              <td>
                {r.queue ? (
                  <span class={styles.chip + ' inspector-recent-queue'}>{r.queue}</span>
                ) : null}
              </td>
              <td>
                {r.status ? (
                  <span
                    class={`${styles.pill} inspector-recent-status ${styles['pill-' + r.status] ?? ''}`}
                  >
                    {String(r.status).replace(/_/g, ' ')}
                  </span>
                ) : null}
              </td>
              <td class={styles.recentWhen}>{relativeTime(r.at, now) || ''}</td>
              <td class={styles.recentId}>#{r.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
