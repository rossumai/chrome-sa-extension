// rdc's state store for the browser, over Data Storage: one document per env, in that env's own
// org, `{ _id: '<key>/<env>', rev, snapshot: <base64> }` in `_SA_EXTENSION__rdc_state`. rdc hands
// the page an opaque snapshot and a compare-and-swap on `rev`; the page never reads the snapshot
// and never logs it. A load is one find by `_id`; a save is one write: `insert_one` for the first
// (a duplicate `_id` means another run won), else `replace_one` filtered on the expected rev.
import type { StateStore } from './wasm.js';
import type { DataStorage } from './sourceStore.js';

// MongoDB's document limit, which Data Storage keeps.
export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
// Room for `_id`, `rev` and the BSON framing around the snapshot.
const OVERHEAD_BYTES = 4 * 1024;

const mib = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MiB`;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// `orgs` maps each env to its own org's Data Storage, bound to the state collection.
export function dataStorageStateStore(orgs: Record<string, DataStorage>, key: string): StateStore {
  const dsOf = (env: string) => {
    const ds = orgs[env];
    if (!ds) throw new Error(`The rdc state store has no org for env '${env}'.`);
    return ds;
  };
  const idOf = (env: string) => `${key}/${env}`;
  const find = async (env: string) => {
    const found = await dsOf(env)('find', { query: { _id: idOf(env) }, limit: 1 });
    return Array.isArray(found)
      ? ((found[0] as Record<string, unknown> | undefined) ?? null)
      : null;
  };
  // A manifest of the earlier blob format: no snapshot, its files listed instead.
  const isOld = (d: Record<string, unknown>) => typeof d.snapshot !== 'string';

  const save = async (
    env: string,
    snapshot: Uint8Array,
    expectedRev: number | null,
    nextRev: number,
  ) => {
    const ds = dsOf(env);
    const _id = idOf(env);
    const doc = { _id, rev: nextRev, snapshot: toBase64(snapshot) };
    const size = doc.snapshot.length + OVERHEAD_BYTES;
    if (size > MAX_DOCUMENT_BYTES)
      throw new Error(
        `The sync state of env '${env}' is ${mib(size)} in Data Storage, over its 16 MiB document limit.`,
      );
    // A write that failed, or whose answer was lost, is settled by reading the document back:
    // ours there means it landed; a rev other than the expected one means another run moved it;
    // anything else is the write's own failure.
    const settle = async (e: unknown) => {
      let there: Record<string, unknown> | null;
      try {
        there = await find(env);
      } catch {
        throw e;
      }
      if (there && there.rev === doc.rev && there.snapshot === doc.snapshot) return true;
      const storedRev = there && !isOld(there) ? there.rev : null;
      if (storedRev !== expectedRev) return false;
      throw e;
    };
    if (expectedRev !== null) {
      let out: { matched_count?: number } | undefined;
      try {
        out = (await ds('replace_one', {
          filter: { _id, rev: expectedRev },
          replacement: doc,
        })) as { matched_count?: number } | undefined;
      } catch (e) {
        return settle(e);
      }
      return out?.matched_count === 1;
    }
    try {
      await ds('insert_one', { document: doc });
      return true;
    } catch (e) {
      const there = await find(env);
      if (!there || !isOld(there)) return settle(e);
      // The earlier blob format: replace its manifest, then drop its blobs, which nothing reads.
      const out = (await ds('replace_one', {
        filter: { _id, snapshot: { $exists: false } },
        replacement: doc,
      })) as { matched_count?: number } | undefined;
      if (out?.matched_count !== 1) return false;
      await ds('delete_many', { filter: { _id: { $regex: `^${escapeRegex(_id)}/blob/` } } });
      return true;
    }
  };

  return {
    async load(env) {
      try {
        const d = await find(env);
        if (!d || isOld(d) || typeof d.rev !== 'number') return null;
        return { rev: d.rev, snapshot: fromBase64(d.snapshot as string) };
      } catch (e) {
        throw new Error(
          `loading the sync state of env '${env}' from Data Storage: ${(e as Error)?.message ?? e}`,
        );
      }
    },
    async save(env, snapshot, expectedRev, nextRev) {
      try {
        return await save(env, snapshot, expectedRev, nextRev);
      } catch (e) {
        const m = (e as Error)?.message ?? String(e);
        if (m.startsWith('The sync state of env')) throw e;
        throw new Error(`saving the sync state of env '${env}' to Data Storage: ${m}`);
      }
    },
  };
}
