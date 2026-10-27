// The source the admin chose, remembered in the connected org's own Data Storage, so the next
// visit does not ask again. One document, `kind: 'source'`, in a hidden collection; never the
// token. Data Storage documents are raw JSON, hence the `unknown`s at the boundary.
import { HIDDEN_PREFIX } from '../mdh/hiddenCollections.js';
import { rateLimitError } from '../net/rateLimit.js';
import type { Source } from './deploy.js';

export const SOURCE_COLLECTION = `${HIDDEN_PREFIX}rdc_deployments`; // the prefix hides it in Dataset Management

export type DataStorage = (op: string, body: Record<string, unknown>) => Promise<unknown>;

// `POST {domain}/svc/data-storage/api/v1/data/<op>` on the connected org, answering `result`.
export function dataStorageFor(domain: string, token: string): DataStorage {
  return async (op, body) => {
    const res = await fetch(`${domain}/svc/data-storage/api/v1/data/${op}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, collectionName: SOURCE_COLLECTION }),
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
