// SFTP (experimental): browse the SFTP servers an org imports from and exports to. A browser
// extension cannot open a TCP connection, so every SFTP call runs in a helper hook in the
// connected org (servers.ts, helperCode.ts): the Console invokes it and it talks SSH. The
// first view lists the org's saved servers; opening one browses it, and the bar's "SFTP
// servers" goes back to the list — there is no disconnect, since nothing stays connected
// between calls.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { connectedOrg } from '../../console/store.js';
import { errorText } from '../../net/rateLimit.js';
import Modal from '../../ui/Modal.jsx';
import { listServers as defaultListServers } from '../api.js';
import { addressOf, type Server } from '../servers.js';
import Servers from './Servers.jsx';
import Browser from './Browser.jsx';
import styles from './App.module.css';
import es from '../../ui/EmptyState.module.css';
import cb from '../../ui/ConnectionBar.module.css';
import shell from '../../ui/AppShell.module.css';

type Props = {
  connected: boolean | null;
  // Injectable for tests; production lists the org's hooks.
  listServers?: () => Promise<Server[]>;
};

export default function App({ connected, listServers = defaultListServers }: Props) {
  // undefined while loading
  const [servers, setServers] = useState<Server[] | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState<Server | null>(null);

  const load = () => {
    setLoadError('');
    listServers().then(setServers, (e) => {
      setServers([]);
      setLoadError(errorText(e, 'The saved servers could not be loaded.'));
    });
  };
  useEffect(() => {
    if (connected) load();
  }, [connected]);

  if (!connected) {
    return (
      <div class={shell.root}>
        <main class={shell.main}>
          <div class={es.root}>Open the Console from a Rossum page to use SFTP.</div>
        </main>
      </div>
    );
  }

  // An edit or a pinned host key comes back from the browser as a new object.
  const replace = (s: Server) => {
    setServers((list) => list?.map((x) => (x.hookId === s.hookId ? s : x)));
    setOpen((o) => (o && o.hookId === s.hookId ? s : o));
  };

  return (
    <div class={shell.root}>
      <main class={shell.main}>
        <div class={cb.bar}>
          <button
            type="button"
            class={styles.home + (open ? '' : ' ' + styles.homeHere)}
            onClick={() => setOpen(null)}
            aria-current={open ? undefined : 'page'}
          >
            SFTP servers
          </button>
          {open && (
            <span class={styles.where}>
              <span class={styles.sep}>/</span>
              <span class={cb.dot}></span>
              <span title={open.hostKey ? `Host key ${open.hostKey}` : undefined}>
                {addressOf(open)}
              </span>
            </span>
          )}
          {connectedOrg.value && <span class={styles.org}>{connectedOrg.value}</span>}
        </div>
        {open ? (
          <Browser key={open.hookId} server={open} onServer={replace} />
        ) : (
          <Servers
            servers={servers}
            loadError={loadError}
            onRetry={load}
            onOpen={setOpen}
            onSaved={(s, isNew) => {
              if (isNew) {
                setServers((list) => [...(list ?? []), s]);
                setOpen(s);
              } else replace(s);
            }}
            onRemoved={(s) => setServers((list) => list?.filter((x) => x.hookId !== s.hookId))}
          />
        )}
      </main>
      <Modal />
    </div>
  );
}
