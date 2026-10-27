// The modal that picks the one org this org deploys from. The token lives in this component's
// state only: closing the modal unmounts it and the token goes with it.
import { h } from 'preact';
import { useRef, useState } from 'preact/hooks';
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
  onChosen: (s: Source) => void;
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
  const [orgs, setOrgs] = useState<{ id: number; name: string }[] | null>(null);
  const [orgId, setOrgId] = useState<number | null>(null);
  const [name, setName] = useState('test');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The origin the list was read from, and a counter that voids a read an edit has outdated.
  const [foundDomain, setFoundDomain] = useState('');
  const edits = useRef(0);

  const edited = () => {
    edits.current++;
    setOrgs(null);
    setOrgId(null);
    setFoundDomain('');
    setBusy(false);
  };

  const find = async () => {
    setError('');
    setOrgs(null);
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
      if (!list.length) setError('This token can read no organizations.');
      else {
        setOrgs(list);
        setOrgId(list[0].id);
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

  const chosen = orgs?.find((o) => o.id === orgId);
  const shortName = name.trim();
  const confirm = () => {
    if (!chosen || !shortName || !foundDomain) return;
    if (chosen.id === targetOrgId && foundDomain === originOf(targetDomain)) {
      setError('This is the org you are signed into. Choose another org to deploy from.');
      return;
    }
    setError('');
    onChosen({
      name: shortName,
      domain: foundDomain,
      orgId: chosen.id,
      orgName: chosen.name,
    });
  };

  return (
    <div class={styles.scrim}>
      <div class={styles.modal} role="dialog" aria-label="Choose the org to deploy from">
        <div class={styles.mh}>
          Choose the org to deploy from
          <button class="btn btn-secondary" aria-label="Close" onClick={onCancel}>
            ×
          </button>
        </div>
        <div class={styles.mb}>
          <div class={styles.fld}>
            <label for="rdc-src-address">Rossum address</label>
            <input
              id="rdc-src-address"
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
          {orgs && (
            <div class={styles.fld}>
              <label for="rdc-src-org">Organization</label>
              <select
                id="rdc-src-org"
                value={String(orgId)}
                onChange={(e) => setOrgId(Number((e.target as HTMLSelectElement).value))}
              >
                {orgs.map((o) => (
                  <option value={String(o.id)}>
                    {o.name}, org {o.id}
                  </option>
                ))}
              </select>
              <small>The organizations this token can read.</small>
            </div>
          )}
          {orgs && (
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
        </div>
        <div class={styles.mf}>
          <button class="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            disabled={!chosen || !shortName || !foundDomain}
            onClick={confirm}
          >
            Deploy from {shortName || 'source'}
          </button>
        </div>
      </div>
    </div>
  );
}
