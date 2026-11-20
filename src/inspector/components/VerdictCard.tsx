import { h } from 'preact';
import * as store from '../store.js';
import CulpritChip from './CulpritChip.jsx';
import ReliabilityBadge from './ReliabilityBadge.jsx';
import styles from './Inspector.module.css';

// The instant programmatic verdict (spec §4.2) — renders as soon as core data is in.
export default function VerdictCard() {
  const ev = store.evidence.value;
  if (!ev || !ev.verdict) return null;
  const v = ev.verdict;
  return (
    <div class={`${styles.verdict} ${styles['sev-' + v.severity] ?? ''}`}>
      <div class={styles.verdictH}>{v.headline}</div>
      {v.reasons.map((r: any) => (
        <div class={styles.verdictWhy}>
          {r.fact} {r.culprit ? <CulpritChip culprit={r.culprit} /> : null}{' '}
          <ReliabilityBadge level={r.reliability} />
        </div>
      ))}
    </div>
  );
}
