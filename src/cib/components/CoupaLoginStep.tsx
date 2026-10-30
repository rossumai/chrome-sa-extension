// src/cib/components/CoupaLoginStep.tsx
// Step 3: where the checks log in to Coupa. The radio is UI state only; the engine always uses the
// check function when one exists, else the browser, and the panel never contradicts that.
import { h, Fragment } from 'preact';
import { loginPanel } from '../view.js';
import type { LoginRoute } from '../view.js';
import styles from './App.module.css';

export default function CoupaLoginStep({
  route,
  probe,
  probePage,
  busy,
  onRoute,
  onCreate,
  onRemove,
}: {
  route: LoginRoute;
  probe: string | null;
  probePage: string | null;
  busy: boolean;
  onRoute: (r: LoginRoute) => void;
  onCreate: () => void;
  onRemove: () => void;
}) {
  const panel = loginPanel(route, !!probe);
  const radio = (value: LoginRoute, title: any, text: string) => (
    <label class={styles.route}>
      <input
        type="radio"
        name="cib-route"
        value={value}
        checked={route === value}
        onChange={() => onRoute(value)}
      />
      <b>
        <span class={styles.dot}></span>
        {title}
      </b>
      {text}
    </label>
  );
  const remove = (
    <button type="button" class="btn" disabled={busy} onClick={onRemove}>
      Remove check function
    </button>
  );
  return (
    <div class={styles.stepBody}>
      <div class={styles.field}>
        <span class={styles.label}>Where should the checks log in to Coupa from?</span>
        <div class={styles.routes} role="radiogroup">
          {radio(
            'browser',
            <>
              This browser <span class={styles.tag}>default</span>
            </>,
            'Nothing to set up. Chrome asks once for permission to reach Coupa. If you refuse, Check skips the test and says so.',
          )}
          {radio(
            'org',
            'The Rossum organization',
            "A small function in the org logs in from Rossum's servers. Use it when this browser cannot reach Coupa, for example when Coupa accepts only known IP addresses.",
          )}
        </div>
      </div>
      {panel === 'browser-ready' && (
        <div class={styles.setup}>
          <span class={styles.setupIco}>✓</span>
          <span class={styles.setupTxt}>
            <b>Ready. Nothing to set up.</b>
            <span class={styles.hint}>Check logs in from this browser.</span>
          </span>
        </div>
      )}
      {panel === 'create' && (
        <div class={styles.setup}>
          <span class={styles.setupIco}>1</span>
          <span class={styles.setupTxt}>
            <b>Create the check function first</b>
            Creates the hook <i>CIB deploy: Coupa credentials check</i> in the org: manual trigger,
            no queues. It gets the secret only during a Check. The org must allow functions to call
            HTTPS hosts.
            <span class={styles.hint}>Until it exists, Check logs in from this browser.</span>
          </span>
          <button type="button" class="btn btn-primary" disabled={busy} onClick={onCreate}>
            Create check function
          </button>
        </div>
      )}
      {panel === 'org-ready' && (
        <div class={`${styles.setup} ${styles.setupOk}`}>
          <span class={styles.setupIco}>✓</span>
          <span class={styles.setupTxt}>
            <b>Ready. Check logs in from the organization.</b>
            Check function:{' '}
            <a href={probePage ?? undefined} target="_blank" rel="noreferrer">
              hook {probePage?.split('/').pop()} ↗
            </a>
            <span class={styles.hint}>
              It is not part of CIB. Remove it when you have finished deploying.
            </span>
          </span>
          {remove}
        </div>
      )}
      {panel === 'stale' && (
        <div class={`${styles.setup} ${styles.setupWarn}`}>
          <span class={styles.setupIco}>!</span>
          <span class={styles.setupTxt}>
            <b>A check function still exists in this org</b>
            While it exists, Check logs in from the organization, not from this browser.
          </span>
          {remove}
        </div>
      )}
    </div>
  );
}
