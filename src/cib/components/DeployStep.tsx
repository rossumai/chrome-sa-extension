// src/cib/components/DeployStep.tsx
// Step 4: Check and deploy buttons, plus the resume form (collapsible <details> before the actions).
import { h, Fragment } from 'preact';
import type { RefObject } from 'preact';
import Step from './Step.jsx';
import styles from './App.module.css';
import ctl from '../../ui/controls.module.css';

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
  installed,
  onInstalledInput,
  onCheckUpgrade,
  onUpgrade,
  canUpgrade,
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
  installed: string;
  onInstalledInput: (e: any) => void;
  onCheckUpgrade: () => void;
  onUpgrade: () => void;
  // the last Check upgrade found something to write
  canUpgrade: boolean;
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
          class={`${ctl.btn} ${styles.btnLg}`}
          name="check"
          disabled={busy || !ready}
          data-help="check"
        >
          Check only
        </button>
        <button
          class={`${ctl.btn} ${ctl.btnPrimary} ${styles.btnLg} ${styles.deployBtn}`}
          name="deploy"
          ref={deployRef}
          disabled={busy || !ready}
          data-help="deploy"
        >
          Check and deploy
        </button>
      </div>
      <div class={styles.upgrade} data-help="upgrade">
        <div class={styles.groupHead}>Upgrade an installation</div>
        <span class={styles.hint}>
          Applies the latest release to an organization that already has CIB, where the organization
          still holds what the installed release set. A field the customer changed too is a
          conflict: it is listed and left as it is. Nothing is deleted.
        </span>
        <div class={styles.field}>
          <label class={styles.label} for="cib-installed">
            Installed release <span class={styles.tag}>only without an install record</span>
          </label>
          <input
            id="cib-installed"
            class={`input ${styles.input}`}
            type="text"
            placeholder="v2.0.0"
            value={installed}
            onInput={onInstalledInput}
          />
          <span class={styles.hint}>
            A deploy from this page records what it installed. For an organization deployed before,
            or by the deploy tool, leave it empty: Check upgrade compares the organization with each
            release and fills in the closest one, to confirm with a second Check upgrade. The Coupa
            URL and client ID come from step 2, else from the organization's CIB schemas.
          </span>
        </div>
        <div class={styles.actions}>
          <button
            type="button"
            class={`${ctl.btn} ${styles.btnLg}`}
            name="upgrade-check"
            disabled={busy || !ready}
            onClick={onCheckUpgrade}
          >
            Check upgrade
          </button>
          <button
            type="button"
            class={`${ctl.btn} ${ctl.btnPrimary} ${styles.btnLg}`}
            name="upgrade"
            disabled={busy || !ready || !canUpgrade}
            onClick={onUpgrade}
            title={canUpgrade ? undefined : 'Check upgrade first'}
          >
            Upgrade
          </button>
        </div>
      </div>
    </Step>
  );
}
