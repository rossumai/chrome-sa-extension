import { h } from 'preact';
import styles from './Inspector.module.css';

// Inline "culprit" tag — the foregrounded attribution shown next to each item.
export default function CulpritChip({ culprit }: { culprit: any }) {
  if (!culprit) {
    return (
      <span class={styles.culp + ' ' + styles['culp-none']}>
        <span class={styles.culpLabel}>culprit</span> unattributed
      </span>
    );
  }
  return (
    <span class={`${styles.culp} ${styles['culp-' + culprit.kind] ?? ''}`}>
      <span class={styles.culpLabel}>culprit</span> {culprit.name}
      {culprit.id != null ? ` #${culprit.id}` : ''}
    </span>
  );
}
