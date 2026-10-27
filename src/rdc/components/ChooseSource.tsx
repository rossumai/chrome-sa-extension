// The inline form, hidden until asked for, that picks the one org this org deploys from. The
// token lives in this component's state only: closing the form unmounts it and the token goes
// with it. Choosing deploys nothing; it only names the source.
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { apiBaseOf } from '../core.js';
import { readableOrgs, type Source } from '../deploy.js';
import { isRateLimited, rateLimitError, rateLimitMessage } from '../../net/rateLimit.js';
import styles from './Deploy.module.css';

export type FetchOrgs = (domain: string, token: string) => Promise<unknown>;

export const fetchOrgs: FetchOrgs = async (domain, token) => {
  const res = await fetch(`${domain}/api/v1/organizations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) throw rateLimitError(res, 'HTTP 429');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const originOf = (domain: string) => {
  try {
    return new URL(domain).origin;
  } catch {
    return domain;
  }
};

type Props = {
  onCancel: () => void;
  // The token the org was found with goes along, so step 1 does not ask for it again.
  onChosen: (s: Source, token: string) => void;
  fetchOrgs?: FetchOrgs;
  // The connected org is the target; it cannot also be the source.
  targetDomain: string;
  targetOrgId: number;
};

export default function ChooseSource({
  onCancel,
  onChosen,
  fetchOrgs: fetcher = fetchOrgs,
  targetDomain,
  targetOrgId,
}: Props) {
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  // The API lists exactly one organization for an address and token.
  const [org, setOrg] = useState<{ id: number; name: string } | null>(null);
  const [name, setName] = useState('test');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The origin the list was read from, and a counter that voids a read an edit has outdated.
  const [foundDomain, setFoundDomain] = useState('');
  const edits = useRef(0);
  const addressInput = useRef<HTMLInputElement>(null);

  // The form appears on a click, so the first field takes the focus.
  useEffect(() => addressInput.current?.focus(), []);

  const edited = () => {
    edits.current++;
    setOrg(null);
    setFoundDomain('');
    setBusy(false);
  };

  const find = async () => {
    setError('');
    setOrg(null);
    const addr = address.trim();
    const tok = token.trim();
    const base = apiBaseOf(addr);
    if (!base) {
      setError(`Not a Rossum URL: ${addr}`);
      return;
    }
    if (!tok) {
      setError('Give a token for it.');
      return;
    }
    const origin = new URL(addr).origin;
    const mine = ++edits.current;
    setBusy(true);
    try {
      const list = readableOrgs(await fetcher(origin, tok));
      if (mine !== edits.current) return;
      if (list.length !== 1)
        setError(`Expected one organization for this token, got ${list.length}.`);
      else {
        setOrg(list[0]);
        setFoundDomain(origin);
      }
    } catch (e) {
      if (mine !== edits.current) return;
      setError(
        isRateLimited(e)
          ? rateLimitMessage(e)
          : `Could not read the organizations: ${(e as Error)?.message || String(e)}`,
      );
    } finally {
      if (mine === edits.current) setBusy(false);
    }
  };

  const chosen = org;
  const shortName = name.trim();
  const confirm = () => {
    if (!chosen || !shortName || !foundDomain) return;
    if (chosen.id === targetOrgId && foundDomain === originOf(targetDomain)) {
      setError('This is the org you are signed into. Choose another org to deploy from.');
      return;
    }
    setError('');
    onChosen(
      { name: shortName, domain: foundDomain, orgId: chosen.id, orgName: chosen.name },
      token.trim(),
    );
  };

  return (
    <section class={styles.form} aria-label="Choose the org to deploy from">
      <h2>Choose the org to deploy from</h2>
      <div class={styles.fld}>
        <label for="rdc-src-address">Rossum address</label>
        <input
          id="rdc-src-address"
          ref={addressInput}
          type="text"
          placeholder="https://partner-sandbox.rossum.app"
          value={address}
          onInput={(e) => {
            setAddress((e.target as HTMLInputElement).value);
            edited();
          }}
        />
      </div>
      <div class={styles.fld}>
        <label for="rdc-src-token">API token</label>
        <input
          id="rdc-src-token"
          type="password"
          autocomplete="off"
          value={token}
          onInput={(e) => {
            setToken((e.target as HTMLInputElement).value);
            edited();
          }}
        />
        <small>Only to find the organization. It is not kept.</small>
      </div>
      <div>
        <button class="btn btn-secondary" disabled={busy} onClick={find}>
          Find organizations
        </button>
      </div>
      {error && (
        <div class={`${styles.note} ${styles.err}`} role="alert">
          {error}
        </div>
      )}
      {org && (
        <div class={styles.check} role="status">
          Found {org.name}, org {org.id}
        </div>
      )}
      {org && (
        <div class={styles.fld}>
          <label for="rdc-src-name">Short name</label>
          <input
            id="rdc-src-name"
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <small>Shown on this page.</small>
        </div>
      )}
      <div class={styles.formFoot}>
        <button class="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          class="btn btn-primary"
          disabled={!chosen || !shortName || !foundDomain}
          onClick={confirm}
        >
          Use {shortName || 'it'} as the source
        </button>
      </div>
    </section>
  );
}
