import { describe, it, expect, vi, afterEach } from 'vitest';
import { dataStorageBaseOf, dataStorageFor } from '../src/rdc/sourceStore.js';

afterEach(() => vi.unstubAllGlobals());

describe('dataStorageBaseOf, as rdc derives it (src/config/mod.rs derive_data_storage_base)', () => {
  it("matches rdc's table", () => {
    expect(dataStorageBaseOf('https://api.elis.rossum.ai/v1')).toBe(
      'https://elis.rossum.ai/svc/data-storage/api',
    );
    expect(dataStorageBaseOf('https://customer.rossum.app/api/v1')).toBe(
      'https://customer.rossum.app/svc/data-storage/api',
    );
    expect(dataStorageBaseOf('http://127.0.0.1:54321/api/v1')).toBe(
      'http://127.0.0.1:54321/svc/data-storage/api',
    );
  });

  it('takes the domains the page stores: the session origin and a typed source address', () => {
    expect(dataStorageBaseOf('https://acme.rossum.app')).toBe(
      'https://acme.rossum.app/svc/data-storage/api',
    );
    expect(dataStorageBaseOf('https://partner-sandbox.rossum.app/')).toBe(
      'https://partner-sandbox.rossum.app/svc/data-storage/api',
    );
    expect(dataStorageBaseOf('https://api.elis.rossum.ai')).toBe(
      'https://elis.rossum.ai/svc/data-storage/api',
    );
    expect(dataStorageBaseOf('https://elis.rossum.ai')).toBe(
      'https://elis.rossum.ai/svc/data-storage/api',
    );
    expect(dataStorageBaseOf('https://api.elis.rossum.ai/api/v1/')).toBe(
      'https://elis.rossum.ai/svc/data-storage/api',
    );
  });
});

describe('dataStorageFor', () => {
  it('calls Data Storage on the parent domain of an api. host', async () => {
    const fetch = vi.fn(
      async (_u: string, _i: any) => new Response('{"result":[]}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch);
    await dataStorageFor('https://api.elis.rossum.ai', 'tok')('find', { query: {} });
    expect(fetch.mock.calls[0][0]).toBe('https://elis.rossum.ai/svc/data-storage/api/v1/data/find');
    await dataStorageFor('https://acme.rossum.app', 'tok')('find', { query: {} });
    expect(fetch.mock.calls[1][0]).toBe(
      'https://acme.rossum.app/svc/data-storage/api/v1/data/find',
    );
  });
});
