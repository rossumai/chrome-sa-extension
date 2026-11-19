import { h } from 'preact';
import { domain, loading, pageInfo } from '../store.js';
import { connectedOrg } from '../../console/store.js';
import cb from '../../ui/ConnectionBar.module.css';

export default function ConnectionBar({ connected }: { connected: boolean | null }) {
  if (!connected) {
    return (
      <div class={cb.bar}>
        <span class={`${cb.dot} ${cb.error}`}></span>
        Not connected — open a Rossum page and click Audit Logs in the extension popup
      </div>
    );
  }
  return (
    <div class={cb.bar}>
      <span class={cb.dot + (loading.value ? ' ' + cb.busy : '')}></span>
      Audit Logs · Connected to {prettyDomain(domain.value)}
      {connectedOrg.value ? ` \u00b7 ${connectedOrg.value}` : ''}
      {pageInfo.value.total != null && (
        <span class="connection-meta">{pageInfo.value.total.toLocaleString()} records</span>
      )}
    </div>
  );
}

function prettyDomain(d: string) {
  try {
    return new URL(d).host;
  } catch {
    return d;
  }
}
