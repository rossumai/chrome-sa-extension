import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import * as store from '../store.js';
import { runRevalidate } from '../index.jsx';
import { driftDiff } from '../driftDiff.js';
import EvidenceSection from './EvidenceSection.jsx';
import ctl from '../../ui/controls.module.css';
import dg from '../../ui/fabry/Diagnosis.module.css';
import styles from './Inspector.module.css';

// Opt-in config-drift check (spec §4.5): live validate vs the persisted messages.
export default function DriftSection() {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = store.data.value;
  const live = store.live.value;
  const diff = live
    ? driftDiff(d?.annotation?.messages, live.messages, live.matchedTriggerRules)
    : null;

  const run = async () => {
    setErr(null);
    setRunning(true);
    try {
      await runRevalidate();
    } catch (e: any) {
      setErr(e?.message || 'Re-evaluation failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <EvidenceSection
      id="drift"
      title="Config drift"
      count={
        diff
          ? `${diff.added.length} added · ${diff.removed.length} removed`
          : 'persisted vs today’s config'
      }
      status={diff ? 'loaded' : 'optin'}
    >
      {!diff && (
        <Fragment>
          <button class={`${ctl.btn} ${ctl.btnPrimary}`} disabled={running} onClick={run}>
            {running ? 'Re-evaluating…' : 'Re-evaluate against today’s config'}
          </button>
          <div class={styles.note}>
            Runs a live <code class={styles.code}>validate</code> (start {'→'} validate {'→'}{' '}
            cancel). Takes a brief reviewing lock on the annotation.
          </div>
          {err && <div class={dg.empty}>{err}</div>}
        </Fragment>
      )}
      {diff && (
        <Fragment>
          <div class={styles.sect}>Messages under today{'’'}s config</div>
          {diff.added.map((m, i) => (
            <div class={styles.ev + ' ' + styles.driftAdd} data-evidence-id={`drift:added:${i}`}>
              + {m.type}: {m.content}
            </div>
          ))}
          {diff.removed.map((m, i) => (
            <div class={styles.ev + ' ' + styles.driftDel} data-evidence-id={`drift:removed:${i}`}>
              {'−'} {m.type}: {m.content}
            </div>
          ))}
          {!diff.added.length && !diff.removed.length && (
            <div class={dg.empty}>
              No drift {'—'} today{'’'}s config produces the same messages.
            </div>
          )}
          <div class={styles.note}>
            {diff.matchedRules.length} rule(s) matched in the live run. The live result is not
            persisted.
          </div>
        </Fragment>
      )}
    </EvidenceSection>
  );
}
