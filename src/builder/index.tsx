// src/builder/index.tsx
// Impure glue for the Builder: session probe, queue list, opening a queue's schema,
// the history actions the screen calls, and Save.
import * as api from './api.js';
import * as store from './store.js';
import { initHistory, push, undo, redo } from './history.js';
import { withKeys, type Node } from './model.js';
import { saveSchema, type SaveResult } from './save.js';
import { isRateLimited, rateLimitMessage } from '../net/rateLimit.js';
import { annotationIdFromInput } from '../rossum/annotationUrl.js';
import { annotationValues } from './values.js';

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

// Bumped on every openQueue: a response for a queue that is no longer the current one is
// dropped, or queue A's schema would show (and save) under queue B.
let openSeq = 0;

export async function openQueue(id: number) {
  if (store.dirty.value && !confirm('Discard the staged changes to this schema?')) return;
  const seq = ++openSeq;
  store.selectedQueueId.value = id;
  clearAnnotation();
  store.annotations.value = [];
  store.selectedKey.value = null;
  store.schema.value = null;
  store.loading.value = true;
  store.error.value = null;
  store.retryable.value = false;
  try {
    const q = store.queues.value.find((x) => x.id === id);
    const schemaId = idFromUrl(q?.schema);
    if (schemaId == null) throw new Error('This queue has no schema');
    const schema = await api.getSchema(schemaId);
    if (seq !== openSeq) return;
    setBase(schema);
    loadAnnotations(id);
  } catch (err: any) {
    if (seq !== openSeq) return;
    setBase(null);
    fail(err, 'Failed to load the schema');
  } finally {
    if (seq === openSeq) store.loading.value = false;
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
      if (r.warnings.length) general.push(`Did not land as sent: ${r.warnings.join(', ')}`);
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

function annotationLabel(a: any, docs: Map<string, any>): string {
  const name = docs.get(a.document)?.original_file_name;
  return `${a.id}${name ? ` · ${name}` : ''} · ${a.status}`;
}

// Fills the picker. A failure leaves it empty; pasting an ID still works.
async function loadAnnotations(queueId: number) {
  try {
    const page = await api.listAnnotations(queueId);
    if (store.selectedQueueId.value !== queueId) return;
    const docs = new Map<string, any>((page?.documents || []).map((d: any) => [d.url, d]));
    store.annotations.value = (page?.results || []).map((a: any) => ({
      id: a.id,
      label: annotationLabel(a, docs),
    }));
  } catch {
    store.annotations.value = [];
  }
}

let pickSeq = 0;

export function clearAnnotation() {
  pickSeq++;
  store.annotationId.value = null;
  store.values.value = null;
  store.lineRow.value = {};
  store.annotationError.value = null;
}

/** Accepts an annotation id, a Rossum annotation/document URL, or an API URL. */
export async function pickAnnotation(input: string) {
  const raw = annotationIdFromInput(input);
  if (!raw) {
    store.annotationError.value = 'Not an annotation ID or URL';
    return;
  }
  const id = Number(raw);
  const seq = ++pickSeq;
  store.annotationId.value = id;
  store.annotationError.value = null;
  store.lineRow.value = {};
  try {
    const data = await api.getAnnotationContent(id);
    if (seq !== pickSeq) return;
    store.values.value = annotationValues(data?.content || []);
  } catch (err: any) {
    if (seq !== pickSeq) return;
    store.values.value = null;
    store.annotationError.value = isRateLimited(err)
      ? rateLimitMessage(err)
      : err?.message || 'Failed to load the annotation';
  }
}
