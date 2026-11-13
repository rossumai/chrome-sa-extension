import { describe, it, expect, vi, afterEach } from 'vitest';
import { STATE_COLLECTION, keepStateInOrgs, stateKeyFor } from '../src/rdc/deploy.js';
import { diffEnvTree, isFirstRead, runErrorFor } from '../src/rdc/core.js';
import {
  addDirectEdits,
  loadDirectEdits,
  loadMapping,
  saveDirectEdits,
  saveMapping,
} from '../src/rdc/sourceStore.js';
import { isHiddenCollection } from '../src/mdh/hiddenCollections.js';
import { memoryDataStorage } from './support/rdcDataStorage.js';

const enc = (s: string) => new TextEncoder().encode(s);

describe('rdc sync state in Data Storage', () => {
  it('lives in a collection Dataset Management hides', () => {
    expect(STATE_COLLECTION).toBe('_SA_EXTENSION__rdc_state');
    expect(isHiddenCollection(STATE_COLLECTION)).toBe(true);
  });

  it('is keyed by the target org only', () => {
    expect(stateKeyFor(31007)).toBe('chrome-sa-extension/rdc-deployments/31007');
    expect(() => stateKeyFor(Number.NaN)).toThrow();
    expect(() => stateKeyFor(1.5)).toThrow();
  });
});

describe('runErrorFor', () => {
  it("explains rdc's lock, state and recovery errors", () => {
    expect(runErrorFor("env 'target' is already being synced in another tab")).toMatch(
      /Another tab of this browser/,
    );
    expect(runErrorFor('Web Locks are not available in this context')).toMatch(/cannot lock/);
    expect(
      runErrorFor(
        "saving the sync state of env 'target' to Data Storage: the state of env 'target' was changed by another run",
      ),
    ).toMatch(/Someone else ran rdc on this org/);
    expect(
      runErrorFor(
        "loading sync state for env 'source': loading the sync state of env 'source' from Data Storage: HTTP 500",
      ),
    ).toMatch(/could not load its sync state/);
    expect(
      runErrorFor(
        "labels/hold: an unfinished run's create may have made any of 2 labels (ids 5, 7); rdc cannot tell which.",
      ),
    ).toMatch(/stopped in the middle/);
  });

  it('leaves any other message alone', () => {
    expect(runErrorFor('HTTP 401')).toBeNull();
  });
});

describe('diffEnvTree', () => {
  it('lists the files added, changed and removed under one env, sorted', () => {
    const before = new Map([
      ['envs/target/hooks/a.json', enc('1')],
      ['envs/target/hooks/a.py', enc('x')],
      ['envs/target/rules/r.json', enc('1')],
      ['envs/source/hooks/a.json', enc('1')],
    ]);
    const after = new Map([
      ['envs/target/hooks/a.json', enc('1')],
      ['envs/target/hooks/a.py', enc('y')],
      ['envs/target/labels/l.json', enc('1')],
      ['envs/source/hooks/a.json', enc('2')],
    ]);
    expect(diffEnvTree(before, after, 'target')).toEqual([
      { path: 'envs/target/hooks/a.py', change: 'changed' },
      { path: 'envs/target/labels/l.json', change: 'added' },
      { path: 'envs/target/rules/r.json', change: 'removed' },
    ]);
  });

  it("ignores rdc's generated index and the env's own values", () => {
    const after = new Map([
      ['envs/target/_index.md', enc('x')],
      ['envs/target/hooks/_index.md', enc('x')],
      ['envs/target/overlay.toml', enc('x')],
    ]);
    expect(diffEnvTree(new Map(), after, 'target')).toEqual([]);
  });
});

describe('direct edits store', () => {
  it('loads the stored paths, or none', async () => {
    const ds = vi.fn(async () => [{ kind: 'directEdits', paths: ['envs/target/a.json', 3] }]);
    expect(await loadDirectEdits(ds)).toEqual(['envs/target/a.json']);
    expect(ds).toHaveBeenCalledWith('find', { query: { kind: 'directEdits' }, limit: 1 });
    expect(await loadDirectEdits(async () => [])).toEqual([]);
  });

  it('upserts the paths, sorted and without duplicates', async () => {
    const ds = vi.fn(async (_op: string, _b: Record<string, unknown>) => ({}));
    await saveDirectEdits(ds, ['b', 'a', 'b']);
    const [op, body] = ds.mock.calls[0];
    expect(op).toBe('replace_one');
    expect(body).toMatchObject({
      filter: { kind: 'directEdits' },
      replacement: { kind: 'directEdits', paths: ['a', 'b'] },
      options: { upsert: true },
    });
  });
});

