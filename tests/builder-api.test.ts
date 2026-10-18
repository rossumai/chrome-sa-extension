// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as api from '../src/builder/api.js';
import { isRateLimited } from '../src/net/rateLimit.js';

let fetchMock: any;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  api.init('https://x.rossum.ai', 'tok-123');
});
function jsonRes(body: any, { ok = true, status = 200 } = {}) {
  return { ok, status, headers: new Headers(), json: () => Promise.resolve(body) };
}

describe('builder api', () => {
  it('validateSchema POSTs id and content to the validate endpoint', async () => {
    fetchMock.mockResolvedValue(jsonRes({}));
    const out = await api.validateSchema(7, [{ id: 's' }]);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x.rossum.ai/api/v1/schemas/validate');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ id: 7, content: [{ id: 's' }] });
    expect(out).toEqual({});
  });

  it('patchSchema PATCHes only the content', async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: 7 }));
    await api.patchSchema(7, [{ id: 's' }]);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x.rossum.ai/api/v1/schemas/7');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ content: [{ id: 's' }] });
  });

  it('a 400 on PATCH rejects with the status and the body text', async () => {
    fetchMock.mockResolvedValue(jsonRes({ content: ['bad'] }, { ok: false, status: 400 }));
    await expect(api.patchSchema(7, [])).rejects.toMatchObject({ status: 400 });
    fetchMock.mockResolvedValue(jsonRes({ content: ['bad'] }, { ok: false, status: 400 }));
    await expect(api.patchSchema(7, [])).rejects.toThrow('bad');
  });

  it('a 429 is recognised as rate limited', async () => {
    fetchMock.mockResolvedValue(jsonRes({ detail: 'slow down' }, { ok: false, status: 429 }));
    const err = await api.getSchema(7).catch((e) => e);
    expect(isRateLimited(err)).toBe(true);
  });

  it('listQueues follows pagination', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonRes({ results: [{ id: 1 }], pagination: { next: 'https://x.rossum.ai/p2' } }),
      )
      .mockResolvedValueOnce(jsonRes({ results: [{ id: 2 }], pagination: { next: null } }));
    expect((await api.listQueues()).map((q) => q.id)).toEqual([1, 2]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.rossum.ai/api/v1/queues/?page_size=100');
  });

  it('listAnnotations asks for the 20 newest in the queue with their documents', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [{ id: 5 }], documents: [{ id: 9 }] }));
    const out = await api.listAnnotations(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://x.rossum.ai/api/v1/annotations/?queue=3&ordering=-created_at&page_size=20&sideload=documents',
    );
    expect(out).toEqual({ results: [{ id: 5 }], documents: [{ id: 9 }] });
  });

  it('getAnnotationContent reads the content sub-resource', async () => {
    fetchMock.mockResolvedValue(jsonRes({ content: [] }));
    await api.getAnnotationContent(5);
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.rossum.ai/api/v1/annotations/5/content');
  });

  it('patchSchema sends the name only when given', async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: 7 }));
    await api.patchSchema(7, [], 'New name');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ content: [], name: 'New name' });
  });

  it('listSchemas pages through all schemas', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [{ id: 1 }], pagination: { next: null } }));
    await api.listSchemas();
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.rossum.ai/api/v1/schemas/?page_size=100');
  });
});
