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

  it('creates a workspace, a schema and a queue with the right bodies', async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: 1, url: 'u' }));
    await api.createWorkspace('AP', 'https://x.rossum.ai/api/v1/organizations/3');
    await api.createSchema('Invoices', [{ id: 's' }]);
    await api.createQueue('Invoices', 'w/1', 's/2');
    const calls = fetchMock.mock.calls.map(([url, o]: any) => [url, o.method, JSON.parse(o.body)]);
    expect(calls).toEqual([
      [
        'https://x.rossum.ai/api/v1/workspaces/',
        'POST',
        { name: 'AP', organization: 'https://x.rossum.ai/api/v1/organizations/3' },
      ],
      ['https://x.rossum.ai/api/v1/schemas/', 'POST', { name: 'Invoices', content: [{ id: 's' }] }],
      [
        'https://x.rossum.ai/api/v1/queues/',
        'POST',
        { name: 'Invoices', workspace: 'w/1', schema: 's/2' },
      ],
    ]);
  });

  it('deletes a queue immediately and a schema, accepting an empty 204 body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
      json: () => Promise.reject(new Error('no body')),
    });
    await api.deleteQueue(4);
    await api.deleteSchema(5);
    expect(fetchMock.mock.calls.map(([url, o]: any) => [url, o.method])).toEqual([
      ['https://x.rossum.ai/api/v1/queues/4?delete_after=0', 'DELETE'],
      ['https://x.rossum.ai/api/v1/schemas/5', 'DELETE'],
    ]);
  });

  it('listRules lists the rules attached to a queue', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [], pagination: { next: null } }));
    await api.listRules(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://x.rossum.ai/api/v1/rules/?queue=3&page_size=100',
    );
  });

  it('creates and patches rules', async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: 4 }));
    await api.createRule({ name: 'R' });
    await api.patchRule(4, { name: 'R2' });
    expect(
      fetchMock.mock.calls.map(([url, o]: any) => [url, o.method, JSON.parse(o.body)]),
    ).toEqual([
      ['https://x.rossum.ai/api/v1/rules/', 'POST', { name: 'R' }],
      ['https://x.rossum.ai/api/v1/rules/4', 'PATCH', { name: 'R2' }],
    ]);
  });

  it("lists a queue's hooks and patches a hook's settings", async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [], pagination: { next: null } }));
    await api.listHooks(3);
    fetchMock.mockResolvedValue(jsonRes({ id: 7 }));
    await api.patchHookSettings(7, { configurations: [] });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://x.rossum.ai/api/v1/hooks/?queue=3&page_size=100',
    );
    const [url, o] = fetchMock.mock.calls[1];
    expect([url, o.method, JSON.parse(o.body)]).toEqual([
      'https://x.rossum.ai/api/v1/hooks/7',
      'PATCH',
      { settings: { configurations: [] } },
    ]);
  });
});
