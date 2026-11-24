// src/cib/components/CredentialsStep.tsx
// Step 2: the Coupa OAuth credentials. URL and client ID are required; the secret is too, unless
// the user ticks that the organization's admin adds it after the deploy. It never leaves this page.
import { h, Fragment } from 'preact';
import Step from './Step.jsx';
import styles from './App.module.css';
import inp from '../../ui/Input.module.css';

export default function CredentialsStep({
  coupaUrl,
  coupaId,
  coupaSecret,
  onInput,
  showSecret,
  onToggleSecret,
  noSecret,
  onNoSecret,
  state,
}: {
  coupaUrl: string;
  coupaId: string;
  coupaSecret: string;
  onInput: (key: 'coupaUrl' | 'coupaId' | 'coupaSecret') => (e: any) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
  noSecret: boolean;
  onNoSecret: (e: any) => void;
  state: 'complete' | 'current' | 'optional' | undefined;
}) {
  return (
    <Step
      n={2}
      state={state}
      title="Coupa credentials"
      sub="The OAuth client the CIB hooks use to call Coupa."
      footer={
        <span class={styles.footNote} data-help="secret-note">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          The secret stays in this page's memory. The deploy checkpoint stores only a placeholder.
        </span>
      }
    >
      <div class={styles.field} data-help="coupa-url">
        <label class={styles.label} for="cib-coupa-url">
          Coupa URL
        </label>
        <input
          id="cib-coupa-url"
          class={`${inp.input} ${styles.input}`}
          type="text"
          required
          placeholder="https://example.coupahost.com"
          value={coupaUrl}
          onInput={onInput('coupaUrl')}
        />
      </div>
      <div class={styles.g2}>
        <div class={styles.field}>
          <label class={styles.label} for="cib-coupa-id">
            Client ID
          </label>
          <input
            id="cib-coupa-id"
            class={`${inp.input} ${styles.input}`}
            type="text"
            required
            value={coupaId}
            onInput={onInput('coupaId')}
          />
        </div>
        <div class={styles.field} data-help="client-secret">
          <label class={styles.label} for="cib-coupa-secret">
            Client secret
          </label>
          <div class={styles.inputWrap}>
            <input
              id="cib-coupa-secret"
              class={`${inp.input} ${styles.input} ${styles.hasToggle}`}
              type={(showSecret ? 'text' : 'password') as 'text'}
              required={!noSecret}
              disabled={noSecret}
              autocomplete="off"
              value={noSecret ? '' : coupaSecret}
              onInput={onInput('coupaSecret')}
            />
            <button type="button" class={styles.eye} onClick={onToggleSecret}>
              {showSecret ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      </div>
      <label class={styles.checkbox} data-help="no-secret">
        <input type="checkbox" checked={noSecret} onChange={onNoSecret} />
        <span>
          Deploy without the secret: the organization's admin adds it
          <span class={styles.hint}>
            {noSecret
              ? "The hooks that need it are created active but without the secret, so imports and exports fail until the admin pastes client_secret into each hook's Secrets. The result lists every one, with its link. The Coupa login test and the first imports are skipped."
              : 'For a customer who keeps the secret. The result then lists the hooks to paste it into.'}
          </span>
        </span>
      </label>
    </Step>
  );
}
