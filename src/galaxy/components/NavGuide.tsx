import { h } from 'preact';
import styles from './NavGuide.module.css';

const ITEMS = [
  ['Drag', 'Rotate'],
  ['Scroll', 'Zoom'],
  ['Right-drag', 'Pan'],
  ['Hover', 'Highlight links'],
  ['Click', 'Details'],
];

export default function NavGuide() {
  return (
    <div class={styles.help}>
      <div class={styles.title}>Navigate</div>
      {ITEMS.map(([k, v]) => (
        <div class={styles.row}>
          <kbd>{k}</kbd>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}
