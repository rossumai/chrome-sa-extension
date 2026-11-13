// The org's own values: the design's frame, with the work-in-progress note where the data would
// be. Every control that would act on data is disabled.
import { h } from 'preact';
import Wip from './Wip.jsx';
import styles from './Deploy.module.css';

export function OwnValues({ targetName, onBack }: { targetName: string; onBack: () => void }) {
  return (
    <div class={`${styles.wrap} ${styles.wz}`}>
      <div class={styles.backRow}>
        <button class={styles.link} onClick={onBack}>
          {'← '}
          {targetName}
        </button>
      </div>
      <div class={`${styles.wzH} ${styles.wzRow}`}>
        <div>
          <h1>What {targetName} keeps for itself</h1>
          <p>
            A deployment copies everything from the source except these values. Use them for what
            must differ in {targetName}: addresses of other systems, users, mail addresses.
          </p>
        </div>
        <span class={styles.sp}></span>
        <button class="btn btn-primary" disabled>
          Save changes
        </button>
      </div>
      <div class={styles.panel}>
        <div class={styles.panelHead}>
          <h2>Values you set</h2>
        </div>
        <div class={`${styles.panelB} ${styles.stack}`}>
          <Wip feature="ownValues" />
          <div class={styles.addv}>
            <select aria-label="Object" disabled>
              <option>Choose an object{'…'}</option>
            </select>
            <select aria-label="Setting" disabled>
              <option>Choose a setting{'…'}</option>
            </select>
            <button class="btn btn-secondary" disabled>
              Add value
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
