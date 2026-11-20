// Add or edit a saved server. The password or private key goes into the helper hook's secrets:
// Rossum never returns it, so an edit leaves the field empty and keeps the saved one unless
// something is typed.
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { errorText } from '../../net/rateLimit.js';
import type { AuthKind, Server, ServerInput } from '../servers.js';
import styles from './ServerForm.module.css';
import ctl from '../../ui/controls.module.css';
import inp from '../../ui/Input.module.css';
import seg from '../../ui/Segmented.module.css';
import eb from '../../ui/ErrorBanner.module.css';

type Props = {
  editing: Server | null;
  onSave: (input: ServerInput) => Promise<void>;
  onCancel: () => void;
};

export default function ServerForm({ editing, onSave, onCancel }: Props) {
  const [host, setHost] = useState(editing?.host ?? '');
  const [port, setPort] = useState(String(editing?.port ?? 22));
  const [user, setUser] = useState(editing?.user ?? '');
  const [auth, setAuth] = useState<AuthKind>(editing?.auth ?? 'password');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Switching the sign-in method needs the new secret; the saved one is of the other kind.
  const secretRequired = !editing || auth !== editing.auth;
  const portNumber = Number(port);
  const valid =
    host.trim() !== '' &&
    user.trim() !== '' &&
    Number.isInteger(portNumber) &&
    portNumber > 0 &&
    portNumber < 65536 &&
    (!secretRequired || secret !== '');
  const what = auth === 'key' ? 'private key' : 'password';

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave({ host: host.trim(), port: portNumber, user: user.trim(), auth, secret });
    } catch (err) {
      setError(errorText(err, 'The server could not be saved.'));
      setBusy(false);
    }
  };

  return (
    <form class={styles.card} onSubmit={submit} autoComplete="off">
      <div class={styles.title}>
        {editing ? `Edit ${editing.user}@${editing.host}:${editing.port}` : 'Add server'}
      </div>
      <div class={styles.body}>
        <div class={styles.row}>
          <label class={styles.field}>
            <span class={styles.label}>Host</span>
            <input
              class={`${inp.input} ${styles.mono}`}
              value={host}
              onInput={(e) => setHost((e.target as HTMLInputElement).value)}
              placeholder="sftp.example.com"
              required
            />
          </label>
          <label class={styles.field}>
            <span class={styles.label}>Port</span>
            <input
              class={`${inp.input} ${styles.mono}`}
              value={port}
              inputMode="numeric"
              onInput={(e) => setPort((e.target as HTMLInputElement).value)}
              required
            />
          </label>
        </div>
        <label class={styles.field}>
          <span class={styles.label}>User</span>
          <input
            class={`${inp.input} ${styles.mono}`}
            value={user}
            onInput={(e) => setUser((e.target as HTMLInputElement).value)}
            required
          />
        </label>
        <div class={seg.root} role="group" aria-label="Sign-in method">
          {(['password', 'key'] as const).map((k) => (
            <button
              type="button"
              class={seg.opt + (auth === k ? ' ' + seg.on : '')}
              aria-pressed={auth === k}
              onClick={() => setAuth(k)}
            >
              {k === 'password' ? 'Password' : 'Private key'}
            </button>
          ))}
        </div>
        <label class={styles.field}>
          <span class={styles.label}>{auth === 'key' ? 'Private key' : 'Password'}</span>
          {auth === 'key' ? (
            <textarea
              class={`${inp.input} ${styles.key}`}
              value={secret}
              onInput={(e) => setSecret((e.target as HTMLTextAreaElement).value)}
              placeholder={
                secretRequired
                  ? '-----BEGIN OPENSSH PRIVATE KEY-----'
                  : 'Saved. Paste a new key to replace it.'
              }
              spellcheck={false}
            />
          ) : (
            <input
              class={inp.input}
              type="password"
              value={secret}
              onInput={(e) => setSecret((e.target as HTMLInputElement).value)}
              placeholder={secretRequired ? '' : 'Saved. Type a new password to replace it.'}
            />
          )}
        </label>
        <p class={styles.note}>
          The {what} is saved as a secret of this server's helper hook in the org. Nobody can read
          it back, not even an admin, but anyone who can open the Console for this org can use the
          server.
        </p>
        {error && <div class={eb.root}>{error}</div>}
      </div>
      <div class={styles.foot}>
        <button type="button" class={`${ctl.btn} ${ctl.btnSecondary}`} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" class={`${ctl.btn} ${ctl.btnPrimary}`} disabled={!valid || busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Save and open'}
        </button>
      </div>
    </form>
  );
}
