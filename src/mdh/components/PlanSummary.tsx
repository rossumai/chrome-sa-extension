import { h, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import styles from './PlanSummary.module.css';

// One-sentence outcome+risk summary with a collapsed "Details" expander that
// holds the full verified bullet list (the caller passes the <ul>). Replaces
// the always-visible "What will happen" blocks in the import/export wizards.
// Collapsed on every mount; expansion is never persisted.
export default function PlanSummary({
  summary,
  summaryTestid,
  children,
}: {
  summary?: ComponentChildren;
  summaryTestid?: string;
  children?: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div class={styles.planSummary}>
      <div class={styles.planSummaryLine}>
        <span class={styles.planSummaryText} data-testid={summaryTestid}>
          {summary}
        </span>
        {children && (
          <button
            type="button"
            class={styles.planSummaryToggle}
            aria-expanded={open}
            data-testid={summaryTestid ? `${summaryTestid}-toggle` : undefined}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide ▴' : 'Details ▾'}
          </button>
        )}
      </div>
      {open && <div class={styles.importSteps}>{children}</div>}
    </div>
  );
}
