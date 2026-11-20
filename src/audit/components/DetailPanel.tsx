import { h } from 'preact';
import { activeSource, rows, selectedRow } from '../store.js';
import { SOURCES } from '../sources/index.js';
import { makeCtx } from '../ctx.js';
import { ModalClose } from '../../ui/Modal.jsx';
import styles from './DetailPanel.module.css';

export default function DetailPanel() {
  const idx = selectedRow.value;
  const row = idx == null ? null : rows.value.find((r) => r._idx === idx);
  // The sidebar is always mounted so selecting a row doesn't reflow the table;
  // when nothing is selected it prompts the user to click a row.
  const sections = row ? SOURCES[activeSource.value].detail(row, makeCtx()) : null;

  return (
    <aside class={styles.root}>
      <div class={styles.head}>
        <span>Detail</span>
        {row && <ModalClose onClick={() => (selectedRow.value = null)} />}
      </div>
      <div class={styles.body}>
        {sections ? (
          sections.map((s: any) => (
            <div class={styles.section}>
              <div class={styles.summary}>{s.title}</div>
              <div class={styles.sectionBody}>{s.body}</div>
            </div>
          ))
        ) : (
          <div class={styles.empty}>Click a row to see its details.</div>
        )}
      </div>
    </aside>
  );
}
