// src/cib/components/CredentialsStep.tsx
// Step 2: the Coupa OAuth credentials. Every field is required; the secret never leaves this page.
import { h, Fragment } from 'preact';
import Step from './Step.jsx';
import styles from './App.module.css';

export default function CredentialsStep({
  coupaUrl,
  coupaId,
  coupaSecret,
  onInput,
  showSecret,
  onToggleSecret,
  state,
}: {
  coupaUrl: string;
  coupaId: string;
  coupaSecret: string;
  onInput: (key: 'coupaUrl' | 'coupaId' | 'coupaSecret') => (e: any) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
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
          class={`input ${styles.input}`}
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
            class={`input ${styles.input}`}
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
              class={`input ${styles.input} ${styles.hasToggle}`}
              type={(showSecret ? 'text' : 'password') as 'text'}
              required
              autocomplete="off"
              value={coupaSecret}
              onInput={onInput('coupaSecret')}
            />
            <button type="button" class={styles.eye} onClick={onToggleSecret}>
              {showSecret ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      </div>
    </Step>
  );
}
