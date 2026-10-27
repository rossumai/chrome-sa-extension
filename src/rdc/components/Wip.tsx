// The work-in-progress note: a step or panel that is not built yet shows its place and says so,
// never sample data.
import { h } from 'preact';
import { WIP, type WipFeature } from '../deploy.js';
import styles from './Deploy.module.css';

export default function Wip({ feature }: { feature: WipFeature }) {
  return (
    <div class={`${styles.note} ${styles.wip}`} role="note">
      <span class={styles.wipBadge}>Work in progress</span>
      <span>{WIP[feature]}</span>
    </div>
  );
}
