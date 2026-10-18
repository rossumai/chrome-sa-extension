// src/builder/index.tsx
// Impure glue for the Builder: session probe, queue list, opening a queue's schema,
// the history actions the screen calls, and Save.
import * as api from './api.js';
import * as store from './store.js';
import { initHistory, push, undo, redo } from './history.js';
import { withKeys, type Node } from './model.js';
import { saveSchema, type SaveResult } from './save.js';
import { isRateLimited, rateLimitMessage } from '../net/rateLimit.js';

function fail(err: any, fallback: string) {
  store.error.value = isRateLimited(err) ? rateLimitMessage(err) : err?.message || fallback;
  store.retryable.value = isRateLimited(err);
}

let unloadGuard = false;

export async function initBuilder() {
  store.error.value = null;
  store.retryable.value = false;
  try {
    await api.whoami();
  } catch (err: any) {
    fail(err, 'Failed to verify session');
    store.connected.value = false;
    return;
  }
  store.connected.value = true;
  if (!unloadGuard) {
    unloadGuard = true;
    window.addEventListener('beforeunload', (e) => {
      if (store.dirty.value) e.preventDefault();
    });
  }
  loadQueues();
}

export async function loadQueues() {
  store.loading.value = true;
  store.error.value = null;
  store.retryable.value = false;
  try {
    const [ws, qs] = await Promise.all([api.listWorkspaces(), api.listQueues()]);
    store.workspaces.value = ws;
    store.queues.value = qs;
  } catch (err: any) {
    fail(err, 'Failed to load queues');
  } finally {
    store.loading.value = false;
  }
}

function idFromUrl(url: unknown): number | null {
  const m = /\/(\d+)\/?$/.exec(String(url || ''));
  return m ? Number(m[1]) : null;
}

function setBase(schema: any) {
  const keyed = withKeys(schema?.content || []);
  store.schema.value = schema;
  store.base.value = keyed;
  store.history.value = initHistory(keyed);
  store.rowErrors.value = new Map();
  store.generalErrors.value = [];
}

export async function openQueue(id: number) {
  if (store.dirty.value && !confirm('Discard the staged changes to this schema?')) return;
  store.selectedQueueId.value = id;
  store.selectedKey.value = null;
  store.schema.value = null;
  store.loading.value = true;
  store.error.value = null;
  store.retryable.value = false;
  try {
    const q = store.queues.value.find((x) => x.id === id);
    const schemaId = idFromUrl(q?.schema);
    if (schemaId == null) throw new Error('This queue has no schema');
    setBase(await api.getSchema(schemaId));
  } catch (err: any) {
    setBase(null);
    fail(err, 'Failed to load the schema');
  } finally {
    store.loading.value = false;
  }
}

/** One user action = one history entry. */
export function apply(next: Node[]) {
  if (next === store.work.value) return;
  store.history.value = push(store.history.value, next);
}

export function undoChange() {
  store.history.value = undo(store.history.value);
}

export function redoChange() {
  store.history.value = redo(store.history.value);
}

export function discard() {
  store.history.value = initHistory(store.base.value);
  store.rowErrors.value = new Map();
  store.generalErrors.value = [];
}

export async function save(force = false): Promise<SaveResult | null> {
  const schema = store.schema.value;
  if (!schema) return null;
  store.saving.value = true;
  store.error.value = null;
  store.retryable.value = false;
  try {
    const r = await saveSchema(
      {
        schemaId: schema.id,
        baseModifiedAt: schema.modified_at ?? null,
        work: store.work.value,
        force,
      },
      api,
    );
    const byRow = new Map<string, string[]>();
    const general: string[] = [];
    if (!r.ok) {
      for (const e of r.errors) {
        if (e.key) byRow.set(e.key, [...(byRow.get(e.key) || []), e.message]);
        else general.push(e.message);
      }
    } else {
      setBase(r.schema);
    }
    store.rowErrors.value = byRow;
    store.generalErrors.value = general;
    return r;
  } catch (err: any) {
    fail(err, 'Save failed');
    return null;
  } finally {
    store.saving.value = false;
  }
}
