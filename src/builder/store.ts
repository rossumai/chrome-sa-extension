// src/builder/store.ts
import { signal, computed } from '@preact/signals';
import { initHistory, type History } from './history.js';
import { changeSummary, rowStatus, type Node } from './model.js';

export const domain = signal('');
export const token = signal('');
export const connected = signal<boolean | null>(null); // null = not yet probed

// Raw API objects (untyped on the wire).
export const workspaces = signal<any[]>([]);
export const queues = signal<any[]>([]);
export const loading = signal(false);
export const error = signal<string | null>(null);
export const retryable = signal(false); // the last failure was a 429; the user retries

export const selectedQueueId = signal<number | null>(null);
export const schema = signal<any | null>(null); // the schema as last loaded or saved
export const base = signal<Node[]>([]);
export const history = signal<History<Node[]>>(initHistory([]));
export const selectedKey = signal<string | null>(null);
export const rowErrors = signal<Map<string, string[]>>(new Map());
export const generalErrors = signal<string[]>([]); // save errors not tied to a row
export const saving = signal(false);

export const work = computed(() => history.value.present);
export const status = computed(() => rowStatus(base.value, work.value));
export const summary = computed(() => changeSummary(base.value, work.value));
export const dirty = computed(() => {
  const s = summary.value;
  return s.added + s.edited + s.deleted + s.moved > 0;
});

export const selectedQueue = computed(
  () => queues.value.find((q) => q.id === selectedQueueId.value) || null,
);

// Queues that share the selected queue's schema: editing it changes all of them.
export const sharedCount = computed(() => {
  const q = selectedQueue.value;
  if (!q?.schema) return 0;
  return queues.value.filter((x) => x.schema === q.schema).length;
});
