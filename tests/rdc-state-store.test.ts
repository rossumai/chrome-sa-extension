import { describe, it, expect, vi, afterEach } from 'vitest';
import { MAX_DOCUMENT_BYTES, dataStorageStateStore } from '../src/rdc/stateStore.js';
import { memoryDataStorage } from './support/rdcDataStorage.js';

const KEY = 'chrome-sa-extension/rdc-deployments/31007';
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const b64 = (s: string) => Buffer.from(s).toString('base64');

function setup(initial: Record<string, unknown>[] = []) {
  const target = memoryDataStorage(initial);
  const source = memoryDataStorage();
  const store = dataStorageStateStore({ target: target.ds, source: source.ds }, KEY);
  return { store, target, source };
}

afterEach(() => vi.restoreAllMocks());

describe('the Data Storage state store', () => {
  it('loads with one find by _id, and answers null when nothing is stored', async () => {
    const { store, target } = setup();
    expect(await store.load('target')).toBeNull();
    expect(target.calls).toEqual([['find', { query: { _id: `${KEY}/target` }, limit: 1 }]]);
  });

  it('loads the stored rev and snapshot bytes', async () => {
    const { store } = setup([{ _id: `${KEY}/target`, rev: 4, snapshot: b64('state') }]);
    const got = await store.load('target');
    expect(got!.rev).toBe(4);
    expect(text(got!.snapshot)).toBe('state');
  });

  it('treats a manifest of the old blob format as absent', async () => {
    const { store } = setup([{ _id: `${KEY}/target`, rev: 9, files: { '.rdc/x': {} } }]);
    expect(await store.load('target')).toBeNull();
  });

  it('keeps each env in its own org', async () => {
    const { store, target, source } = setup();
    await store.save('source', bytes('s'), null, 1);
    await store.save('target', bytes('t'), null, 1);
    expect(source.docs.map((d) => d._id)).toEqual([`${KEY}/source`]);
    expect(target.docs.map((d) => d._id)).toEqual([`${KEY}/target`]);
    await expect(store.load('other')).rejects.toThrow(/no org for env 'other'/);
  });

  it('a first save is one insert', async () => {
    const { store, target } = setup();
    expect(await store.save('target', bytes('one'), null, 1)).toBe(true);
    expect(target.calls).toEqual([
      ['insert_one', { document: { _id: `${KEY}/target`, rev: 1, snapshot: b64('one') } }],
    ]);
  });

  it('a first save that loses the race to another run answers false', async () => {
    const { store } = setup([{ _id: `${KEY}/target`, rev: 1, snapshot: b64('theirs') }]);
    expect(await store.save('target', bytes('mine'), null, 1)).toBe(false);
    expect(text((await store.load('target'))!.snapshot)).toBe('theirs');
  });

  it('a later save is one compare-and-swap on the rev', async () => {
    const { store, target } = setup([{ _id: `${KEY}/target`, rev: 3, snapshot: b64('old') }]);
    expect(await store.save('target', bytes('new'), 3, 4)).toBe(true);
    expect(target.calls).toEqual([
      [
        'replace_one',
        {
          filter: { _id: `${KEY}/target`, rev: 3 },
          replacement: { _id: `${KEY}/target`, rev: 4, snapshot: b64('new') },
        },
      ],
    ]);
    expect((await store.load('target'))!.rev).toBe(4);
  });

  it('a compare-and-swap against a rev another run moved answers false and writes nothing', async () => {
    const { store } = setup([{ _id: `${KEY}/target`, rev: 5, snapshot: b64('theirs') }]);
    expect(await store.save('target', bytes('mine'), 3, 4)).toBe(false);
    const got = (await store.load('target'))!;
    expect([got.rev, text(got.snapshot)]).toEqual([5, 'theirs']);
  });

  it('replaces a manifest of the old blob format on the first save, and drops its blobs', async () => {
    const { store, target } = setup([
      { _id: `${KEY}/target`, rev: 9, files: {} },
      { _id: `${KEY}/target/blob/abc/524288/0`, text: 'x' },
      { _id: `${KEY}/source/blob/abc/524288/0`, text: 'other env' },
    ]);
    expect(await store.save('target', bytes('new'), null, 1)).toBe(true);
    expect(target.docs).toEqual([
      { _id: `${KEY}/target`, rev: 1, snapshot: b64('new') },
      { _id: `${KEY}/source/blob/abc/524288/0`, text: 'other env' },
    ]);
  });

  it('throws a clear message on any other failure', async () => {
    const { store, target } = setup([{ _id: `${KEY}/target`, rev: 3, snapshot: b64('old') }]);
    target.failNext.replace_one = 'HTTP 503';
    await expect(store.save('target', bytes('new'), 3, 4)).rejects.toThrow(
      "saving the sync state of env 'target' to Data Storage: HTTP 503",
    );
    target.failNext.find = 'HTTP 500';
    await expect(store.load('target')).rejects.toThrow(
      "loading the sync state of env 'target' from Data Storage: HTTP 500",
    );
  });

  it('settles a compare-and-swap whose answer was lost by reading it back', async () => {
    const { store, target } = setup([{ _id: `${KEY}/target`, rev: 3, snapshot: b64('old') }]);
    target.loseAnswer.replace_one = 'network error';
    expect(await store.save('target', bytes('new'), 3, 4)).toBe(true);
  });

  it('settles a first insert whose answer was lost by reading it back', async () => {
    const { store, target } = setup();
    target.loseAnswer.insert_one = 'network error';
    expect(await store.save('target', bytes('one'), null, 1)).toBe(true);
  });

  it('a failed compare-and-swap that left the old rev in place throws, rather than guessing', async () => {
    const { store, target } = setup([{ _id: `${KEY}/target`, rev: 3, snapshot: b64('old') }]);
    target.failNext.replace_one = 'HTTP 502';
    await expect(store.save('target', bytes('new'), 3, 4)).rejects.toThrow(/HTTP 502/);
  });

  it('a failed compare-and-swap after another run moved the rev answers false', async () => {
    const { store, target } = setup([{ _id: `${KEY}/target`, rev: 3, snapshot: b64('old') }]);
    target.failNext.replace_one = 'HTTP 502';
    target.docs[0].rev = 5;
    expect(await store.save('target', bytes('new'), 3, 4)).toBe(false);
  });

  it('refuses a snapshot over the 16 MiB document limit, naming its size, and writes nothing', async () => {
    const { store, target } = setup();
    expect(MAX_DOCUMENT_BYTES).toBe(16 * 1024 * 1024);
    const big = new Uint8Array(13 * 1024 * 1024);
    await expect(store.save('target', big, null, 1)).rejects.toThrow(
      /sync state of env 'target' is 17\.3 MiB in Data Storage, over its 16 MiB document limit/,
    );
    expect(target.calls).toEqual([]);
  });

  it('never logs a snapshot', async () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const err = vi.spyOn(console, 'error');
    const { store } = setup();
    await store.save('target', bytes('secret-ish'), null, 1);
    await store.load('target');
    expect([log, warn, err].every((s) => s.mock.calls.length === 0)).toBe(true);
  });
});
