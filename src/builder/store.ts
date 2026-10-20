// src/builder/store.ts
import { signal, computed } from '@preact/signals';
import { initHistory, type History } from './history.js';
import { changeSummary, rowStatus, type Node } from './model.js';
import type { AnnotationValues } from './values.js';
import {
  ruleFieldRefs,
  ruleRoles,
  rulesByField,
  fieldActionMarks,
  globalActionMarks,
} from './rules.js';
import { sameDraft, type RuleDraft } from './ruleDraft.js';

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
// The open schema: the selected queue's, or one opened directly because no queue uses it.
export const selectedSchemaId = signal<number | null>(null);
export const schema = signal<any | null>(null); // the schema as last loaded or saved
export const base = signal<Node[]>([]);
// One undo stack for everything staged: the schema's name and its content.
export type Draft = { name: string; content: Node[] };
export const baseName = signal('');
export const history = signal<History<Draft>>(initHistory({ name: '', content: [] }));
// Every schema in the org, names only (the list call returns full objects; content is dropped).
export const schemas = signal<{ id: number; url: string; name: string }[]>([]);
export const selectedKey = signal<string | null>(null);
// The grid's id/label filter (see fieldFilter.ts); '' shows every row.
export const fieldFilter = signal('');
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

// The URL of the open schema, from the loaded schema or else from the selected queue.
const openSchemaUrl = computed(() => schema.value?.url ?? selectedQueue.value?.schema ?? null);

// Queues that use the open schema: editing it changes all of them.
export const sharedQueueIds = computed(() => {
  const url = openSchemaUrl.value;
  return new Set(url ? queues.value.filter((q) => q.schema === url).map((q) => q.id) : []);
});
export const sharedCount = computed(() => sharedQueueIds.value.size);

/** Make (name, content) the saved state and clear the undo stack. */
export function startDraft(name: string, content: Node[]) {
  base.value = content;
  baseName.value = name;
  history.value = initHistory({ name, content });
}

// Native Rules of the selected queue, and the one picked to highlight its fields.
export const rules = signal<any[]>([]);
export const ruleId = signal<number | null>(null);
export const pickedRule = computed(() => rules.value.find((r) => r.id === ruleId.value) || null);
// Rule mode: the right panel edits one rule (ruleId null = a new one).
export type RuleEditorState = {
  ruleId: number | null;
  base: RuleDraft;
  draft: RuleDraft;
  /** The field a new rule was started from (its Rules-column +), for Mr. Fabry's prompt. */
  fromField?: string | null;
};
export const ruleEditor = signal<RuleEditorState | null>(null);
export const ruleDirty = computed(() =>
  ruleEditor.value ? !sameDraft(ruleEditor.value.base, ruleEditor.value.draft) : false,
);
export const ruleErrors = signal<string[]>([]);
export const ruleSaving = signal(false);

// The fields to highlight: the rule being edited (live, as it is typed), else the picked one.
export const ruleRefs = computed(() =>
  ruleEditor.value
    ? ruleFieldRefs(ruleEditor.value.draft)
    : pickedRule.value
      ? ruleFieldRefs(pickedRule.value)
      : null,
);
export const ruleRoleById = computed(() => (ruleRefs.value ? ruleRoles(ruleRefs.value) : null));

// Every queue rule that uses each field, for the grid's Rules column.
export const fieldRules = computed(() => rulesByField(rules.value));

// Rule mode filters the grid to the open rule's fields (live, as the condition is typed);
// the text filter then ADDS matches, so a new field can be found and clicked in.
export const ruleFilterIds = computed(() => {
  if (!ruleEditor.value) return null;
  const r = ruleFieldRefs(ruleEditor.value.draft);
  return new Set([...r.condition, ...r.actions]);
});

// The open rule's actions per field, for the grid's icons.
export const ruleMarks = computed(() =>
  ruleEditor.value ? fieldActionMarks(ruleEditor.value.draft) : null,
);

// The open rule's actions that anchor on no field (document messages and blockers, emails…).
export const ruleGlobalMarks = computed(() =>
  ruleEditor.value ? globalActionMarks(ruleEditor.value.draft) : null,
);

// In rule mode the schema is read-only: one thing is edited at a time.
export const schemaLocked = computed(() => !!ruleEditor.value);

// Mr. Fabry in the rule editor: one read-only chat per opened rule. assistRev bumps when a
// proposal (or Discard) replaces the draft from outside, so the condition editor reloads.
export type AssistState = {
  chatId: string | null;
  busy: boolean;
  error: string | null;
  reply: string | null; // the raw reply, shown when it held no usable rule
  warnings: string[];
};
export const assist = signal<AssistState>({
  chatId: null,
  busy: false,
  error: null,
  reply: null,
  warnings: [],
});
export const assistRev = signal(0);
