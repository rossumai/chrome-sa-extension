import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import dg from '../../ui/fabry/Diagnosis.module.css';
import styles from './Inspector.module.css';

// Inline code for short snippets; collapsible block for long/multi-line ones
// (some rule trigger_conditions are long, multi-line scripts).
export default function FoldableCode({ code }: { code?: string | null }) {
  const [open, setOpen] = useState(false);
  const s = String(code == null ? '' : code);
  const long = s.length > 90 || s.includes('\n');
  if (!long) return <code class={styles.code}>{s}</code>;
  const firstLine = s.split('\n')[0];
  return (
    <Fragment>
      {open ? (
        <pre class={styles.codeBlock}>{s}</pre>
      ) : (
        <code class={styles.code}>
          {firstLine.slice(0, 90)}
          {firstLine.length > 90 || s.includes('\n') ? '…' : ''}
        </code>
      )}{' '}
      <button class={dg.foldBtn} type="button" onClick={() => setOpen(!open)}>
        {open ? 'Show less' : 'Show more'}
      </button>
    </Fragment>
  );
}
