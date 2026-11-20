import { h, Fragment } from 'preact';
import card from './Card.module.css';
import styles from './Toggle.module.css';

export default function Toggle({
  id,
  label,
  hint,
  beta,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  beta?: boolean;
  checked?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label class={styles.toggle}>
      <input
        type="checkbox"
        id={id}
        checked={!!checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span class={styles.toggleTrack}></span>
      <span class={styles.toggleLabel}>
        {label}
        {beta ? (
          <Fragment>
            {' '}
            <span class={card.betaBadge}>beta</span>
          </Fragment>
        ) : null}
        {hint ? <span class={styles.toggleHint}>{hint}</span> : null}
      </span>
    </label>
  );
}
