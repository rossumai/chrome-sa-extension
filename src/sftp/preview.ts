// src/sftp/preview.ts
// What the preview pane shows for a downloaded file: a CSV as a table, other text as text, and
// a refusal for anything binary. Pure; works on the bytes the helper returned.

// `totalRows` is null when only the start of the file was read.
export type Preview =
  | { kind: 'table'; rows: string[][]; totalRows: number | null; separator: string }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'binary' };

// Files the pane shows whole, by extension: images, drawn by an <img> (which runs none of an
// SVG's scripts), and PDFs, in Chrome's own viewer in an <iframe> (as the DevTools panel's
// preview does).
const MEDIA: Record<string, Media> = {
  png: { kind: 'image', type: 'image/png' },
  jpg: { kind: 'image', type: 'image/jpeg' },
  jpeg: { kind: 'image', type: 'image/jpeg' },
  gif: { kind: 'image', type: 'image/gif' },
  webp: { kind: 'image', type: 'image/webp' },
  bmp: { kind: 'image', type: 'image/bmp' },
  ico: { kind: 'image', type: 'image/x-icon' },
  avif: { kind: 'image', type: 'image/avif' },
  svg: { kind: 'image', type: 'image/svg+xml' },
  pdf: { kind: 'pdf', type: 'application/pdf' },
};

export type Media = { kind: 'image' | 'pdf'; type: string };

/** How the pane shows the file whole, or null when it previews only the file's start. */
export function mediaOf(name: string): Media | null {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  return (ext && MEDIA[ext]) || null;
}

const MAX_ROWS = 200;
const MAX_CHARS = 200_000;

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

// The separator a CSV-like file uses: the one of , ; tab | that appears most on its first line.
function separatorOf(firstLine: string): string {
  let best = ',';
  let bestCount = 0;
  for (const sep of [',', ';', '\t', '|']) {
    const count = firstLine.split(sep).length - 1;
    if (count > bestCount) {
      best = sep;
      bestCount = count;
    }
  }
  return best;
}

// RFC 4180 rows: quoted fields may hold the separator, newlines and doubled quotes.
export function parseCsv(
  text: string,
  sep: string,
  maxRows = Infinity,
): { rows: string[][]; total: number } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let total = 0;
  const push = () => {
    row.push(field);
    field = '';
  };
  const end = () => {
    push();
    if (!(row.length === 1 && row[0] === '')) {
      total++;
      if (rows.length < maxRows) rows.push(row);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) push();
    else if (c === '\n') end();
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) end();
  return { rows, total };
}

/** `complete` is false when `bytes` is only the start of the file. */
export function previewOf(name: string, bytes: Uint8Array, complete = true): Preview {
  if (isBinary(bytes)) return { kind: 'binary' };
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // A cut file ends mid-line, perhaps mid-character: keep only its whole lines.
  if (!complete) text = text.slice(0, text.lastIndexOf('\n') + 1);
  if (/\.(csv|tsv)$/i.test(name)) {
    const sep = /\.tsv$/i.test(name) ? '\t' : separatorOf(text.slice(0, text.indexOf('\n') >>> 0));
    const { rows, total } = parseCsv(text, sep, MAX_ROWS + 1);
    const totalRows = complete ? Math.max(0, total - 1) : null;
    return { kind: 'table', rows, totalRows, separator: sep };
  }
  return text.length > MAX_CHARS || !complete
    ? { kind: 'text', text: text.slice(0, MAX_CHARS), truncated: true }
    : { kind: 'text', text, truncated: false };
}
