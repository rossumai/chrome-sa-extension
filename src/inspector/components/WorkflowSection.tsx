import { h } from 'preact';
import * as store from '../store.js';
import EvidenceSection from './EvidenceSection.jsx';
import styles from './Inspector.module.css';

// Approval-workflow state: run status + ordered steps, current step marked.
export default function WorkflowSection() {
  const items = (store.evidence.value?.items || []).filter((i: any) => i.section === 'workflow');
  const run = items.find((i: any) => i.id === 'workflow:run');
  const status = !store.data.value?.resolved?._workflowLoaded
    ? 'pending'
    : items.length
      ? 'loaded'
      : 'na';
  return (
    <EvidenceSection
      id="workflow"
      title="Approval workflow"
      count={status === 'pending' ? null : run ? run.data.status : 'no workflow'}
      status={status}
    >
      {items.map((i: any) => (
        <div
          class={styles.ev + (i.data?.current ? ' ' + styles.wfCurrent : '')}
          data-evidence-id={i.id}
        >
          <span class={styles.evId}>{i.id}</span>
          {i.fact}
        </div>
      ))}
    </EvidenceSection>
  );
}
