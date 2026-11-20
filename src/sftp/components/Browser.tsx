// One server's files: a path, the arrival strip, the file list and the preview pane. Every
// action is one invocation of the server's helper hook (api.ts `invoke`) — a file over 3 MB is
// several, one per part (transfer.ts) — and every change ends with a fresh listing in the same
// session, so the table never shows a guess. Each listing brings its subfolders' listings too,
// kept for the visit, so opening a folder seen before is instant and refreshed quietly. The first
// successful call pins the server's host key (and refreshes stale helper code); a later key
// change stops every call until the user trusts the new key.
import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { closeModal, confirmModal, promptModal } from '../../ui/Modal.jsx';
import { errorText } from '../../net/rateLimit.js';
import FilterInput from '../../ui/FilterInput.jsx';
import {
  invoke as defaultInvoke,
  pinServer as defaultPin,
  type HelperError,
  type Op,
  type OpResult,
} from '../api.js';
import { addressOf, type Server } from '../servers.js';
import { dayOf, sameDay, type Entry } from '../arrivals.js';
import { base64ToBytes, bytesToBase64 } from '../preview.js';
import {
  CHUNK_BYTES,
  PREVIEW_BYTES,
  Cancelled,
  joinParts,
  partPathOf,
  rangesOf,
  type Range,
} from '../transfer.js';
import { formatSize, formatWhen, joinPath, parentOf, segmentsOf } from '../format.js';
import Arrivals from './Arrivals.jsx';
import Preview from './Preview.jsx';
import styles from './Browser.module.css';
import ctl from '../../ui/controls.module.css';
import eb from '../../ui/ErrorBanner.module.css';

type Props = {
  server: Server;
  onServer: (s: Server) => void;
  // Injectable for tests.
  invoke?: typeof defaultInvoke;
  pinServer?: typeof defaultPin;
  now?: () => Date;
};

const DIR_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4.2l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
const FILE_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    aria-hidden="true"
  >
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);
const DOWNLOAD_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    aria-hidden="true"
  >
    <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />
  </svg>
);
const DELETE_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    aria-hidden="true"
  >
    <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" />
  </svg>
);

type Busy = { label: string; since: number; quiet: boolean; done?: number; total?: number };

// Folders first by name, then files newest first. The unfinished part of an upload (see
// transfer.ts) is not a file anyone put there, so it is not listed.
function sorted(entries: Entry[]): Entry[] {
  return entries
    .filter((e) => e.name !== '.' && e.name !== '..' && !/^\..+\.part$/.test(e.name))
    .sort((a, b) =>
      a.dir !== b.dir ? (a.dir ? -1 : 1) : a.dir ? a.name.localeCompare(b.name) : b.mtime - a.mtime,
    );
}

