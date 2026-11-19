import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { track } from '../usage/track.js';
import { formatBytes } from './contentMeta.js';
import styles from './PreviewPane.module.css';

// A DevTools tab switch unmounts and remounts this component, so a plain mount
// effect counted the same preview again on every switch back (and missed a new
// preview rendered into an already-mounted pane). Keyed per panel session.
const seenPreviews = new Set();

export default function PreviewPane({ preview }: { preview: any }) {
  const key = preview && (preview.apiPath || preview.url || preview.name || preview.type || '');
  useEffect(() => {
    if (!key || seenPreviews.has(key)) return;
    seenPreviews.add(key);
    track('sa_devtools_preview');
  }, [key]);
  const [url, setUrl] = useState<string | null>(null);
  const blob = preview && preview.blob;
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  if (!preview) return null;
  const ct = preview.contentType || '';
  const isImage = /^image\//i.test(ct);
  const isPdf = /\bpdf\b/i.test(ct);

  return (
    <div class={styles.preview}>
      {url ? (
        <div class={styles.actions}>
          <a class={styles.btn} href={url} download={preview.filename}>
            Download
          </a>
          <a class={styles.btn} href={url} target="_blank" rel="noopener">
            Open in browser tab
          </a>
        </div>
      ) : null}
      {url && isImage ? <img class={styles.img} src={url} alt={preview.filename} /> : null}
      {url && isPdf ? <iframe class={styles.pdf} src={url} title={preview.filename} /> : null}
      {!isImage && !isPdf ? (
        <div class={styles.card}>
          <div class={styles.name}>{preview.filename}</div>
          <div class={styles.meta}>
            {ct || 'unknown type'} · {formatBytes(preview.size)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
