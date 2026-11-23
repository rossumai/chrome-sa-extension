import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { queryRun } from '../store.js';
import { chipFor } from '../queryStatus.js';
import { useNow } from '../hooks/useNow.js';
import { modalContent } from '../../ui/Modal.jsx';
import styles from './QueryStatus.module.css';

const TONE: Record<string, string> = {
  idle: styles.toneIdle,
  run: styles.toneRun,
  slow: styles.toneSlow,
  failed: styles.toneFailed,
};

// The results toolbar's one status: the last answer, or the running query with
// its elapsed time and Cancel (Esc). Spec 2026-11-23-mdh-loading-states §3.3.
export default function QueryStatus() {
  const run = queryRun.value;
  const running = run.phase === 'running';
  // 250 ms so the chip appears close to the 300 ms mark and seconds tick evenly.
  const now = useNow(running, 250);
  const chip = chipFor(run, running ? now : Date.now());
  const cancel = chip?.cancellable && run.phase === 'running' ? run.cancel : null;

  useEffect(() => {
    if (!cancel) return;
    const onKey = (e: KeyboardEvent) => {
      // An open modal owns Escape (it closes without marking the event), so one
      // keypress must not also cancel the query underneath.
      if (e.key === 'Escape' && !e.defaultPrevented && !modalContent.peek()) cancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cancel]);

  if (!chip) return null;
  return (
    <span class={`${styles.status} ${TONE[chip.tone]}`} role="status">
      {cancel && <span class={styles.spinner} aria-hidden="true" />}
      {chip.text}
      {cancel && (
        <button type="button" class={styles.cancel} onClick={cancel} title="Cancel (Esc)">
          Cancel
        </button>
      )}
    </span>
  );
}
