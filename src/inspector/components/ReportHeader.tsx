import { h } from 'preact';
import Overview from './Overview.jsx';
import Timeline from './Timeline.jsx';
import styles from './Inspector.module.css';

// One header card: identity/overview + the status timeline (spec §5.1).
export default function ReportHeader() {
  return (
    <div class={styles.rephead}>
      <Overview />
      <Timeline />
    </div>
  );
}
