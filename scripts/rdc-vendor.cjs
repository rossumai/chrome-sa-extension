// The experimental rdc Console app's wasm, fetched by build.js. Kept out of build.js so the
// tests can drive it.
//
// The pin is rdc-wasm.json: a release tag, its wasm asset and the asset's sha256. Every build
// makes sure the git-ignored vendor/rdc/ holds exactly that release:
//   - vendor/rdc/.source.json names the tag and sha256 it was unpacked from; when it matches
//     the pin and the files are there, nothing is downloaded (`npm run dev`, repeated builds);
//   - otherwise the asset is downloaded from the public release URL (no token, no API call),
//     its sha256 is checked BEFORE anything is unpacked, and vendor/rdc/ is replaced.
// Any failure — network, HTTP status, hash, a missing file in the archive — throws, and the
// build fails. There is no fallback to "no wasm".
//
// Developer override: scripts/build-rdc-wasm.sh writes a LOCAL build into vendor/rdc/ with a
// `{ "local": … }` marker. Only a build run with RDC_WASM_LOCAL=1 uses it; any other build
// sees a marker that does not match the pin and replaces it with the release.
const { createHash } = require('crypto');
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const { gunzipSync } = require('zlib');

const RDC_VENDOR_DIR = 'vendor/rdc';
const MARKER = '.source.json';
// What the app needs, and what build.js copies into dist/console/rdc/.
const RDC_SHIPPED_FILES = ['rdc_wasm.js', 'rdc_wasm_bg.wasm'];
// Unpacked from the archive; the .d.ts files are for people, not for the browser.
const RDC_ARCHIVE_FILES = [...RDC_SHIPPED_FILES, 'rdc_wasm.d.ts', 'rdc_wasm_bg.wasm.d.ts'];

function readPin(root = '.') {
  const pin = JSON.parse(readFileSync(join(root, 'rdc-wasm.json'), 'utf8'));
  for (const k of ['tag', 'asset', 'sha256'])
    if (typeof pin[k] !== 'string' || !pin[k]) throw new Error(`rdc-wasm.json: missing "${k}"`);
  return pin;
}

function releaseUrl(pin) {
  return `https://github.com/mrtnzlml/rdc/releases/download/${pin.tag}/${pin.asset}`;
}

// The regular files of a .tar.gz, by name with any leading `./` removed. Node has gzip but no
// tar, and a ustar header is 512 bytes with an octal size, so this reads it directly rather
// than depending on the `tar` CLI (bsdtar on macOS, GNU tar on Linux).
function untarGz(gz) {
  const tar = gunzipSync(gz);
  const files = new Map();
  for (let off = 0; off + 512 <= tar.length; ) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // end of archive
    const field = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const name = (field(345, 155) ? `${field(345, 155)}/` : '') + field(0, 100);
    const body = off + 512;
    if (type === '0') files.set(name.replace(/^\.\//, ''), tar.subarray(body, body + size));
    off = body + Math.ceil(size / 512) * 512;
  }
  return files;
}

function readMarker(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, MARKER), 'utf8'));
  } catch {
    return null;
  }
}

const hasAll = (dir, names) => names.every((f) => existsSync(join(dir, f)));

// Makes vendor/rdc/ hold the pinned release (or, with RDC_WASM_LOCAL=1, the local build).
// Returns what it did: 'cached', 'downloaded' or 'local'.
async function ensureRdcWasm({
  root = '.',
  env = process.env,
  fetchImpl = fetch,
  log = (msg) => console.log(msg),
} = {}) {
  const dir = join(root, RDC_VENDOR_DIR);
  const marker = readMarker(dir);
  if (env.RDC_WASM_LOCAL === '1') {
    if (!marker?.local || !hasAll(dir, RDC_SHIPPED_FILES))
      throw new Error('RDC_WASM_LOCAL=1 but vendor/rdc/ holds no local build — run scripts/build-rdc-wasm.sh first');
    log(`rdc wasm: using the LOCAL build of ${marker.local}, not the pinned release`);
    return 'local';
  }
  const pin = readPin(root);
  if (marker?.tag === pin.tag && marker?.sha256 === pin.sha256 && hasAll(dir, RDC_ARCHIVE_FILES)) return 'cached';

  const url = releaseUrl(pin);
  log(`rdc wasm: downloading ${url}`);
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new Error(`rdc wasm: download failed: ${url}: ${e.message}`);
  }
  if (!res.ok) throw new Error(`rdc wasm: download failed: ${url}: HTTP ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(gz).digest('hex');
  if (sha !== pin.sha256)
    throw new Error(`rdc wasm: sha256 mismatch for ${pin.asset}: expected ${pin.sha256}, got ${sha}`);
  const files = untarGz(gz);
  const missing = RDC_ARCHIVE_FILES.filter((f) => !files.has(f));
  if (missing.length) throw new Error(`rdc wasm: ${pin.asset} lacks ${missing.join(', ')}`);

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of RDC_ARCHIVE_FILES) writeFileSync(join(dir, f), files.get(f));
  writeFileSync(join(dir, MARKER), JSON.stringify({ tag: pin.tag, sha256: pin.sha256 }, null, 2) + '\n');
  return 'downloaded';
}

module.exports = { RDC_VENDOR_DIR, RDC_SHIPPED_FILES, readPin, releaseUrl, untarGz, ensureRdcWasm };
