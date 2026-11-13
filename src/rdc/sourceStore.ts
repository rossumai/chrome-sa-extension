// The source the admin chose, remembered in the connected org's own Data Storage, so the next
// visit does not ask again. One document, `kind: 'source'`, in a hidden collection; never the
// token. Data Storage documents are raw JSON, hence the `unknown`s at the boundary.
import { HIDDEN_PREFIX } from '../mdh/hiddenCollections.js';
import { rateLimitError } from '../net/rateLimit.js';
import type { Source } from './deploy.js';

export const SOURCE_COLLECTION = `${HIDDEN_PREFIX}rdc_deployments`; // the prefix hides it in Dataset Management

export type DataStorage = (op: string, body: Record<string, unknown>) => Promise<unknown>;

// The Data Storage base of an org, from its domain or API base, exactly as rdc derives it
// (rdc `src/config/mod.rs`, `derive_data_storage_base`): drop a trailing `/`, an `api.` host
// prefix and an `/api/v1` or `/v1` path suffix, then add `/svc/data-storage/api`. So
// `https://api.elis.rossum.ai` → `https://elis.rossum.ai/svc/data-storage/api`, while an
// `<org>.rossum.app` origin keeps its host.
export function dataStorageBaseOf(domainOrApiBase: string): string {
  const trimmed = domainOrApiBase.replace(/\/+$/, '');
  const sep = trimmed.indexOf('://');
  const scheme = sep >= 0 ? trimmed.slice(0, sep) : 'https';
  const rest = sep >= 0 ? trimmed.slice(sep + 3) : trimmed;
  const slash = rest.indexOf('/');
  const host = (slash >= 0 ? rest.slice(0, slash) : rest).replace(/^api\./, '');
  let path = slash >= 0 ? rest.slice(slash) : '';
  if (path.endsWith('/api/v1')) path = path.slice(0, -'/api/v1'.length);
  if (path.endsWith('/v1')) path = path.slice(0, -'/v1'.length);
  path = path.replace(/\/+$/, '');
  return `${scheme}://${host}${path}/svc/data-storage/api`;
}

// `POST <data storage base>/v1/data/<op>` on the org at `domain`, answering `result`, in
// `collection` (the page's own by default).
export function dataStorageFor(
  domain: string,
  token: string,
  collection: string = SOURCE_COLLECTION,
): DataStorage {
  const base = dataStorageBaseOf(domain);
  return async (op, body) => {
    const res = await fetch(`${base}/v1/data/${op}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, collectionName: collection }),
    });
    if (res.status === 429) throw rateLimitError(res, 'HTTP 429');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json())?.result;
  };
}

// A stored document as a Source, or null when it is not one (older or foreign shapes are ignored).
export function sourceFromDoc(doc: unknown): Source | null {
  const d = doc as any;
  if (!d || typeof d !== 'object') return null;
  const { name, domain, orgId, orgName } = d;
  if (typeof name !== 'string' || !name || typeof domain !== 'string' || !domain) return null;
  if (typeof orgId !== 'number' || !Number.isInteger(orgId)) return null;
  return { name, domain, orgId, orgName: typeof orgName === 'string' ? orgName : `org ${orgId}` };
}

export async function loadSource(ds: DataStorage): Promise<Source | null> {
  const found = await ds('find', { query: { kind: 'source' }, limit: 1 });
  return Array.isArray(found) ? sourceFromDoc(found[0]) : null;
}

export async function saveSource(ds: DataStorage, source: Source): Promise<void> {
  await ds('replace_one', {
    filter: { kind: 'source' },
    replacement: { kind: 'source', ...source, savedAt: new Date().toISOString() },
    options: { upsert: true },
  });
}

// The target's objects changed directly in the org since the last deployment: object paths
// (`envs/target/...`) only, never content. Each read adds what it saw; a Write removes what it
// wrote. Kept because every read moves rdc's base, after which rdc itself no longer sees them.
export async function loadDirectEdits(ds: DataStorage): Promise<string[]> {
  const found = await ds('find', { query: { kind: 'directEdits' }, limit: 1 });
  const paths = Array.isArray(found) ? (found[0] as any)?.paths : null;
  return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [];
}

export async function saveDirectEdits(ds: DataStorage, paths: string[]): Promise<void> {
  await ds('replace_one', {
    filter: { kind: 'directEdits' },
    replacement: {
      kind: 'directEdits',
      paths: [...new Set(paths)].sort(),
      savedAt: new Date().toISOString(),
    },
    options: { upsert: true },
  });
}

// rdc's `.rdc/mapping.toml` (slug renames between source and target) is the host's to keep:
// rdc stores each env's state in that env's own org, and the mapping belongs to the pair. One
// document per source org, so reading another source (whose sync scaffolds an empty mapping)
// never overwrites this one's rows.
const mappingOf = (source: Source) => ({
  kind: 'mapping',
  domain: source.domain,
  orgId: source.orgId,
});

export async function loadMapping(ds: DataStorage, source: Source): Promise<string | null> {
  const found = await ds('find', { query: mappingOf(source), limit: 1 });
  const d = Array.isArray(found) ? (found[0] as any) : null;
  if (!d || d.domain !== source.domain || d.orgId !== source.orgId) return null;
  return typeof d.text === 'string' ? d.text : null;
}

export async function saveMapping(ds: DataStorage, source: Source, text: string): Promise<void> {
  await ds('replace_one', {
    filter: mappingOf(source),
    replacement: {
      ...mappingOf(source),
      text,
      savedAt: new Date().toISOString(),
    },
    options: { upsert: true },
  });
}

// Adds what a read saw to the remembered direct edits and answers the whole list. The
// load-merge-save runs under the Web Lock `lockName`, so two tabs of this browser reading the
// same target cannot drop each other's additions. Between browsers there is no compare-and-swap:
// the same accepted edge as two machines running rdc on one org.
export async function addDirectEdits(
  ds: DataStorage,
  lockName: string,
  seen: string[],
): Promise<string[]> {
  const merge = async () => {
    const stored = await loadDirectEdits(ds);
    const all = [...new Set([...stored, ...seen])].sort();
    if (all.length !== stored.length) await saveDirectEdits(ds, all);
    return all;
  };
  const locks = (globalThis.navigator as any)?.locks;
  // rdc itself refuses to run without Web Locks, so then no read reaches this point
  return locks ? locks.request(lockName, merge) : merge();
}
