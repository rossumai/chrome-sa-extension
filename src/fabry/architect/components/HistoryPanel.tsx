import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import * as store from '../store.js';
import { loadRevisions, openRevision, ensureRevisionText, restoreRevision } from '../actions.js';
import DiffView from '../../../ui/DiffView.jsx';
import { relativeTime } from '../format.js';
import type { Deliverable } from '../collectionPlan.js';
import styles from './HistoryPanel.module.css';
import arch from './Architect.module.css';

// What kind of change produced each version. `source` records the change that SUPERSEDED
// the stored text, so a row reads "a Refine acceptance changed this; here is what it
// looked like before".
const SOURCE: Record<string, { icon: string; label: string }> = {
  edit: { icon: '✎', label: 'Edited' },
  refine: { icon: '✦', label: 'Refine accepted' },
  restore: { icon: '↶', label: 'Restored' },
};
const sourceOf = (s: any) => SOURCE[s] || SOURCE.edit;

export default function HistoryPanel({ deliverable }: { deliverable: Deliverable }) {
  const id = deliverable.id;
  const state = store.revisions.value[id] || {};
  const items = state.items || [];
  const selected = store.selectedRevision.value;
  const texts = store.revisionTexts.value;
  // Which side the selected version is compared against. 'current' answers "what changed
  // since then", which is the question a reader almost always has; 'previous' isolates the
  // one change that version recorded.
  const [mode, setMode] = useState('current');

  useEffect(() => {
    loadRevisions(id);
  }, [id]);
  // The selection is global (one History panel is open at a time), so it must not survive a
  // switch — it would point at another deliverable's version.
  useEffect(() => {
    store.selectedRevision.value = null;
  }, [id]);

  const idx = items.findIndex((r: any) => r.id === selected);
  // items are newest-first, so the NEWER neighbour is the previous index; for the newest
  // version the newer side is the live text.
  const newerId = idx > 0 ? items[idx - 1].id : null;
  const compareId = mode === 'previous' ? newerId : null;

  // Land on the newest version so the panel opens showing a diff rather than a prompt.
  useEffect(() => {
    if (!selected && items.length) openRevision(id, items[0].id);
  }, [id, items.length, selected]);
  // The list projects `text` out, so each side is fetched only when it is actually shown.
  useEffect(() => {
    if (compareId) ensureRevisionText(id, compareId);
  }, [id, compareId]);

  const before = selected ? texts[selected] : null;
  const after =
    mode === 'current' ? deliverable.text : compareId ? texts[compareId] : deliverable.text;
  const now = Date.now();

  if (state.error) return <div class={`${styles.histNote} ${styles.histError}`}>{state.error}</div>;
  if (!items.length) {
    return (
      <div class={styles.histNote}>
        {state.loading
          ? 'Loading versions…'
          : 'No earlier versions yet — the next edit records what this looks like now.'}
      </div>
    );
  }

  return (
    <div class={styles.hist}>
      <ol class={styles.histList}>
        <li class={`${styles.histRow} ${styles.histCurrent}`}>
          <span class={styles.histIcon}>{'●'}</span>
          <span class={styles.histWhen}>Current</span>
          <span class={styles.histWhat}>
            {deliverable.editedAt
              ? 'edited ' + relativeTime(deliverable.editedAt, now)
              : 'not edited yet'}
          </span>
        </li>
        {items.map((r: any) => {
          const s = sourceOf(r.source);
          const isSel = r.id === selected;
          return (
            <li key={r.id}>
              <button
                type="button"
                class={
                  `${styles.histRow} ${styles.histBtn}` + (isSel ? ' ' + styles.isSelected : '')
                }
                aria-pressed={isSel}
                onClick={() => openRevision(id, r.id)}
              >
                <span class={styles.histIcon}>{s.icon}</span>
                <span class={styles.histWhen}>{relativeTime(r.at, now)}</span>
                <span class={styles.histWhat}>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div class={styles.histPane}>
        <div class={styles.histBar}>
          <div class={`${arch.viewtoggle} ${styles.histCmp}`}>
            <button
              type="button"
              aria-pressed={mode === 'current'}
              onClick={() => setMode('current')}
            >
              vs current
            </button>
            <button
              type="button"
              aria-pressed={mode === 'previous'}
              title={newerId ? 'Compare with the next version' : 'This is the newest version'}
              onClick={() => setMode('previous')}
            >
              vs next
            </button>
          </div>
          <button
            type="button"
            class={styles.histRestore}
            disabled={!selected || typeof before !== 'string'}
            title="Replace the deliverable text with this version. The current text is kept as a new version, so this is undoable."
            onClick={() => restoreRevision(id, selected)}
          >
            {'↶ Restore'}
          </button>
        </div>
        {typeof before === 'string' && typeof after === 'string' ? (
          <div class={styles.histDiff}>
            <DiffView before={before} after={after} />
          </div>
        ) : (
          <div class={styles.histNote}>Loading version…</div>
        )}
      </div>
    </div>
  );
}
