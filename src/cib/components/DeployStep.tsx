// src/cib/components/DeployStep.tsx
// Step 4: Check and deploy buttons, plus the resume form (collapsible <details> before the actions).
import { h, Fragment } from 'preact';
import type { RefObject } from 'preact';
import Step from './Step.jsx';
import styles from './App.module.css';

export default function DeployStep({
  runId,
  allow,
  onRunIdInput,
  onAllowChange,
  ready,
  busy,
  state,
  deployRef,
  resumeRef,
}: {
  runId: string;
  allow: boolean;
  onRunIdInput: (e: any) => void;
  onAllowChange: (e: any) => void;
  ready: boolean;
  busy: boolean;
  state: 'complete' | 'current' | 'optional' | undefined;
  deployRef: RefObject<HTMLButtonElement | null>;
  resumeRef: RefObject<HTMLDetailsElement | null>;
}) {
  return (
    <Step
      n={4}
      state={state}
      title="Deploy"
      sub={
        <>
          <b>Check and deploy</b> runs the checks first and writes nothing if one fails.{' '}
          <b>Check only</b> runs the checks and stops.
        </>
      }
    >
      <details class={styles.resume} ref={resumeRef} data-help="resume">
        <summary>
          Resume and re-run · run ID <code>{runId}</code>
        </summary>
        <div class={styles.g2}>
          <div class={styles.field}>
            <label class={styles.label} for="cib-run">
              Run ID
            </label>
            <input
              id="cib-run"
              class={`input ${styles.input}`}
              type="text"
              required
              value={runId}
              onInput={onRunIdInput}
              // a closed <details> hides it, and Chrome cannot point at a hidden field
              onInvalid={() => resumeRef.current && (resumeRef.current.open = true)}
            />
            <span class={styles.hint}>
              Deploy saves its progress under this ID. Deploy again with the same ID to resume; a
              resumed run skips the checks.
            </span>
          </div>
          <label class={styles.checkbox}>
            <input type="checkbox" checked={allow} onChange={onAllowChange} />
            <span>
              Continue a half-built deploy
              <span class={styles.hint}>
                Adopt CIB objects already in the org by name, instead of stopping at them.
              </span>
            </span>
          </label>
        </div>
      </details>
      <div class={styles.actions}>
        <button
          class={`btn ${styles.btnLg}`}
          name="check"
          disabled={busy || !ready}
          data-help="check"
        >
          Check only
        </button>
        <button
          class={`btn btn-primary ${styles.btnLg} ${styles.deployBtn}`}
          name="deploy"
          ref={deployRef}
          disabled={busy || !ready}
          data-help="deploy"
        >
          Check and deploy
        </button>
      </div>
    </Step>
  );
}
