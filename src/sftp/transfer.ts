// src/sftp/transfer.ts
// Files of any size, in parts. One helper call answers at most ~6 MB (Lambda's cap) and base64
// adds a third, so contents move in parts of CHUNK_BYTES, one call each (helperCode.ts). An
// upload of more than one part is written to a hidden `.<name>.part` beside the target and
// renamed over it by its last call, so an interrupted upload never leaves a half-written file
// under the real name. Pure: the Console's Browser does the calls.

export const CHUNK_BYTES = 3 * 1024 * 1024;

/** How much of a file the preview reads: enough for a table's first rows or a page of text. */
export const PREVIEW_BYTES = 512 * 1024;

/** The largest image or PDF the preview reads whole (at most four calls). */
export const PREVIEW_WHOLE_BYTES = 10 * 1024 * 1024;

export type Range = { offset: number; length: number };

/** The parts of a `size`-byte file, in order. An empty file is one empty part. */
export function rangesOf(size: number, chunk = CHUNK_BYTES): Range[] {
  if (size <= 0) return [{ offset: 0, length: 0 }];
  const out: Range[] = [];
  for (let offset = 0; offset < size; offset += chunk)
    out.push({ offset, length: Math.min(chunk, size - offset) });
  return out;
}

/** Where a multi-part upload is written until its last part: `dir/.name.part`. */
export function partPathOf(path: string): string {
  const i = path.lastIndexOf('/');
  return `${path.slice(0, i + 1)}.${path.slice(i + 1)}.part`;
}

export function joinParts(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Thrown when the user cancels a transfer between two parts. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled.');
  }
}
