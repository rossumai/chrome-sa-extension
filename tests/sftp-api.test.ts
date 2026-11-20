import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke, listServers } from '../src/sftp/api.js';
import { domain, token } from '../src/sftp/store.js';
import { createBody, serverFromHook } from '../src/sftp/servers.js';
import { isRateLimited } from '../src/net/rateLimit.js';

const DOMAIN = 'https://example.rossum.app';

function hook(id: number, host = 'sftp.example.com') {
  return {
    ...createBody({ host, port: 22, user: 'acme', auth: 'password', secret: 'x' }),
    id,
    url: `${DOMAIN}/api/v1/hooks/${id}`,
    secrets: null,
  };
}
const server = serverFromHook(hook(7))!;

const reply = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  domain.value = DOMAIN;
  token.value = 'tok';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('listServers', () => {
  it('pages through the hooks and keeps only the helpers', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(200, {
          results: [hook(2, 'b.example.com'), { id: 3, type: 'webhook', settings: {} }],
          pagination: { next: `${DOMAIN}/api/v1/hooks?page=2` },
        }),
      )
      .mockResolvedValueOnce(
        reply(200, { results: [hook(1, 'a.example.com')], pagination: { next: null } }),
      );
    const list = await listServers();
    expect(list.map((s) => s.hookId)).toEqual([1, 2]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${DOMAIN}/api/v1/hooks?type=function&page_size=100`);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('throws a rate limit as one, without retrying', async () => {
    fetchMock.mockResolvedValue(reply(429, {}));
    const err = await listServers().catch((e) => e);
    expect(isRateLimited(err)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('invoke', () => {
  const sleep = vi.fn(async () => {});

  it('posts the ops to the hook and returns the results', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { host_key: 'ssh-ed25519 SHA256:k', results: [{ ok: true, entries: [] }] }),
    );
    const r = await invoke(server, [{ op: 'list', path: '.' }], undefined, sleep);
    expect(r).toEqual({ hostKey: 'ssh-ed25519 SHA256:k', results: [{ ok: true, entries: [] }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DOMAIN}/api/v1/hooks/7/invoke`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ ops: [{ op: 'list', path: '.' }] });
  });

  it('waits while a fresh helper is initializing, and says so', async () => {
    const onWait = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        reply(400, {
          detail: 'Hook invocation failed: FunctionNotReadyException: Initializing extension',
        }),
      )
      .mockResolvedValueOnce(reply(200, { host_key: 'k', results: [] }));
    await invoke(server, [], onWait, sleep);
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws the helper's own error", async () => {
    fetchMock.mockResolvedValue(reply(200, { error: 'Authentication failed.' }));
    await expect(invoke(server, [], undefined, sleep)).rejects.toThrow('Authentication failed.');
  });

  it('flags a changed host key with the new key', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { error: 'changed', host_key: 'ssh-ed25519 SHA256:new', host_key_changed: true }),
    );
    const err = await invoke(server, [], undefined, sleep).catch((e) => e);
    expect(err.hostKeyChanged).toBe(true);
    expect(err.hostKey).toBe('ssh-ed25519 SHA256:new');
  });

  it("words Rossum's own 30 s deadline", async () => {
    fetchMock.mockResolvedValue(
      reply(400, {
        detail:
          'Hook invocation failed: FunctionException: Read timeout on endpoint URL: "https://lambda.example/x"',
      }),
    );
    await expect(invoke(server, [], undefined, sleep)).rejects.toThrow(
      'The helper did not answer within 30 seconds.',
    );
  });

  it("names Rossum's detail for any other failure", async () => {
    fetchMock.mockResolvedValue(reply(403, { detail: 'You do not have permission.' }));
    await expect(invoke(server, [], undefined, sleep)).rejects.toThrow(
      'You do not have permission.',
    );
  });
});
