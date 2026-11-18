import { describe, it, expect, vi } from 'vitest';
import { TRACK } from '../src/training/track.js';
import {
  loadContext,
  runChecks,
  needsOf,
  pathOf,
  hasVendorMatch,
  type Get,
} from '../src/training/load.js';
import { rateLimitError } from '../src/net/rateLimit.js';
import { progressThrough } from './support/training.js';

const QUEUE = {
  id: 31927,
  name: 'AF · AP Invoices · barge-17',
  url: 'https://x.rossum.app/api/v1/queues/31927',
  schema: 'https://x.rossum.app/api/v1/schemas/5',
};

/** A fake org: path (or "METHOD path") → response. */
function org(routes: Record<string, any>): Get & { calls: string[] } {
  const calls: string[] = [];
  const get = vi.fn(async (path: string, opts?: { method?: string }) => {
    const key = opts?.method && opts.method !== 'GET' ? `${opts.method} ${path}` : path;
    calls.push(key);
    if (!(key in routes)) throw new Error(`API 404 ${key}`);
    return routes[key];
  }) as any;
  get.calls = calls;
  return get;
}

const queueRoute = {
  [`/api/v1/queues?name=${encodeURIComponent('AF · AP Invoices · barge-17')}`]: {
    results: [QUEUE],
  },
};

describe('loadContext', () => {
  it('fetches only what the needs ask for, and finds the queue by its exact name', async () => {
    const get = org(queueRoute);
    const ctx = await loadContext(new Set(['queue']), 'barge-17', get);
    expect(ctx.queue).toEqual({ id: 31927, schemaPath: '/api/v1/schemas/5' });
    expect(get.calls).toHaveLength(1);
    expect(ctx.schema).toBeUndefined();
  });

  it('treats a list answer without an exact name match as not found', async () => {
    const get = org({
      [`/api/v1/queues?name=${encodeURIComponent('AF · AP Invoices · barge-17')}`]: {
        results: [{ ...QUEUE, name: 'af · ap invoices · barge-17' }],
      },
    });
    expect((await loadContext(new Set(['queue']), 'barge-17', get)).queue).toBeNull();
  });

  it('treats a queue Rossum is still deleting as gone', async () => {
    const get = org({
      [`/api/v1/queues?name=${encodeURIComponent('AF · AP Invoices · barge-17')}`]: {
        results: [{ ...QUEUE, status: 'deletion_requested' }],
      },
    });
    expect((await loadContext(new Set(['queue']), 'barge-17', get)).queue).toBeNull();
  });

  it('walks a nested schema and reads every datapoint', async () => {
    const get = org({
      ...queueRoute,
      '/api/v1/schemas/5': {
        id: 5,
        content: [
          {
            category: 'section',
            id: 's',
            children: [
              {
                category: 'datapoint',
                id: 'po_number',
                type: 'string',
                rir_field_names: ['order_id'],
              },
              {
                category: 'multivalue',
                id: 'items',
                children: {
                  category: 'tuple',
                  id: 'row',
                  children: [{ category: 'datapoint', id: 'qty', type: 'number' }],
                },
              },
            ],
          },
        ],
      },
    });
    const ctx = await loadContext(new Set(['schema']), 'barge-17', get);
    expect(ctx.schema!.fields.map((f) => f.id)).toEqual(['po_number', 'qty']);
    expect(ctx.schema!.fields[0].rir).toEqual(['order_id']);
  });

  it('keeps only hooks with MDH settings that are attached to the queue', async () => {
    const get = org({
      ...queueRoute,
      '/api/v1/hooks?queue=31927&page_size=100': {
        results: [
          { id: 1, queues: [QUEUE.url], settings: { configurations: [{}] } },
          { id: 2, queues: [QUEUE.url], settings: {} },
          { id: 3, queues: ['https://x/api/v1/queues/9'], settings: { configurations: [] } },
        ],
      },
    });
    const ctx = await loadContext(new Set(['hooks']), 'barge-17', get);
    expect(ctx.hooks!.map((h) => h.id)).toEqual([1]);
  });

  it('reads the dataset with two Data Storage list queries, authenticated with Bearer', async () => {
    const get = org({
      'POST /svc/data-storage/api/v1/collections/list': { result: ['af_vendor_master_barge_17'] },
      'POST /svc/data-storage/api/v1/data/aggregate': { result: [{ n: 40 }] },
    });
    const ctx = await loadContext(new Set(['dataset']), 'barge-17', get);
    expect(ctx.dataset).toEqual({ exists: true, records: 40 });
    const list = vi.mocked(get).mock.calls[0];
    expect(list[1]).toEqual({
      method: 'POST',
      body: { filter: { name: 'af_vendor_master_barge_17' }, nameOnly: true },
      auth: 'bearer',
    });
  });

  it('finds a confirmed invoice whose content has vendor_match filled', async () => {
    const get = org({
      ...queueRoute,
      '/api/v1/annotations?queue=31927&page_size=1': { pagination: { total: 3 }, results: [{}] },
      '/api/v1/annotations?queue=31927&status=confirmed,exported&ordering=-modified_at&page_size=5':
        { results: [{ id: 10 }, { id: 11 }] },
      '/api/v1/annotations/10/content': {
        content: [{ schema_id: 'vendor_match', content: { value: '' } }],
      },
      '/api/v1/annotations/11/content': {
        content: [{ schema_id: 'vendor_match', content: { value: 'V001' } }],
      },
    });
    const ctx = await loadContext(new Set(['annotations']), 'barge-17', get);
    expect(ctx.annotations).toEqual({ count: 3, confirmedId: 11 });
  });

  it('lets a 429 through instead of reading it as "not found"', async () => {
    const get = vi.fn(async () => {
      throw rateLimitError({ headers: null }, 'API 429');
    }) as unknown as Get;
    await expect(loadContext(new Set(['queue']), 'barge-17', get)).rejects.toMatchObject({
      status: 429,
    });
  });
});

describe('needsOf / pathOf / hasVendorMatch', () => {
  it('is the union of what the tasks read', () => {
    const tk = (needs: any) => ({ id: 'x', title: '', why: '', where: '', needs });
    expect([...needsOf([tk(['hooks']), tk(['hooks', 'rule'])])].sort()).toEqual(['hooks', 'rule']);
  });

  it('reduces an absolute URL to its path', () => {
    expect(pathOf('https://x.rossum.app/api/v1/schemas/5?a=1')).toBe('/api/v1/schemas/5?a=1');
    expect(pathOf(null)).toBeNull();
  });

  it('finds vendor_match inside a nested section', () => {
    expect(
      hasVendorMatch({
        content: [
          {
            category: 'section',
            children: [{ schema_id: 'vendor_match', content: { value: 'V2' } }],
          },
        ],
      }),
    ).toBe(true);
    expect(hasVendorMatch({ content: [] })).toBe(false);
  });
});

describe('runChecks', () => {
  it('re-checks every mission reached so far, so undone work shows up', async () => {
    const get = org({
      [`/api/v1/queues?name=${encodeURIComponent('AF · AP Invoices · barge-17')}`]: { results: [] },
      'POST /svc/data-storage/api/v1/collections/list': { result: [] },
    });
    const run = await runChecks(TRACK, progressThrough(2), get);
    // Kickoff's visit task cannot be judged without a location, so its result stands.
    expect(Object.keys(run.results)).toEqual([
      'kickoff.queue',
      'fields.extract',
      'fields.match',
      'vendors.dataset',
      'vendors.records',
    ]);
    expect(run.results['kickoff.queue'][0].state).toBe('no');
  });
});
