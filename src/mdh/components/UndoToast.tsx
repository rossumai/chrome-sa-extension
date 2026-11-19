import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { undoToast } from '../store.js';
import { triggerUndo, dismissUndo } from '../undo.js';
import styles from './UndoToast.module.css';

// The status modifiers that carry a rule; 'pending' has none.
const STATUS_CLASS: Record<string, string> = {
  running: styles.undoToastRunning,
  done: styles.undoToastDone,
  error: styles.undoToastError,
};

export default function UndoToast() {
  const u = undoToast.value;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!u || u.status !== 'pending') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [u?.id, u?.status]);

  if (!u) return null;

  const remainingMs = Math.max(0, u.ts + u.ttlMs - now);
  const remainingS = Math.ceil(remainingMs / 1000);
  const progress = u.status === 'pending' ? remainingMs / u.ttlMs : 0;

  return (
    <div
      class={`${styles.undoToast} ${STATUS_CLASS[u.status] ?? ''}`}
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
    >
      <div class={styles.undoToastRow}>
        <span class={styles.undoToastMessage}>
          {u.status === 'error'
            ? `Undo failed: ${u.error}`
            : u.status === 'done'
              ? 'Undone'
              : u.status === 'running'
                ? `Undoing…`
                : u.message}
        </span>
        {u.status === 'pending' && (
          <button class={styles.undoToastAction} onClick={triggerUndo}>
            Undo <span class={styles.undoToastCountdown}>({remainingS}s)</span>
          </button>
        )}
        <button
          class={styles.undoToastDismiss}
          title="Dismiss"
          onClick={dismissUndo}
          aria-label="Dismiss"
        >
          {'×'}
        </button>
      </div>
      {u.status === 'pending' && (
        <div class={styles.undoToastProgress} style={`transform: scaleX(${progress})`} />
      )}
    </div>
  );
}
