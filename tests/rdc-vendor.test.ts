import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { ensureRdcWasm, readPin, releaseUrl, untarGz } from '../scripts/rdc-vendor.cjs';

// A minimal ustar archive: one 512-byte header per file, then its data padded to 512.
function tar(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0' + '00', 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

const ARCHIVE = {
  './rdc_wasm.js': 'glue',
  './rdc_wasm_bg.wasm': 'module',
  './rdc_wasm.d.ts': 'types',
  './rdc_wasm_bg.wasm.d.ts': 'more types',
};
const gz = gzipSync(tar(ARCHIVE));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let root: string;
const pin = (sha256: string) =>
  writeFileSync(
    join(root, 'rdc-wasm.json'),
    JSON.stringify({ tag: 'v9.9.9', asset: 'rdc-9.9.9-wasm32-unknown-unknown.tar.gz', sha256 }),
  );
const ok = (body: Buffer) =>
  vi.fn(async (_url: any, _init?: any) => new Response(new Uint8Array(body)));
const quiet = () => {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rdc-vendor-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the committed pin', () => {
  it('names a tag, its wasm asset and a sha256, at the public release URL', () => {
    const p = readPin(process.cwd());
    expect(p.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(p.asset).toBe(`rdc-${p.tag.slice(1)}-wasm32-unknown-unknown.tar.gz`);
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(releaseUrl(p)).toBe(
      `https://github.com/mrtnzlml/rdc/releases/download/${p.tag}/${p.asset}`,
    );
  });
});

describe('untarGz', () => {
  it('reads the regular files and drops the leading ./', () => {
    const files = untarGz(gz);
    expect([...files.keys()].sort()).toEqual(
      ['rdc_wasm.d.ts', 'rdc_wasm.js', 'rdc_wasm_bg.wasm', 'rdc_wasm_bg.wasm.d.ts'].sort(),
    );
    expect(files.get('rdc_wasm_bg.wasm')!.toString()).toBe('module');
  });
});

describe('ensureRdcWasm', () => {
  it('downloads, checks the hash, unpacks and records the marker', async () => {
    pin(sha(gz));
    const fetchImpl = ok(gz);
    expect(await ensureRdcWasm({ root, env: {}, fetchImpl, log: quiet })).toBe('downloaded');
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://github.com/mrtnzlml/rdc/releases/download/v9.9.9/rdc-9.9.9-wasm32-unknown-unknown.tar.gz',
    );
    expect(readFileSync(join(root, 'vendor/rdc/rdc_wasm.js'), 'utf8')).toBe('glue');
    expect(JSON.parse(readFileSync(join(root, 'vendor/rdc/.source.json'), 'utf8'))).toEqual({
      tag: 'v9.9.9',
      sha256: sha(gz),
    });
  });

  it('does not download again while the marker matches the pin', async () => {
    pin(sha(gz));
    await ensureRdcWasm({ root, env: {}, fetchImpl: ok(gz), log: quiet });
    const again = ok(gz);
    expect(await ensureRdcWasm({ root, env: {}, fetchImpl: again, log: quiet })).toBe('cached');
    expect(again).not.toHaveBeenCalled();
  });

  it('downloads again when the pin moves', async () => {
    pin(sha(gz));
    await ensureRdcWasm({ root, env: {}, fetchImpl: ok(gz), log: quiet });
    const other = gzipSync(tar({ ...ARCHIVE, './rdc_wasm.js': 'newer glue' }));
    pin(sha(other));
    expect(await ensureRdcWasm({ root, env: {}, fetchImpl: ok(other), log: quiet })).toBe(
      'downloaded',
    );
    expect(readFileSync(join(root, 'vendor/rdc/rdc_wasm.js'), 'utf8')).toBe('newer glue');
  });

  it('fails on a sha256 mismatch and unpacks nothing', async () => {
    pin('0'.repeat(64));
    await expect(ensureRdcWasm({ root, env: {}, fetchImpl: ok(gz), log: quiet })).rejects.toThrow(
      /sha256 mismatch/,
    );
    expect(existsSync(join(root, 'vendor'))).toBe(false);
  });

  it('fails on an HTTP error or a network error', async () => {
    pin(sha(gz));
    const notFound = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(ensureRdcWasm({ root, env: {}, fetchImpl: notFound, log: quiet })).rejects.toThrow(
      /HTTP 404/,
    );
    const offline = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    await expect(ensureRdcWasm({ root, env: {}, fetchImpl: offline, log: quiet })).rejects.toThrow(
      /download failed/,
    );
  });

  it('fails when the archive lacks a file', async () => {
    const partial = gzipSync(tar({ './rdc_wasm.js': 'glue' }));
    pin(sha(partial));
    await expect(
      ensureRdcWasm({ root, env: {}, fetchImpl: ok(partial), log: quiet }),
    ).rejects.toThrow(/lacks/);
  });

  it('uses a local build only with RDC_WASM_LOCAL=1, and replaces it otherwise', async () => {
    pin(sha(gz));
    const dir = join(root, 'vendor/rdc');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'rdc_wasm.js'), 'local glue');
    writeFileSync(join(dir, 'rdc_wasm_bg.wasm'), 'local module');
    writeFileSync(join(dir, '.source.json'), JSON.stringify({ local: '/somewhere/rdc' }));
    const never = ok(gz);
    const env = { RDC_WASM_LOCAL: '1' };
    expect(await ensureRdcWasm({ root, env, fetchImpl: never, log: quiet })).toBe('local');
    expect(never).not.toHaveBeenCalled();
    expect(await ensureRdcWasm({ root, env: {}, fetchImpl: ok(gz), log: quiet })).toBe(
      'downloaded',
    );
    expect(readFileSync(join(dir, 'rdc_wasm.js'), 'utf8')).toBe('glue');
  });

  it('RDC_WASM_LOCAL=1 without a local build fails', async () => {
    pin(sha(gz));
    await expect(
      ensureRdcWasm({ root, env: { RDC_WASM_LOCAL: '1' }, fetchImpl: ok(gz), log: quiet }),
    ).rejects.toThrow(/no local build/);
  });
});
