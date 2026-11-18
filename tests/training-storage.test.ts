import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PROGRESS_KEY,
  MAX_ORGS,
  pruneOrgs,
  readProgress,
  writeProgress,
  clearProgress,
} from '../src/training/storage.js';
import { track, mission, task } from './support/training.js';

const TRACK = track({
  id: 't',
  version: 2,
  missions: [mission({ id: 'm1', tasks: [task({ id: 'm1.s1' })] })],
});
let state: any;
let listeners: any;

beforeEach(() => {
  state = {};
  listeners = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          const wanted = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of wanted) if (k in state) (out as any)[k] = state[k];
          return out;
        }),
        set: vi.fn(async (obj) => {
          Object.assign(state, obj);
        }),
      },
      onChanged: {
        addListener: vi.fn((fn) => listeners.push(fn)),
        removeListener: vi.fn((fn) => {
          listeners = listeners.filter((l: any) => l !== fn);
        }),
      },
    } as any,
  } as any;
});

describe('pruneOrgs', () => {
  it('keeps the newest MAX_ORGS entries and always the active one', () => {
    const all = {
      a: { startedAt: 1 },
      b: { startedAt: 2 },
      c: { startedAt: 3 },
      d: { startedAt: 4 },
    };
    const kept = pruneOrgs(all, 'a', 3);
    expect(Object.keys(kept).sort()).toEqual(['a', 'c', 'd']);
  });

  it('is a no-op below the cap', () => {
    const all = { a: { startedAt: 1 } };
    expect(pruneOrgs(all, 'a', MAX_ORGS)).toEqual(all);
  });

  // Pinning current (documented, not desired) behaviour: the "always included"
  // guarantee only holds when keepOrigin is already a key of `all`. It is
  // unreachable via writeProgress (which always merges the origin in first),
  // but pruneOrgs is exported, so this is here to make the precondition an
  // explicit, tested fact rather than something a future caller discovers the
  // hard way.
  it('below the cap, a keepOrigin absent from all is NOT added (early-return fails open)', () => {
    const all = { a: { startedAt: 1 } };
    const kept = pruneOrgs(all, 'missing', MAX_ORGS);
    expect(kept).toBe(all); // identity: the early return hands back `all` untouched
    expect(kept.missing).toBeUndefined();
  });

  it('over the cap, a keepOrigin absent from all is NOT added, and the reserved slot is simply wasted (prune branch fails open)', () => {
    const all = {
      a: { startedAt: 1 },
      b: { startedAt: 2 },
      c: { startedAt: 3 },
      d: { startedAt: 4 },
    };
    const kept = pruneOrgs(all, 'missing', 3);
    // `max - 1` (2) newest real entries are kept, reserving a 3rd slot for
    // 'missing' — which is never in `all` to begin with, so the output ends up
    // ONE ENTRY SHORT of the cap instead of containing 'missing'.
    expect(Object.keys(kept).sort()).toEqual(['c', 'd']);
    expect(kept.missing).toBeUndefined();
  });

  // I5. `startedAt` is set once at track start and never updated, so the oldest
  // record is simply the one started first — which says nothing about whether
  // the trainee still needs it. The record also holds the ONLY copy of an
  // issued receipt unless they already pasted it somewhere.
  it('never evicts a record carrying an issued receipt', () => {
    const all = {
      a: { startedAt: 1, receipt: { text: 'ROSSUM PARTNER ONBOARDING…' } },
      b: { startedAt: 2 },
      c: { startedAt: 3 },
      d: { startedAt: 4 },
    };
    const kept = pruneOrgs(all, 'd', 3);
    expect(kept.a).toBe(all.a); // oldest by startedAt, kept anyway
    expect(kept.d).toBe(all.d); // active origin, always kept
    expect(kept.b).toBeUndefined(); // receiptless and oldest of the rest
  });

  it('keeps every receipt even when that exceeds the cap — the cap is soft on purpose', () => {
    const withReceipt = (n: any) => ({ startedAt: n, receipt: { text: 'r' } });
    const all = { a: withReceipt(1), b: withReceipt(2), c: withReceipt(3), d: { startedAt: 4 } };
    const kept = pruneOrgs(all, 'd', 2);
    expect(Object.keys(kept).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('readProgress / writeProgress', () => {
  it('returns null when the org has no progress', async () => {
    expect(await readProgress('https://x.rossum.app', TRACK)).toBe(null);
  });

  it('round-trips progress for one org', async () => {
    await writeProgress('https://x.rossum.app', {
      trackId: 't',
      trackVersion: 2,
      startedAt: 0,
      run: 'tug-42',
      results: {},
      build: {},
    });
    const got = await readProgress('https://x.rossum.app', TRACK);
    expect(got!.trackId).toBe('t');
    expect(state[PROGRESS_KEY]['https://x.rossum.app']).toBeTruthy();
  });

  it('migrates on read when the stored track version is older', async () => {
    state[PROGRESS_KEY] = {
      'https://x.rossum.app': {
        trackId: 't',
        trackVersion: 1,
        run: 'tug-42',
        results: {
          GONE: { at: 1, assertions: [{ id: 'a', label: 'a', state: 'ok' }] },
          'm1.s1': { at: 1, assertions: [{ id: 'a', label: 'a', state: 'ok' }] },
        },
        build: {},
      },
    };
    const got = (await readProgress('https://x.rossum.app', TRACK))!;
    expect(got.trackVersion).toBe(2);
    expect(got.results.GONE).toBeUndefined();
    expect(got.results['m1.s1']).toBeTruthy();
  });

  it('reads another track as no progress at all', async () => {
    state[PROGRESS_KEY] = { 'https://x.rossum.app': { trackId: 'other', trackVersion: 2 } };
    expect(await readProgress('https://x.rossum.app', TRACK)).toBeNull();
  });

  it('keeps other orgs untouched on write', async () => {
    state[PROGRESS_KEY] = { 'https://a.rossum.app': { trackId: 't', startedAt: 1 } };
    await writeProgress('https://b.rossum.app', {
      trackId: 't',
      trackVersion: 1,
      startedAt: 2,
      run: 'tug-43',
      results: {},
      build: {},
    });
    expect(Object.keys(state[PROGRESS_KEY]).sort()).toEqual([
      'https://a.rossum.app',
      'https://b.rossum.app',
    ]);
  });

  it('clearProgress removes only the given org', async () => {
    state[PROGRESS_KEY] = { a: { startedAt: 1 }, b: { startedAt: 2 } };
    await clearProgress('a');
    expect(Object.keys(state[PROGRESS_KEY])).toEqual(['b']);
  });
});
