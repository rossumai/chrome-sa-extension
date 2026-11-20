// The org's saved SFTP servers, one helper hook each, with Add, Edit and Remove. Remove deletes
// the hook and its saved secret; files on the server are not touched.
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { confirmModal } from '../../ui/Modal.jsx';
import { errorText } from '../../net/rateLimit.js';
import {
  createServer as defaultCreate,
  editServer as defaultEdit,
  removeServer as defaultRemove,
} from '../api.js';
import { addressOf, type Server, type ServerInput } from '../servers.js';
import ServerForm from './ServerForm.jsx';
import styles from './Servers.module.css';
import ctl from '../../ui/controls.module.css';
import eb from '../../ui/ErrorBanner.module.css';

type Props = {
  servers: Server[] | undefined;
  loadError: string;
  onRetry: () => void;
  onOpen: (s: Server) => void;
  onSaved: (s: Server, isNew: boolean) => void;
  onRemoved: (s: Server) => void;
  // Injectable for tests.
  createServer?: (input: ServerInput) => Promise<Server>;
  editServer?: (s: Server, input: ServerInput) => Promise<Server>;
  removeServer?: (s: Server) => Promise<void>;
};

const SERVER_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </svg>
);

export default function Servers({
  servers,
  loadError,
  onRetry,
  onOpen,
  onSaved,
  onRemoved,
  createServer = defaultCreate,
  editServer = defaultEdit,
  removeServer = defaultRemove,
}: Props) {
  // null: no form; 'new': adding; a server: editing it
  const [form, setForm] = useState<Server | 'new' | null>(null);
  const [error, setError] = useState('');

  const save = async (input: ServerInput) => {
    if (form === 'new') {
      const s = await createServer(input);
      setForm(null);
      onSaved(s, true);
    } else if (form) {
      const s = await editServer(form, input);
      setForm(null);
      onSaved(s, false);
    }
  };

  const remove = async (s: Server) => {
    const yes = await confirmModal(
      'Remove server',
      <span>
        Remove <span class={styles.addr}>{addressOf(s)}</span> from this org? This deletes its
        helper hook and the saved {s.auth === 'key' ? 'private key' : 'password'}. Files on the
        server are not touched.
      </span>,
    );
    if (!yes) return;
    setError('');
    try {
      await removeServer(s);
      onRemoved(s);
    } catch (e) {
      setError(errorText(e, 'The server could not be removed.'));
    }
  };

  const list = servers ?? [];
  return (
    <div class={styles.page}>
      <div class={styles.inner}>
        <div class={styles.head}>
          <div>
            <h2 class={styles.title}>SFTP servers in this org</h2>
            <p class={styles.lead}>
              Open a server to check that a file arrived, read it, or place a test file.
            </p>
          </div>
          {form === null && (
            <button
              type="button"
              class={`${ctl.btn} ${ctl.btnPrimary}`}
              onClick={() => setForm('new')}
            >
              Add server
            </button>
          )}
        </div>

        {(loadError || error) && (
          <div class={eb.root}>
            <span>{loadError || error}</span>
            {loadError && (
              <button type="button" class={`${ctl.btn} ${ctl.btnSm}`} onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        )}

        {servers === undefined ? (
          <p class={styles.lead}>Loading{'…'}</p>
        ) : list.length === 0 && !loadError ? (
          form === null && (
            <div class={styles.none}>
              No servers yet. Add the server this org imports from or exports to.
            </div>
          )
        ) : (
          <ul class={styles.list}>
            {list.map((s) => (
              <li key={s.hookId}>
                <div
                  class={styles.server}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${addressOf(s)}`}
                  onClick={() => onOpen(s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(s);
                  }}
                >
                  <span class={styles.icon}>{SERVER_ICON}</span>
                  <span class={styles.main}>
                    <span class={styles.addr}>{addressOf(s)}</span>
                    <span class={styles.sub}>
                      {s.auth === 'key' ? 'Private key' : 'Password'} · helper hook {s.hookId}
                      {s.hostKey ? '' : ' · not opened yet'}
                    </span>
                  </span>
                  <span class={styles.actions}>
                    <button
                      type="button"
                      class={`${ctl.btn} ${ctl.btnSm}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setForm(s);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class={`${ctl.btn} ${ctl.btnSm}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(s);
                      }}
                    >
                      Remove
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {form !== null && (
          <ServerForm
            key={form === 'new' ? 'new' : form.hookId}
            editing={form === 'new' ? null : form}
            onSave={save}
            onCancel={() => setForm(null)}
          />
        )}
      </div>
    </div>
  );
}
