// The preview pane for one file, read through the helper when the file is selected. An image or
// a PDF is read whole (up to transfer.ts PREVIEW_WHOLE_BYTES) and shown from a blob URL — a PDF
// in Chrome's viewer, in a wider pane, with Open in a tab; anything else
// by its start (PREVIEW_BYTES), as a table (CSV), as text, or not at all (binary). Download
// reuses the bytes when they are the whole file, and fetches it in parts otherwise.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { errorText } from '../../net/rateLimit.js';
import { mediaOf, previewOf, type Preview as PreviewData } from '../preview.js';
import { PREVIEW_WHOLE_BYTES } from '../transfer.js';
import { formatSize, formatWhen } from '../format.js';
import type { Entry } from '../arrivals.js';
import styles from './Preview.module.css';
import ctl from '../../ui/controls.module.css';
import eb from '../../ui/ErrorBanner.module.css';

type Props = {
  entry: Entry;
  path: string;
  now: Date;
  fetchStart: (path: string) => Promise<{ bytes: Uint8Array; complete: boolean }>;
  fetchWhole: (path: string) => Promise<Uint8Array>;
  onDownload: (entry: Entry, bytes?: Uint8Array) => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
};

const CLOSE_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    aria-hidden="true"
  >
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export default function Preview({
  entry,
  path,
  now,
  fetchStart,
  fetchWhole,
  onDownload,
  onRename,
  onDelete,
  onClose,
}: Props) {
  // The whole file, when the preview read all of it.
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const media = mediaOf(entry.name);
  const mediaTooBig = !!media && entry.size > PREVIEW_WHOLE_BYTES;
  // The file as a blob URL, owned by the effect that made it; and an image's size once drawn.
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [imageBroken, setImageBroken] = useState(false);

  useEffect(() => {
    if (!bytes || !media) return;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: media.type }));
    setMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bytes]);

  useEffect(() => {
    let live = true;
    const fail = (e: unknown) => live && setError(errorText(e, 'The file could not be read.'));
    if (media && !mediaTooBig) {
      fetchWhole(path).then((b) => live && setBytes(b), fail);
      return () => {
        live = false;
      };
    }
    fetchStart(path).then(({ bytes: b, complete }) => {
      if (!live) return;
      if (complete) setBytes(b);
      setData(previewOf(entry.name, b, complete));
    }, fail);
    return () => {
      live = false;
    };
  }, [path]);

  return (
    <aside
      class={styles.pane + (media?.kind === 'pdf' && !mediaTooBig ? ' ' + styles.wide : '')}
      aria-label="File preview"
    >
      <div class={styles.head}>
        <div class={styles.titleRow}>
          <span class={styles.name} title={path}>
            {entry.name}
          </span>
          <button
            type="button"
            class={ctl.iconBtn}
            onClick={onClose}
            aria-label="Close preview"
            title="Close (Esc)"
          >
            {CLOSE_ICON}
          </button>
        </div>
        <div class={styles.meta}>
          <span>{formatSize(entry.size)}</span>
          <span>Modified {formatWhen(entry.mtime, now)}</span>
        </div>
        <div class={styles.actions}>
          <button
            type="button"
            class={`${ctl.btn} ${ctl.btnPrimary}`}
            onClick={() => onDownload(entry, bytes ?? undefined)}
          >
            Download
          </button>
          {mediaUrl && (
            <a class={ctl.btn} href={mediaUrl} target="_blank" rel="noopener">
              Open in a tab
            </a>
          )}
          <button
            type="button"
            class={ctl.btn}
            onClick={() =>
              navigator.clipboard.writeText(path).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1000);
              })
            }
          >
            {copied ? 'Copied' : 'Copy path'}
          </button>
          <button type="button" class={ctl.btn} onClick={onRename}>
            Rename or move
          </button>
          <button type="button" class={`${ctl.btn} ${styles.delete}`} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      <div class={styles.body}>
        {error ? (
          <div class={styles.pad}>
            <div class={eb.root}>{error}</div>
          </div>
        ) : media && !mediaTooBig && !imageBroken ? (
          !mediaUrl ? (
            <div class={styles.center}>
              Reading the {media.kind === 'pdf' ? 'PDF' : 'image'}
              {'…'}
            </div>
          ) : media.kind === 'pdf' ? (
            // No thumbnail sidebar and the page fitted to the width: the pane is narrower than
            // the viewer's default layout. Open in a tab shows it in full.
            <iframe
              class={styles.pdf}
              src={`${mediaUrl}#navpanes=0&view=FitH`}
              title={entry.name}
            />
          ) : (
            <div class={styles.image}>
              <img
                src={mediaUrl}
                alt={entry.name}
                onLoad={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  setImageSize({ w: img.naturalWidth, h: img.naturalHeight });
                }}
                onError={() => setImageBroken(true)}
              />
            </div>
          )
        ) : media ? (
          <div class={styles.center}>
            <strong>
              {imageBroken
                ? 'This file could not be shown as an image.'
                : `This ${media.kind === 'pdf' ? 'PDF' : 'image'} is ${formatSize(entry.size)}.`}
            </strong>
            {imageBroken
              ? 'It may be damaged, or not the type its name says. Download it to open it.'
              : `Files over ${formatSize(PREVIEW_WHOLE_BYTES)} are not previewed. Download it to open it.`}
          </div>
        ) : !data ? (
          <div class={styles.center}>Reading the file{'…'}</div>
        ) : data.kind === 'binary' ? (
          <div class={styles.center}>
            <strong>This is a binary file.</strong>
            Download it to open it.
          </div>
        ) : data.kind === 'table' ? (
          <table class={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                {(data.rows[0] ?? []).map((c) => (
                  <th>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.slice(1).map((r, i) => (
                <tr>
                  <td>{i + 1}</td>
                  {r.map((c) => (
                    <td>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre class={styles.text}>{data.text}</pre>
        )}
      </div>
      {imageSize && !imageBroken && (
        <div class={styles.foot}>
          {imageSize.w} × {imageSize.h} px
        </div>
      )}
      {data?.kind === 'table' && (
        <div class={styles.foot}>
          {data.totalRows === null
            ? `Showing the first ${data.rows.length - 1} rows, from the start of the file.`
            : data.totalRows > data.rows.length - 1
              ? `Showing the first ${data.rows.length - 1} of ${data.totalRows.toLocaleString('en-GB')} rows.`
              : `${data.totalRows.toLocaleString('en-GB')} rows.`}{' '}
          Separator: {data.separator === '\t' ? 'tab' : data.separator}
        </div>
      )}
      {data?.kind === 'text' && data.truncated && (
        <div class={styles.foot}>Showing the start of the file. Download it to see all of it.</div>
      )}
    </aside>
  );
}
