import { h } from 'preact';
import * as store from '../store.js';
import { loadAllPagePreviews } from '../index.jsx';
import { buildDeeplink } from '../../audit/deeplink.js';
import styles from './Inspector.module.css';

// Sticky right rail with small previews of the document pages. Thumbnails are
// blob object URLs (see loadPagePreviews); clicking one opens the annotation in
// the Rossum UI. Renders nothing when there is nothing to show (error/empty) —
// the report never depends on it.
export default function PageRail() {
  const pv = store.pagePreviews.value;
  if (!pv || pv.status === 'error') return null;
  if (pv.status === 'done' && pv.pages.length === 0) return null;
  const href = buildDeeplink(store.domain.value, 'annotation', store.annotationId.value);
  const remaining = (pv.total || 0) - pv.pages.length;
  return (
    <aside class={styles.pagerail}>
      <div class={styles.pagerailHd}>
        Document{pv.total ? ` · ${pv.total} page${pv.total === 1 ? '' : 's'}` : ''}
      </div>
      {pv.pages.map((p: any) => (
        <a
          class={styles.page}
          href={href || undefined}
          target="_blank"
          rel="noreferrer"
          title={`Page ${p.number} — open in Rossum`}
        >
          {p.objectUrl ? (
            <img
              src={p.objectUrl}
              width={p.width || undefined}
              height={p.height || undefined}
              alt={`page ${p.number}`}
            />
          ) : (
            <div
              class={styles.pageSkel}
              style={p.width && p.height ? `aspect-ratio:${p.width} / ${p.height}` : 'height:120px'}
            />
          )}
          <span class={styles.pageNum}>{p.number}</span>
        </a>
      ))}
      {pv.status === 'loading' && pv.pages.length === 0 ? (
        <div class={styles.pageSkel} style="height:120px" />
      ) : null}
      {pv.status === 'done' && remaining > 0 ? (
        <button type="button" class={styles.pagerailMore} onClick={() => loadAllPagePreviews()}>
          Load {remaining} more page{remaining === 1 ? '' : 's'}
        </button>
      ) : null}
    </aside>
  );
}
