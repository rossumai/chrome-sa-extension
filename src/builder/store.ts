// src/builder/store.ts
import { signal, computed } from '@preact/signals';
import { initHistory, type History } from './history.js';
import { changeSummary, rowStatus, type Node } from './model.js';
import type { AnnotationValues } from './values.js';

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
// One undo stack for everything staged: the schema's name and its content.
export type Draft = { name: string; content: Node[] };
export const baseName = signal('');
export const history = signal<History<Draft>>(initHistory({ name: '', content: [] }));
// Every schema in the org, names only (the list call returns full objects; content is dropped).
export const schemas = signal<{ id: number; url: string; name: string }[]>([]);
export const selectedKey = signal<string | null>(null);
export const rowErrors = signal<Map<string, string[]>>(new Map());
export const generalErrors = signal<string[]>([]); // save errors not tied to a row
export const saving = signal(false);

// The annotation whose values the grid shows next to each field (read-only).
export const annotations = signal<{ id: number; label: string }[]>([]);
export const annotationId = signal<number | null>(null);
export const values = signal<AnnotationValues | null>(null);
export const annotationError = signal<string | null>(null);
// Which table row the Value column shows, per table (multivalue) schema id; 0-based.
export const lineRow = signal<Record<string, number>>({});

export const work = computed(() => history.value.present.content);
export const draftName = computed(() => history.value.present.name);
export const renamed = computed(() => draftName.value !== baseName.value);
export const status = computed(() => rowStatus(base.value, work.value));
export const summary = computed(() => changeSummary(base.value, work.value));
export const dirty = computed(() => {
  const s = summary.value;
  return renamed.value || s.added + s.edited + s.deleted + s.moved > 0;
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

/** Make (name, content) the saved state and clear the undo stack. */
export function startDraft(name: string, content: Node[]) {
  base.value = content;
  baseName.value = name;
  history.value = initHistory({ name, content });
}
