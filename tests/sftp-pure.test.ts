import { describe, it, expect } from 'vitest';
import { arrivalDays, gapDays, DAYS, type Entry } from '../src/sftp/arrivals.js';
import { base64ToBytes, bytesToBase64, mediaOf, parseCsv, previewOf } from '../src/sftp/preview.js';
import { formatSize, formatWhen, joinPath, parentOf, segmentsOf } from '../src/sftp/format.js';
import { joinParts, partPathOf, rangesOf } from '../src/sftp/transfer.js';

// Thursday 2026-11-19, 15:00 local time.
const NOW = new Date(2026, 10, 19, 15, 0);
const at = (daysAgo: number, hour = 9): number =>
  new Date(2026, 10, 19 - daysAgo, hour, 30).getTime() / 1000;
const file = (name: string, daysAgo: number, size = 100): Entry => ({
  name,
  size,
  mtime: at(daysAgo),
  dir: false,
});

describe('arrivals', () => {
  it('buckets files into the last 14 local days, oldest first', () => {
    const days = arrivalDays(
      [file('a', 0), file('b', 0), file('c', 3), file('old', 20), { ...file('d', 0), dir: true }],
      NOW,
    );
    expect(days).toHaveLength(DAYS);
    expect(days[DAYS - 1].files.map((f) => f.name)).toEqual(['a', 'b']);
    expect(days[DAYS - 4].files.map((f) => f.name)).toEqual(['c']);
    expect(days.reduce((n, d) => n + d.files.length, 0)).toBe(3);
  });

  it('marks weekends', () => {
    const days = arrivalDays([], NOW);
    // 2026-11-15 is a Sunday, 2026-11-14 a Saturday.
    expect(days.filter((d) => d.weekend).map((d) => d.start.getDate())).toEqual([7, 8, 14, 15]);
  });

  it('reports weekday gaps only after the first arrival', () => {
    // Files on Mon 16, Wed 18, Thu 19; nothing on Tue 17. Nothing before Mon 16 at all.
    const days = arrivalDays([file('a', 3), file('b', 1), file('c', 0)], NOW);
    expect(gapDays(days).map((d) => d.start.getDate())).toEqual([17]);
    expect(gapDays(arrivalDays([], NOW))).toEqual([]);
  });
});

describe('preview', () => {
  const enc = (t: string) => new TextEncoder().encode(t);

  it('parses quoted CSV fields', () => {
    const { rows, total } = parseCsv('a,b\n"x, y","say ""hi"""\r\n"multi\nline",2\n', ',');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', '2'],
    ]);
    expect(total).toBe(3);
  });

  it('shows a CSV as a table and counts its rows beyond the cap', () => {
    const body = ['id;name', ...Array.from({ length: 250 }, (_, i) => `${i};n${i}`)].join('\n');
    const p = previewOf('vendors.csv', enc(body));
    expect(p.kind).toBe('table');
    if (p.kind !== 'table') return;
    expect(p.separator).toBe(';');
    expect(p.rows[0]).toEqual(['id', 'name']);
    expect(p.rows).toHaveLength(201);
    expect(p.totalRows).toBe(250);
  });

  it('shows other text as text, without a byte-order mark', () => {
    expect(previewOf('a.xml', enc('\ufeff<a/>'))).toEqual({
      kind: 'text',
      text: '<a/>',
      truncated: false,
    });
  });

  it('refuses binary files', () => {
    expect(previewOf('a.pdf', new Uint8Array([37, 80, 68, 70, 0, 1]))).toEqual({ kind: 'binary' });
  });

  it('round-trips base64, also past one chunk', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe('format', () => {
  it('joins and splits paths relative to the sign-in folder', () => {
    expect(joinPath('', 'upload')).toBe('upload');
    expect(joinPath('upload/in', 'a.csv')).toBe('upload/in/a.csv');
    expect(parentOf('upload/in')).toBe('upload');
    expect(parentOf('upload')).toBe('');
    expect(segmentsOf('upload/in')).toEqual([
      { name: 'upload', path: 'upload' },
      { name: 'in', path: 'upload/in' },
    ]);
    expect(segmentsOf('')).toEqual([]);
  });

  it('formats sizes and times', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(182344)).toBe('178.1 KB');
    expect(formatSize(8 * 1024 * 1024)).toBe('8.0 MB');
    expect(formatWhen(at(0, 9), NOW)).toBe('Today 09:30');
    expect(formatWhen(at(1, 9), NOW)).toBe('Yesterday 09:30');
    expect(formatWhen(at(2, 9), NOW)).toBe('17 Nov 09:30');
    expect(formatWhen(new Date(2025, 0, 5).getTime() / 1000, NOW)).toBe('5 Jan 2025');
  });
});

describe('transfers in parts', () => {
  it('cuts a file into ordered parts, the last one short', () => {
    expect(rangesOf(7, 3)).toEqual([
      { offset: 0, length: 3 },
      { offset: 3, length: 3 },
      { offset: 6, length: 1 },
    ]);
    expect(rangesOf(6, 3)).toHaveLength(2);
    expect(rangesOf(0, 3)).toEqual([{ offset: 0, length: 0 }]);
  });

  it('writes a multi-part upload to a hidden part file beside the target', () => {
    expect(partPathOf('upload/a.csv')).toBe('upload/.a.csv.part');
    expect(partPathOf('a.csv')).toBe('.a.csv.part');
  });

  it('joins parts in order', () => {
    expect(joinParts([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])])).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('previews the start of a file by whole lines only, without a row count', () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const p = previewOf('a.csv', enc('id,name\n1,a\n2,b\n3,c'), false);
    expect(p).toMatchObject({ kind: 'table', totalRows: null });
    if (p.kind === 'table')
      expect(p.rows).toEqual([
        ['id', 'name'],
        ['1', 'a'],
        ['2', 'b'],
      ]);
    expect(previewOf('a.txt', enc('one\ntwo\nthr'), false)).toEqual({
      kind: 'text',
      text: 'one\ntwo\n',
      truncated: true,
    });
  });
});

describe('files the pane shows whole', () => {
  it('knows images and PDFs by extension', () => {
    expect(mediaOf('scan.PNG')).toEqual({ kind: 'image', type: 'image/png' });
    expect(mediaOf('a.jpeg')).toEqual({ kind: 'image', type: 'image/jpeg' });
    expect(mediaOf('logo.svg')).toEqual({ kind: 'image', type: 'image/svg+xml' });
    expect(mediaOf('INV-001.PDF')).toEqual({ kind: 'pdf', type: 'application/pdf' });
    expect(mediaOf('a.csv')).toBe(null);
    expect(mediaOf('png')).toBe(null);
  });
});
