import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchUsers } from '../src/rdc/users.js';
import {
  OVERLAY_PATH,
  readHookTokenOwner,
  setHookTokenOwner,
  storeHookCreates,
} from '../src/rdc/tokenOwner.js';

// rdc's scaffolded overlay (templates/overlay.toml): the example table is commented out.
const SCAFFOLD = `# Per-env overrides.
version = 1

# [hooks."*"]
# token_owner = "https://acme.rossum.app/api/v1/users/12345"
`;
const U = 'https://acme.rossum.app/api/v1/users/7';

describe('the hooks token owner in overlay.toml', () => {
  it('is the target env overlay', () => {
    expect(OVERLAY_PATH).toBe('envs/target/overlay.toml');
  });

  it('reads nothing from the scaffold: its example is a comment', () => {
    expect(readHookTokenOwner(SCAFFOLD)).toBeNull();
  });

  it('appends a [hooks."*"] table to the scaffold, leaving the rest as it was', () => {
    const out = setHookTokenOwner(SCAFFOLD, U);
    expect(out).toBe(`${SCAFFOLD}\n[hooks."*"]\ntoken_owner = "${U}"\n`);
    expect(readHookTokenOwner(out)).toBe(U);
  });

  it('replaces the value in an existing table and keeps its other keys and the tables after it', () => {
    const text = `version = 1\n\n[hooks."*"]\nsettings = { a = 1 }\ntoken_owner = "https://x/api/v1/users/1"\n\n[queues.invoices]\nlocale = "en"\n`;
    const out = setHookTokenOwner(text, U);
    expect(out).toBe(
      `version = 1\n\n[hooks."*"]\nsettings = { a = 1 }\ntoken_owner = "${U}"\n\n[queues.invoices]\nlocale = "en"\n`,
    );
  });

  it('adds the key to an existing table that has none', () => {
    const text = `version = 1\n[hooks."*"]\nsettings = { a = 1 }\n[queues.q]\nx = 1\n`;
    expect(setHookTokenOwner(text, U)).toBe(
      `version = 1\n[hooks."*"]\ntoken_owner = "${U}"\nsettings = { a = 1 }\n[queues.q]\nx = 1\n`,
    );
  });

  it('does not take a per-hook table for the wildcard', () => {
    const text = `version = 1\n[hooks.export]\ntoken_owner = "https://x/api/v1/users/1"\n`;
    expect(readHookTokenOwner(text)).toBeNull();
  });

  it('escapes the value as a TOML basic string', () => {
    expect(setHookTokenOwner('version = 1\n', 'a"b\\c')).toContain('token_owner = "a\\"b\\\\c"');
    expect(readHookTokenOwner(setHookTokenOwner('version = 1\n', 'a"b\\c'))).toBe('a"b\\c');
  });
});

describe('storeHookCreates', () => {
  const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
  const files = new Map([
    ['envs/target/hooks/mdh.json', enc({ name: 'MDH', extension_source: 'rossum_store' })],
    ['envs/target/hooks/mdh.py', new Uint8Array()],
    ['envs/target/hooks/custom.json', enc({ name: 'Custom', type: 'function' })],
    ['envs/target/hooks/old-store.json', enc({ name: 'Old', extension_source: 'rossum_store' })],
  ]);
  const file = (target: string, slug: string) => ({
    source: target,
    target,
    change: 'create' as const,
    kind: 'hooks',
    slug,
  });
  const result = {
    files: [
      file('envs/target/hooks/mdh.py', 'mdh'),
      file('envs/target/hooks/mdh.json', 'mdh'),
      file('envs/target/hooks/custom.json', 'custom'),
      file('envs/target/hooks/old-store.json', 'old-store'),
    ],
  } as any;
  const item = (slug: string, change: string) => ({
    kind: 'hooks',
    slug,
    direction: 'push',
    change,
    prompt: null,
    note: null,
  });

  it("names the store-extension hooks the plan creates: rdc's /hooks/create needs a token_owner", () => {
    const plan = {
      items: [item('mdh', 'create'), item('custom', 'create'), item('old-store', 'update')],
      recovered: [],
      problems: [],
    } as any;
    expect(storeHookCreates(result, plan, files)).toEqual(['mdh']);
  });
});

describe('fetchUsers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists the org's active users by API URL, every page, sorted by label", async () => {
    const pages: Record<string, unknown> = {
      'https://acme.rossum.app/api/v1/users?is_active=true&page_size=100': {
        results: [
          {
            url: 'https://acme.rossum.app/api/v1/users/2',
            first_name: 'Zed',
            last_name: 'Z',
            email: 'z@example.com',
          },
          { url: 'https://acme.rossum.app/api/v1/users/3', username: 'robot', is_active: false },
        ],
        pagination: { next: 'https://acme.rossum.app/api/v1/users?page=2' },
      },
      'https://acme.rossum.app/api/v1/users?page=2': {
        results: [{ url: 'https://acme.rossum.app/api/v1/users/1', username: 'ada' }],
        pagination: { next: null },
      },
    };
    const fetch = vi.fn(async (url: string, init: any) => {
      expect(init.headers.Authorization).toBe('Bearer tok');
      return new Response(JSON.stringify(pages[url]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await fetchUsers('https://acme.rossum.app', 'tok')).toEqual([
      { url: 'https://acme.rossum.app/api/v1/users/1', label: 'ada' },
      { url: 'https://acme.rossum.app/api/v1/users/2', label: 'Zed Z (z@example.com)' },
    ]);
  });
});
