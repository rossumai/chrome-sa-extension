import { h } from 'preact';
import * as store from '../store.js';
import * as fstore from '../../store.js';
import { openChat } from '../../chat.js';
import { reRun } from '../actions.js';
import { relativeTime } from '../format.js';
import FabryMarkdown from '../../../ui/fabry/FabryMarkdown.jsx';
import type { Deliverable } from '../collectionPlan.js';
import styles from './CheckPanel.module.css';
import arch from './Architect.module.css';

// The read-only check for ONE deliverable. Markup lifted verbatim from the deliverable pane's Check
// tab when the pane was replaced by the unified view (2026-08-19); only its host changed.
const CHIP: Record<string, { cls: string; label: string }> = {
  pass: { cls: 'pass', label: '✓ Met' },
  fail: { cls: 'fail', label: '✗ Not met' },
  uncertain: { cls: 'uncertain', label: '? Uncertain' },
};

export default function CheckPanel({ deliverable }: { deliverable: Deliverable }) {
  const result = store.results.value[deliverable.id];
  const chip = result && !result.running ? CHIP[result.verdict as string] : null;
  const now = Date.now();
  const busy = store.running.value || store.implementRunning.value;

  function viewChat() {
    if (!result?.chatId) return;
    fstore.setFabryMode('chat');
    openChat(result.chatId);
  }

  if (result?.running) {
    return (
      <div class={styles.checkEmpty}>
        <span class={arch.spin} />
        {' Checking this deliverable against the organization…'}
      </div>
    );
  }
  if (!chip) {
    return (
      <div class={styles.checkEmpty}>
        {'Not checked yet. '}
        <button
          type="button"
          class={styles.rerun}
          disabled={busy}
          onClick={() => reRun(deliverable.id)}
        >
          {'Run check ▷'}
        </button>
      </div>
    );
  }
  return (
    <div class="fabry-arch-check">
      <div class={`${styles.checkHd} ${styles[chip.cls]}`}>
        <span class={styles.checkVerdict}>{chip.label}</span>
        {result.stale && (
          <span class={styles.checkStale}>
            {'last checked '}
            {relativeTime(result.ranAt as number, now) || 'previously'}
            {' · may be outdated'}
          </span>
        )}
        <button
          type="button"
          class={styles.rerun}
          disabled={busy}
          onClick={() => reRun(deliverable.id)}
        >
          {'Re-run ▷'}
        </button>
      </div>
      <div class={`fabry-arch-evidence ${styles.evidence}`}>
        <FabryMarkdown text={result.evidence || '(no evidence returned)'} streaming={false} />
      </div>
      <div class={styles.checkFoot}>
        <span class={arch.credit}>by Mr. Fabry</span>
        {result.chatId && (
          <button type="button" class={styles.viewchat} onClick={viewChat}>
            {'View investigation →'}
          </button>
        )}
      </div>
    </div>
  );
}
