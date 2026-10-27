// A real CIB release for the deploy tests, read from GitHub with the same loadRelease() the console
// page uses. The repo holds no CIB content, so the first run needs network; the result is cached in
// node_modules/.cache (not in git) and later runs are offline.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadRelease } from '../../src/cib/release.js';

export async function realRelease(tag: string) {
  const dir = new URL('../../node_modules/.cache/cib-release/', import.meta.url);
  const file = new URL(`${tag}.json`, dir);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    const r = await loadRelease(tag, { fetchImpl: globalThis.fetch });
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(r));
    return r;
  }
}