describe('keepStateInOrgs', () => {
  it("hands rdc a store that keeps each env's state in its own org, under the target's key", async () => {
    let store: any;
    const useStateStore = vi.fn((s: unknown) => void (store = s));
    const source = memoryDataStorage();
    const target = memoryDataStorage();
    expect(
      keepStateInOrgs({ useStateStore } as any, { source: source.ds, target: target.ds }, 31007),
    ).toBe(true);
    expect(useStateStore).toHaveBeenCalledTimes(1);
    await store.save('source', new Uint8Array([1]), null, 1);
    await store.save('target', new Uint8Array([2]), null, 1);
    expect(source.docs.map((d) => d._id)).toEqual([
      'chrome-sa-extension/rdc-deployments/31007/source',
    ]);
    expect(target.docs.map((d) => d._id)).toEqual([
      'chrome-sa-extension/rdc-deployments/31007/target',
    ]);
  });

  it('keeps the state in memory with a build that has no useStateStore', () => {
    const ds = memoryDataStorage().ds;
    expect(
      keepStateInOrgs({ useDataStorageState: vi.fn() } as any, { source: ds, target: ds }, 1),
    ).toBe(false);
  });
});

describe('slug mapping store', () => {
  const src = {
    name: 'test',
    domain: 'https://partner-sandbox.rossum.app',
    orgId: 5,
    orgName: 'T',
  };

  it('loads the stored .rdc/mapping.toml only for the same source', async () => {
    const doc = { kind: 'mapping', domain: src.domain, orgId: 5, text: '[queues]\n' };
    const ds = vi.fn(async () => [doc]);
    expect(await loadMapping(ds, src)).toBe('[queues]\n');
    expect(ds).toHaveBeenCalledWith('find', {
      query: { kind: 'mapping', domain: src.domain, orgId: 5 },
      limit: 1,
    });
    expect(await loadMapping(async () => [{ ...doc, orgId: 6 }], src)).toBeNull();
    expect(await loadMapping(async () => [{ ...doc, domain: 'https://x' }], src)).toBeNull();
    expect(await loadMapping(async () => [], src)).toBeNull();
  });

  it("keeps one mapping per source: saving B's never touches A's", async () => {
    const a = { kind: 'mapping', domain: src.domain, orgId: 5, text: 'rows of A' };
    const store = memoryDataStorage([a]);
    const b = { ...src, orgId: 6 };
    expect(await loadMapping(store.ds, b)).toBeNull();
    await saveMapping(store.ds, b, 'rows of B');
    expect(await loadMapping(store.ds, src)).toBe('rows of A');
    expect(await loadMapping(store.ds, b)).toBe('rows of B');
  });

  it('upserts the text with the source it belongs to', async () => {
    const ds = vi.fn(async (_op: string, _b: Record<string, unknown>) => ({}));
    await saveMapping(ds, src, 'x');
    expect(ds.mock.calls[0][1]).toMatchObject({
      filter: { kind: 'mapping', domain: src.domain, orgId: 5 },
      replacement: { kind: 'mapping', domain: src.domain, orgId: 5, text: 'x' },
      options: { upsert: true },
    });
  });
});

describe('isFirstRead', () => {
  it("does not count a new project's scaffold as a stored tree", () => {
    expect(isFirstRead(new Map([['envs/target/overlay.toml', enc('')]]), 'target')).toBe(true);
    expect(isFirstRead(new Map([['envs/target/hooks/a.json', enc('{}')]]), 'target')).toBe(false);
    expect(isFirstRead(new Map([['envs/source/hooks/a.json', enc('{}')]]), 'target')).toBe(true);
  });
});

describe('addDirectEdits', () => {
  afterEach(() => vi.unstubAllGlobals());

  // A one-holder lock manager, as navigator.locks is for the tabs of one browser.
  function fakeLocks() {
    let tail = Promise.resolve();
    return {
      request: (_name: string, cb: () => Promise<unknown>) => {
        const run = tail.then(cb);
        tail = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    };
  }

  it('two tabs adding at once both keep their edits', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    const store = memoryDataStorage();
    // every call yields, so unserialised load-merge-saves would interleave and lose one
    const slow = async (op: string, body: any) => {
      await new Promise((r) => setTimeout(r, 1));
      return store.ds(op, body);
    };
    const [a, b] = await Promise.all([
      addDirectEdits(slow, 'org-lock', ['envs/target/a.json']),
      addDirectEdits(slow, 'org-lock', ['envs/target/b.json']),
    ]);
    expect(a).toEqual(['envs/target/a.json']);
    expect(b).toEqual(['envs/target/a.json', 'envs/target/b.json']);
    expect(await loadDirectEdits(store.ds)).toEqual(['envs/target/a.json', 'envs/target/b.json']);
  });

  it('saves nothing when there is nothing new', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    const store = memoryDataStorage([{ kind: 'directEdits', paths: ['x'] }]);
    expect(await addDirectEdits(store.ds, 'org-lock', [])).toEqual(['x']);
    expect(store.calls.filter(([op]) => op === 'replace_one')).toEqual([]);
  });
});
