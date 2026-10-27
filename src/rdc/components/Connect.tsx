// Step 1: a token for the source org. The target uses the Console's own sign-in. The token is
// checked with one read and lives in this component's state only: it is handed to the page on
// success and never stored.
import { h } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { readableOrgs, type Source } from '../deploy.js';
import { isRateLimited, rateLimitMessage } from '../../net/rateLimit.js';
import { fetchOrgs as defaultFetch, type FetchOrgs } from './ChooseSource.jsx';
import Wip from './Wip.jsx';
import styles from './Deploy.module.css';

type Props = {
  source: Source;
  fetchOrgs?: FetchOrgs;
  onConnected: (token: string) => void;
  onBack: () => void;
};

const host = (d: string) => {
  try {
    return new URL(d).host;
  } catch {
    return d;
  }
};

export default function Connect({
  source,
  fetchOrgs: fetcher = defaultFetch,
  onConnected,
  onBack,
}: Props) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState('');
  // Voids a check that an edit of the token has outdated.
  const edits = useRef(0);
  const tok = token.trim();

  const check = async () => {
    if (!tok) {
      setError(`Give a token for ${source.name}.`);
      return;
    }
    setError('');
    setChecked('');
    const mine = ++edits.current;
    setBusy(true);
    try {
      const list = readableOrgs(await fetcher(source.domain, tok));
      if (mine !== edits.current) return;
      if (list.some((o) => o.id === source.orgId)) setChecked(tok);
      else setError(`This token cannot read ${source.orgName}, org ${source.orgId}.`);
    } catch (e) {
      if (mine !== edits.current) return;
      setError(
        isRateLimited(e)
          ? rateLimitMessage(e)
          : `Could not check the token: ${(e as Error).message}`,
      );
    } finally {
      if (mine === edits.current) setBusy(false);
    }
  };

  return (
    <div class={`${styles.wrap} ${styles.wz}`}>
      <div class={styles.wzH}>
        <h1>Connect to {source.name}</h1>
        <p>
          To read {source.name}, the Console needs a token for it. This org uses your current
          sign-in, so there is nothing to enter for it.
        </p>
      </div>
      <div class={styles.grid2}>
        <div class={styles.panel}>
          <div class={styles.panelHead}>
            <h2>{source.name}</h2>
          </div>
          <div class={`${styles.panelB} ${styles.stack}`}>
            <div class={styles.fld}>
              <label for="rdc-conn-token">API token for {host(source.domain)}</label>
              <input
                id="rdc-conn-token"
                type="password"
                autocomplete="off"
                value={token}
                onInput={(e) => {
                  edits.current++;
                  setToken((e.target as HTMLInputElement).value);
                  setChecked('');
                  setError('');
                  setBusy(false);
                }}
              />
              <small>Used for this deployment only, then forgotten.</small>
            </div>
            <div>
              <button class="btn btn-secondary" disabled={busy} onClick={check}>
                Check token
              </button>
            </div>
            {error && (
              <div class={`${styles.note} ${styles.err}`} role="alert">
                {error}
              </div>
            )}
            {checked && (
              <div class={styles.check}>
                The token can read {source.orgName}, org {source.orgId}
              </div>
            )}
          </div>
        </div>
        <div class={styles.panel}>
          <div class={styles.panelHead}>
            <h2>Hook secrets</h2>
          </div>
          <div class={styles.panelB}>
            <p class={styles.muted}>
              Rossum never shows a secret value. Type one only if this org needs a new or changed
              value.
            </p>
            <Wip feature="secrets" />
          </div>
        </div>
      </div>
      <div class={styles.foot}>
        <button class="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <span class={styles.sp}></span>
        <button class="btn btn-primary" disabled={!checked} onClick={() => onConnected(checked)}>
          Read both orgs
        </button>
      </div>
    </div>
  );
}
