import { describe, it, expect } from 'vitest';
import {
  addressOf,
  createBody,
  editBody,
  pinBody,
  serverFromHook,
  type ServerInput,
} from '../src/sftp/servers.js';
import { HELPER_CODE } from '../src/sftp/helperCode.js';

const input: ServerInput = {
  host: 'sftp.example.com',
  port: 22,
  user: 'acme',
  auth: 'password',
  secret: 's3cret',
};

// A hook as the API lists it after createBody: secrets are never returned.
function listed(over: Record<string, any> = {}, settings: Record<string, any> = {}) {
  const body = createBody(input);
  return {
    ...body,
    id: 7,
    url: 'https://example.rossum.app/api/v1/hooks/7',
    secrets: null,
    settings: { ...body.settings, ...settings },
    ...over,
  };
}

describe('a saved server is a helper hook', () => {
  it('creates a function hook that only a manual invocation runs', () => {
    const body = createBody(input);
    expect(body).toMatchObject({
      type: 'function',
      queues: [],
      events: ['invocation.manual'],
      active: true,
      config: {
        runtime: 'python3.12',
        third_party_library_pack: 'professional_services',
        code: HELPER_CODE,
      },
      secrets: { password: 's3cret' },
    });
    expect(body.name).toContain('acme@sftp.example.com:22');
    expect(body.description).toContain('SA extension');
    expect(body.description).toContain('acme@sftp.example.com:22');
    expect(body.description).toContain('manual invocation only');
  });

  it('keeps the secret out of the settings', () => {
    const body = createBody({ ...input, auth: 'key', secret: '-----BEGIN KEY-----' });
    expect(body.secrets).toEqual({ private_key: '-----BEGIN KEY-----' });
    expect(JSON.stringify(body.settings)).not.toContain('BEGIN');
    expect(JSON.stringify(createBody(input).settings)).not.toContain('s3cret');
  });

  it('reads back its own hooks and nothing else', () => {
    const s = serverFromHook(listed())!;
    expect(s).toMatchObject({
      hookId: 7,
      host: 'sftp.example.com',
      port: 22,
      user: 'acme',
      auth: 'password',
      hostKey: null,
      stale: false,
    });
    expect(addressOf(s)).toBe('acme@sftp.example.com:22');
    expect(serverFromHook({ type: 'function', settings: { host: 'x', port: 22, user: 'y' } })).toBe(
      null,
    );
    expect(serverFromHook(listed({ type: 'webhook' }))).toBe(null);
    expect(serverFromHook(listed({}, { port: 'nope' }))).toBe(null);
    expect(serverFromHook(null)).toBe(null);
  });

  it('marks a helper whose code is older than this build', () => {
    expect(serverFromHook(listed({ config: { code: '# old' } }))!.stale).toBe(true);
    // A helper from before the library pack: same code, default pack.
    expect(
      serverFromHook(listed({ config: { runtime: 'python3.12', code: HELPER_CODE } }))!.stale,
    ).toBe(true);
  });
});

describe('editing and pinning', () => {
  const pinned = serverFromHook(listed({}, { host_key: 'ssh-ed25519 SHA256:abc' }))!;

  it('sends a secret only when one was typed', () => {
    expect(editBody(pinned, { ...input, secret: '' })).not.toHaveProperty('secrets');
    expect(editBody(pinned, { ...input, secret: 'new' }).secrets).toEqual({ password: 'new' });
  });

  it('keeps the pinned host key for the same endpoint and drops it for another', () => {
    expect((editBody(pinned, { ...input, user: 'other' }).settings as any).host_key).toBe(
      'ssh-ed25519 SHA256:abc',
    );
    expect(editBody(pinned, { ...input, port: 22001 }).settings).not.toHaveProperty('host_key');
    expect(editBody(pinned, { ...input, host: 'b.example.com' }).settings).not.toHaveProperty(
      'host_key',
    );
  });

  it('pins a key and refreshes the code in one PATCH', () => {
    const fresh = serverFromHook(listed())!;
    const body = pinBody(fresh, 'ssh-ed25519 SHA256:new');
    expect(body.settings.host_key).toBe('ssh-ed25519 SHA256:new');
    expect(body.config.code).toBe(HELPER_CODE);
    expect(pinBody(pinned, null).settings.host_key).toBe('ssh-ed25519 SHA256:abc');
  });
});

describe('the helper code', () => {
  it('answers through the Rossum handler and never logs', () => {
    expect(HELPER_CODE).toContain('def rossum_hook_request_handler(payload):');
    expect(HELPER_CODE).not.toMatch(/\bprint\(|\blogging\b/);
  });

  it("imports paramiko from Rossum's library pack and installs nothing", () => {
    expect(HELPER_CODE).toContain('\nimport paramiko\n');
    expect(HELPER_CODE).not.toMatch(/pip|subprocess/);
  });

  it("caps the connect well under Rossum's 30 s, for all addresses together", () => {
    expect(HELPER_CODE).toContain('CONNECT_TIMEOUT = 10');
    expect(HELPER_CODE).toContain('CONNECT_TIMEOUT / len(addresses)');
  });
});
