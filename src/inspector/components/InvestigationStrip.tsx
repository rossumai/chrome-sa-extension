import { h } from 'preact';
import * as store from '../store.js';
import styles from './Inspector.module.css';

function stageState(stage: any, self: any) {
  const order = ['gathering', 'attributing', 'synthesizing', 'complete'];
  const cur = stage === 'agent-offline' ? 'complete' : stage;
  const a = order.indexOf(self);
  const b = order.indexOf(cur);
  if (b > a) return 'done';
  if (b === a) return 'run';
  return 'pend';
}

function Pill({ state, label, note }: { state?: string; label: string; note?: string | null }) {
  return (
    <span class={`${styles.invSt} ${styles[state as string]}`}>
      <span class={styles.invIc}>{state === 'done' ? '✓' : ''}</span> {label}
      {note ? <span class={styles.invNote}> {note}</span> : null}
    </span>
  );
}

// The visible investigation lifecycle (spec §4.3): Gather → Attribute → Synthesize.
export default function InvestigationStrip() {
  const inv = store.investigation.value;
  if (inv.stage === 'idle') return null;
  const attrs = Object.values(store.attributions.value);
  const ai = attrs.filter((a) => a.source === 'ai');
  const aiDone = ai.filter((a) => a.status !== 'loading').length;
  const loadingPhase = ai.find((a) => a.status === 'loading' && a.phase)?.phase;
  const activity = inv.activity || loadingPhase || '';

  if (inv.stage === 'complete' || inv.stage === 'agent-offline') {
    const unavailable = (store.evidence.value?.items || []).filter(
      (i: any) => i.reliability === 'unavailable',
    ).length;
    return (
      <div class={styles.inv}>
        <span class={styles.invSt + ' ' + styles.done}>
          <span class={styles.invIc}>{'✓'}</span> Investigation{' '}
          {inv.stage === 'agent-offline' ? 'finished (AI offline)' : 'complete'}
        </span>
        <span class={styles.invAct}>
          {inv.sourcesTotal} sources {'·'} {ai.length} attribution{ai.length === 1 ? '' : 's'}
          {unavailable ? ` · ${unavailable} unavailable` : ''}
        </span>
      </div>
    );
  }
  return (
    <div class={styles.inv}>
      <Pill
        state={stageState(inv.stage, 'gathering')}
        label="Gather"
        note={`${inv.sourcesDone}/${inv.sourcesTotal}`}
      />
      <span class={styles.invSep}>{'›'}</span>
      <Pill
        state={stageState(inv.stage, 'attributing')}
        label="Attribute"
        note={ai.length ? `${aiDone} of ${ai.length}` : ''}
      />
      <span class={styles.invSep}>{'›'}</span>
      <Pill state={stageState(inv.stage, 'synthesizing')} label="Synthesize" />
      {activity ? (
        <span class={styles.invAct}>
          {activity}
          {'…'}
        </span>
      ) : null}
    </div>
  );
}