function saveFile(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Browser({
  server,
  onServer,
  invoke = defaultInvoke,
  pinServer = defaultPin,
  now = () => new Date(),
}: Props) {
  const serverRef = useRef(server);
  serverRef.current = server;
  const [dir, setDir] = useState('');
  const shownDir = useRef('');
  // The folder the user asked for last; a slower answer for another one only fills the cache.
  const wanted = useRef('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  // Every listing seen this visit, by path, from a call or from its parent's `children`.
  const cache = useRef(new Map<string, Entry[]>());
  // The calls in flight. A quiet one (a cached folder being refreshed) shows on the toolbar line
  // only; any other one covers the file list with what it does and, for a transfer, how far.
  const [busy, setBusy] = useState<Busy | null>(null);
  const inFlight = useRef(0);
  const cancelRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  // The helper is a fresh or just-updated function and still starting: say why it is slow.
  const [starting, setStarting] = useState(false);
  const [, setTick] = useState(0);
  const [error, setError] = useState<HelperError | null>(null);
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');
  const [day, setDay] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // The elapsed seconds on the busy line.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy !== null]);

  // One session for `ops`. A helper whose code is older than this build is updated first, so
  // the call runs the current code; the first success pins the host key.
  const release = () => {
    if (--inFlight.current === 0) {
      setBusy(null);
      setStarting(false);
    }
  };
  // Keeps the busy state across the several calls of one transfer, so it does not flicker.
  const hold = async <T,>(fn: () => Promise<T>): Promise<T> => {
    inFlight.current++;
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const call = async (ops: Op[], label: string, quiet = false): Promise<OpResult[]> => {
    inFlight.current++;
    setBusy((b) =>
      !b ? { label, since: Date.now(), quiet } : quiet ? b : { ...b, label, quiet: false },
    );
    try {
      let s = serverRef.current;
      if (s.stale) {
        s = await pinServer(s, null);
        serverRef.current = s;
        onServer(s);
      }
      const r = await invoke(s, ops, () => setStarting(true));
      if (r.hostKey && !s.hostKey)
        pinServer(s, r.hostKey).then(onServer, () => {
          // Best effort: the next call pins it.
        });
      return r.results;
    } finally {
      release();
    }
  };

  // Compared with the folder ON SCREEN, not the `dir` this render's closure saw: a load that
  // showed a cached folder and then refreshed it would otherwise take its own refresh for a
  // change of folder and close the file the user picked in between.
  const show = (path: string, list: Entry[]) => {
    if (path !== shownDir.current) {
      setFilter('');
      setDay(null);
      setSelected(null);
    }
    shownDir.current = path;
    setDir(path);
    setEntries(list);
  };

  // Lists `path` after `before` in one call, with its subfolders, so opening one of them next
  // shows at once. A cached folder is shown first and refreshed quietly.
  const load = async (path: string, before: Op[] = [], done = '', label = '') => {
    setNote('');
    wanted.current = path;
    const cached = before.length === 0 ? cache.current.get(path) : undefined;
    if (cached) {
      show(path, cached);
      setError(null);
    }
    try {
      const results = await call(
        [...before, { op: 'list', path: path || '.', depth: 1 }],
        label || `Opening ${path || server.host}`,
        !!cached,
      );
      const listing = results[results.length - 1];
      const failed = results.slice(0, -1).find((r) => !r.ok);
      if (!listing?.ok) throw new Error(listing?.error || 'The folder could not be listed.');
      const list = sorted(listing.entries ?? []);
      cache.current.set(path, list);
      for (const [name, children] of Object.entries(listing.children ?? {}))
        cache.current.set(joinPath(path, name), sorted(children));
      if (wanted.current !== path) return;
      show(path, list);
      setError(failed ? new Error(failed.error || 'The action failed.') : null);
      setNote(failed ? '' : done);
    } catch (e) {
      if (wanted.current === path) setError(e as HelperError);
    }
  };

  useEffect(() => {
    load('');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const trustNewKey = async (hostKey: string) => {
    setError(null);
    try {
      onServer(await pinServer(serverRef.current, hostKey));
      await load(dir);
    } catch (e) {
      setError(e as HelperError);
    }
  };

  const transferring = (label: string, done: number, total: number) =>
    setBusy((b) => ({ label, since: b?.since ?? Date.now(), quiet: false, done, total }));

  // The whole file, part by part.
  const fetchFile = (
    path: string,
    name: string,
    size: number,
    label = `Downloading ${name}`,
  ): Promise<Uint8Array> =>
    hold(async () => {
      cancelRef.current = false;
      setCancelling(false);
      const parts: Uint8Array[] = [];
      let total = size;
      let offset = 0;
      do {
        if (cancelRef.current) throw new Cancelled();
        transferring(label, offset, total);
        const [r] = await call([{ op: 'download', path, offset, length: CHUNK_BYTES }], label);
        if (!r?.ok || typeof r.data !== 'string')
          throw new Error(r?.error || 'The file was empty.');
        const bytes = base64ToBytes(r.data);
        if (typeof r.size === 'number') total = r.size;
        parts.push(bytes);
        offset += bytes.length;
        if (bytes.length === 0) break;
      } while (offset < total);
      return joinParts(parts);
    });

  // The start of the file, for the preview.
  const fetchStart = async (path: string, name: string) => {
    const [r] = await call(
      [{ op: 'download', path, offset: 0, length: PREVIEW_BYTES }],
      `Reading ${name}`,
    );
    if (!r?.ok || typeof r.data !== 'string') throw new Error(r?.error || 'The file was empty.');
    const bytes = base64ToBytes(r.data);
    return { bytes, complete: bytes.length >= (r.size ?? 0) };
  };

  const download = async (e: Entry, bytes?: Uint8Array) => {
    setNote('');
    try {
      saveFile(e.name, bytes ?? (await fetchFile(joinPath(dir, e.name), e.name, e.size)));
    } catch (err) {
      if (err instanceof Cancelled) setNote(`Download of ${e.name} cancelled`);
      else setError(err as HelperError);
    }
  };

  const remove = async (e: Entry) => {
    const yes = await confirmModal(
      'Delete file',
      <span>
        Delete <span class={styles.mono}>{joinPath(dir, e.name)}</span> from {server.host}? The
        server keeps no copy. This cannot be undone.
      </span>,
    );
    if (!yes) return;
    if (selected?.name === e.name) setSelected(null);
    await load(
      dir,
      [{ op: 'delete', path: joinPath(dir, e.name) }],
      `Deleted ${e.name}`,
      `Deleting ${e.name}`,
    );
  };

  const rename = async (e: Entry) => {
    const from = joinPath(dir, e.name);
    // promptModal resolves when the modal closes; its onSubmit is what closes it.
    const to = (await promptModal(
      'Rename or move',
      {
        initialValue: from,
        submitLabel: 'Move',
        message: 'The new path, from the folder you sign in to. The target folder must exist.',
      },
      () => closeModal(),
    )) as string | null;
    if (!to || to === from) return;
    setSelected(null);
    // The target folder's cached listing no longer holds.
    cache.current.delete(parentOf(to));
    await load(
      dir,
      [{ op: 'rename', path: from, to }],
      `Moved ${e.name} to ${to}`,
      `Moving ${e.name}`,
    );
  };

  // One file: in one call when it fits, else part by part into `.name.part`, renamed over the
  // target by the last call.
  const uploadOne = (f: File) =>
    hold(async () => {
      const path = joinPath(dir, f.name);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const ranges = rangesOf(bytes.length);
      const label = `Uploading ${f.name}`;
      const op = (target: string, r: Range): Op => ({
        op: 'upload',
        path: target,
        offset: r.offset,
        data: bytesToBase64(bytes.subarray(r.offset, r.offset + r.length)),
      });
      if (ranges.length === 1) {
        await load(dir, [op(path, ranges[0])], `Uploaded ${f.name}`, label);
        return;
      }
      const part = partPathOf(path);
      cancelRef.current = false;
      setCancelling(false);
      try {
        for (const r of ranges.slice(0, -1)) {
          if (cancelRef.current) throw new Cancelled();
          transferring(label, r.offset, bytes.length);
          const [res] = await call([op(part, r)], label);
          if (!res?.ok) throw new Error(res?.error || 'The upload failed.');
        }
        if (cancelRef.current) throw new Cancelled();
        const last = ranges[ranges.length - 1];
        transferring(label, last.offset, bytes.length);
        await load(
          dir,
          [op(part, last), { op: 'rename', path: part, to: path, replace: true }],
          `Uploaded ${f.name}`,
          label,
        );
      } catch (err) {
        // Best effort: take the unfinished part away, then list the folder as it is.
        await load(dir, [{ op: 'delete', path: part }]);
        if (err instanceof Cancelled) setNote(`Upload of ${f.name} cancelled`);
        else setError(err as HelperError);
      }
    });

  const upload = async (files: File[]) => {
    const names = new Set((entries ?? []).map((e) => e.name));
    for (const f of files) {
      if (names.has(f.name)) {
        const yes = await confirmModal(
          'Replace file',
          <span>
            <span class={styles.mono}>{joinPath(dir, f.name)}</span> already exists on {server.host}
            . Replace it?
          </span>,
        );
        if (!yes) continue;
      }
      await uploadOne(f);
    }
  };

  const open = (e: Entry) => (e.dir ? load(joinPath(dir, e.name)) : setSelected(e));

  const q = filter.trim().toLowerCase();
  const visible = (entries ?? []).filter(
    (e) => (!q || e.name.toLowerCase().includes(q)) && (!day || (!e.dir && sameDay(dayOf(e), day))),
  );
  const hasFiles = (entries ?? []).some((e) => !e.dir);
  const today = now();
  const todayStart = dayOf({ mtime: today.getTime() / 1000 });
  const loading = busy !== null && !busy.quiet;
  const elapsed = busy ? Math.floor((Date.now() - busy.since) / 1000) : 0;

  return (
    <div class={styles.root}>
      <div class={styles.main}>
        <div class={styles.toolbar}>
          <nav class={styles.crumbs} aria-label="Path">
            <button type="button" onClick={() => load('')} title={addressOf(server)}>
              {server.host}
            </button>
            {segmentsOf(dir).map((s) => (
              <span class={styles.crumb}>
                <span class={styles.sep}>/</span>
                <button type="button" onClick={() => load(s.path)}>
                  {s.name}
                </button>
              </span>
            ))}
          </nav>
          {busy?.quiet ? (
            <span class={`${styles.note} ${styles.busy}`} role="status">
              <span class={styles.spinner} aria-hidden="true" />
              Refreshing{'…'}
            </span>
          ) : busy ? null : (
            note && (
              <span class={styles.note} role="status">
                {note}
              </span>
            )
          )}
          <FilterInput
            value={filter}
            onInput={setFilter}
            onClear={() => setFilter('')}
            placeholder="Filter by name"
            ariaLabel="Filter by name"
            className={styles.filter}
          />
          <button type="button" class={ctl.btn} onClick={() => load(dir)} disabled={loading}>
            Refresh
          </button>
          <button
            type="button"
            class={`${ctl.btn} ${ctl.btnPrimary}`}
            onClick={() => fileInput.current?.click()}
            disabled={loading || entries === null}
          >
            Upload
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              upload([...(input.files ?? [])]);
              input.value = '';
            }}
          />
        </div>

        {error && (
          <div class={`${eb.root} ${styles.banner}`}>
            <span>
              {error.hostKeyChanged
                ? `The host key of ${server.host} changed. It was ${server.hostKey}; it is now ${error.hostKey}. If the server was not rebuilt or moved, someone may be intercepting the connection.`
                : errorText(error, 'The action failed.')}
            </span>
            {error.hostKeyChanged && error.hostKey ? (
              <button
                type="button"
                class={`${ctl.btn} ${ctl.btnSm}`}
                onClick={() => trustNewKey(error.hostKey!)}
              >
                Trust the new key
              </button>
            ) : (
              <button type="button" class={`${ctl.btn} ${ctl.btnSm}`} onClick={() => load(dir)}>
                Retry
              </button>
            )}
          </div>
        )}

        {hasFiles && <Arrivals entries={entries!} now={today} day={day} onDay={setDay} />}

        <div
          class={styles.tableWrap}
          onDragOver={(e) => {
            if (entries === null) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            upload([...(e.dataTransfer?.files ?? [])]);
          }}
        >
          {dragging && (
            <div class={styles.drop}>
              Drop files to upload them to <span class={styles.mono}>{dir || server.host}</span>
            </div>
          )}
          {loading && <div class={styles.progress} aria-hidden="true" />}
          {loading && (
            <div class={styles.overlay}>
              <div class={styles.overlayCard} role="status" aria-live="polite">
                <span class={styles.bigSpinner} aria-hidden="true" />
                <div class={styles.overlayLabel}>
                  {busy!.label}
                  {'…'}
                </div>
                {busy!.total ? (
                  <Fragment>
                    <div class={styles.meter}>
                      <div
                        class={styles.meterFill}
                        style={{
                          width: `${Math.min(100, Math.round((100 * busy!.done!) / busy!.total))}%`,
                        }}
                      />
                    </div>
                    <div class={styles.overlaySub}>
                      {formatSize(busy!.done!)} of {formatSize(busy!.total)} · {elapsed} s
                    </div>
                    <button
                      type="button"
                      class={`${ctl.btn} ${ctl.btnSm}`}
                      disabled={cancelling}
                      onClick={() => {
                        cancelRef.current = true;
                        setCancelling(true);
                      }}
                    >
                      {cancelling ? 'Cancelling after this part…' : 'Cancel'}
                    </button>
                  </Fragment>
                ) : (
                  <div class={styles.overlaySub}>{elapsed} s</div>
                )}
                {starting && (
                  <div class={styles.overlayWhy}>
                    The helper is starting in this org. This can take a minute.
                  </div>
                )}
              </div>
            </div>
          )}
          <table class={styles.table + (loading ? ' ' + styles.dimmed : '')}>
            <thead>
              <tr>
                <th>Name</th>
                <th class={styles.num}>Size</th>
                <th class={styles.modified}>Modified</th>
                <th class={styles.actionsCol}>
                  <span class={styles.hiddenLabel}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {dir && (
                <tr class={styles.row} onClick={() => load(parentOf(dir))}>
                  <td colSpan={4}>
                    <span class={styles.name}>
                      <span class={styles.dirIcon}>{DIR_ICON}</span>
                      <span class={styles.mono}>..</span>
                    </span>
                  </td>
                </tr>
              )}
              {entries === null ? null : visible.length === 0 ? (
                <tr>
                  <td colSpan={4} class={styles.empty}>
                    {q || day
                      ? 'No files match. Clear the filter to see the whole folder.'
                      : 'This folder is empty. Drop a file here to upload it.'}
                  </td>
                </tr>
              ) : (
                visible.map((e) => (
                  <tr
                    key={e.name}
                    class={styles.row + (selected?.name === e.name ? ' ' + styles.selected : '')}
                    tabIndex={0}
                    onClick={() => open(e)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' && ev.target === ev.currentTarget) open(e);
                    }}
                  >
                    <td>
                      <span class={styles.name}>
                        <span class={e.dir ? styles.dirIcon : styles.fileIcon}>
                          {e.dir ? DIR_ICON : FILE_ICON}
                        </span>
                        <span class={styles.mono}>{e.name}</span>
                        {!e.dir && sameDay(dayOf(e), todayStart) && (
                          <span class={styles.tagNew}>New today</span>
                        )}
                      </span>
                    </td>
                    <td class={styles.num}>{e.dir ? '' : formatSize(e.size)}</td>
                    <td class={styles.modified}>{formatWhen(e.mtime, today)}</td>
                    <td class={styles.num}>
                      {!e.dir && (
                        <span class={styles.rowActions}>
                          <button
                            type="button"
                            class={ctl.iconBtn}
                            aria-label={`Download ${e.name}`}
                            title="Download"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              download(e);
                            }}
                          >
                            {DOWNLOAD_ICON}
                          </button>
                          <button
                            type="button"
                            class={`${ctl.iconBtn} ${styles.deleteBtn}`}
                            aria-label={`Delete ${e.name}`}
                            title="Delete"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              remove(e);
                            }}
                          >
                            {DELETE_ICON}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <Preview
          key={joinPath(dir, selected.name) + selected.mtime}
          entry={selected}
          path={joinPath(dir, selected.name)}
          now={today}
          fetchStart={(path) => fetchStart(path, selected.name)}
          fetchWhole={(path) =>
            fetchFile(path, selected.name, selected.size, `Reading ${selected.name}`)
          }
          onDownload={download}
          onRename={() => rename(selected)}
          onDelete={() => remove(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
