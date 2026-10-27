import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SOURCE_COLLECTION,
  dataStorageFor,
  loadSource,
  saveSource,
  sourceFromDoc,
} from '../src/rdc/sourceStore.js';
import { isRateLimited } from '../src/net/rateLimit.js';

const source = {
  name: 'test',
  domain: 'https://partner-sandbox.rossum.app',
  orgId: 20412,
  orgName: 'Acme Test',
};

afterEach(() => vi.unstubAllGlobals());

describe('rdc source store', () => {
  it('keeps the collection hidden in Dataset Management', () => {
    expect(SOURCE_COLLECTION).toBe('_SA_EXTENSION__rdc_deployments');
  });

  it('reads a stored document as a source, and ignores anything else', () => {
    expect(sourceFromDoc({ kind: 'source', ...source, savedAt: 'x' })).toEqual(source);
    expect(sourceFromDoc({ ...source, orgName: undefined })).toEqual({
      ...source,
      orgName: 'org 20412',
    });
    expect(sourceFromDoc({ ...source, orgId: '20412' })).toBeNull();
    expect(sourceFromDoc({ ...source, domain: '' })).toBeNull();
    expect(sourceFromDoc(null)).toBeNull();
  });

  it('loads the one source document, or nothing', async () => {
    const ds = vi.fn(async (_op: string, _b: Record<string, unknown>) => [
      { kind: 'source', ...source },
    ]);
    expect(await loadSource(ds)).toEqual(source);
    expect(ds).toHaveBeenCalledWith('find', { query: { kind: 'source' }, limit: 1 });
    expect(await loadSource(async () => [])).toBeNull();
  });

  it('upserts the source without anything else', async () => {
    const ds = vi.fn(async (_op: string, _b: Record<string, unknown>) => ({}));
    await saveSource(ds, source);
    const [op, body] = ds.mock.calls[0];
    expect(op).toBe('replace_one');
    expect(body).toMatchObject({ filter: { kind: 'source' }, options: { upsert: true } });
    expect(Object.keys((body as any).replacement).sort()).toEqual([
      'domain',
      'kind',
      'name',
      'orgId',
      'orgName',
      'savedAt',
    ]);
  });

  it('calls the org Data Storage with the session token, and maps errors', async () => {
    const fetch = vi.fn(
      async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ result: [1] })),
    );
    vi.stubGlobal('fetch', fetch);
    const ds = dataStorageFor('https://acme.rossum.app', 'ttok');
    expect(await ds('find', { query: {} })).toEqual([1]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://acme.rossum.app/svc/data-storage/api/v1/data/find');
    expect((init.headers as any).Authorization).toBe('Bearer ttok');
    expect(JSON.parse(init.body as string)).toEqual({
      query: {},
      collectionName: SOURCE_COLLECTION,
    });

    vi.stubGlobal(
      'fetch',
      async () => new Response('', { status: 429, headers: { 'retry-after': '5' } }),
    );
    const limited = await ds('find', {}).catch((e) => e);
    expect(isRateLimited(limited)).toBe(true);
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    await expect(ds('find', {})).rejects.toThrow('HTTP 500');
  });
});
