// src/builder/schemaAssist.ts
// Mr. Fabry for the whole schema: it proposes a LIST OF CHANGES (not a new schema — a 300-field
// schema would not fit in one reply, and a model rewriting it can silently drop fields).
// applyChanges applies what it can, in order, and says why it skipped the rest; the caller
// turns the result into one undoable edit and validates it. Pure.
import {
  flatten,
  findByKey,
  addField,
  addSection,
  setDeleted,
  move,
  mergeAttrs,
  newDatapoint,
  newList,
  newTable,
  newSection,
  nextKey,
  freshKeys,
  kids,
  type Node,
  type Row,
} from './model.js';
import { parseReplyObject, NEVER_SET } from './assist.js';
import { MAX_PROMPT } from '../inspector/promptBudget.js';
import type { RowError } from './save.js';

// ---- What Mr. Fabry sees --------------------------------------------------------------

function fieldEntry(n: Node): Record<string, unknown> {
  const e: Record<string, unknown> = { id: n.id, label: n.label ?? '', type: n.type ?? 'string' };
  const src = n.ui_configuration?.type;
  if (src) e.source = src;
  if (n.constraints?.required) e.required = true;
  if (n.hidden) e.hidden = true;
  if (n.can_export === false) e.export = false;
  if (typeof n.formula === 'string' && n.formula) e.formula = n.formula;
  return e;
}

/** The schema as it is now (staged edits included), compact: sections, fields, tables. */
export function compactSchema(nodes: Node[]): any[] {
  const live = (list: Node[]) => list.filter((n) => !n.__deleted);
  return live(nodes).map((sec) => ({
    section: sec.id,
    label: sec.label ?? '',
    fields: live(kids(sec)).map((n) => {
      if (n.category !== 'multivalue') return fieldEntry(n);
      const child = kids(n)[0];
      if (child?.category === 'tuple') {
        return {
          table: n.id,
          label: n.label ?? '',
          row: child.id,
          columns: live(kids(child)).map(fieldEntry),
        };
      }
      return { list: n.id, label: n.label ?? '', value: child ? fieldEntry(child) : null };
    }),
  }));
}

const CONTRACT = [
  'You change a Rossum schema. Do not create or change anything in Rossum — only propose.',
  'Reply with exactly one ```json block: {"summary": "<one or two sentences>", "changes": [...]}.',
  'Each change is one of:',
  '- {"op": "set", "id": "<field id>", "attrs": {...}}: attributes to change (null removes one).',
  '  Never "category" or "children". Renaming = {"attrs": {"id": "<new id>"}}.',
  '- {"op": "add", "kind": "field" | "list" | "table", "parent": "<section id, or a table ROW id for a',
  '  column>", "after": "<sibling id, optional>", "field": {"id", "label", "type", ...attributes}}.',
  '- {"op": "add_section", "id", "label", "after": "<section id, optional>"}.',
  '- {"op": "delete", "id": "<id>"}.',
  '- {"op": "move", "id": "<id>", "parent": "<section or table row id>", "after": "<sibling id, optional>"}.',
  'Field ids are unique across the whole schema. A formula field has "ui_configuration":',
  '{"type": "formula"} and a "formula" (TxScript, last expression is the value, max 2000 characters,',
  'never reading its own field). Make only the changes the request needs.',
].join('\n');

export function buildSchemaPrompt({ request, schema }: { request: string; schema: any[] }): string {
  return [CONTRACT, `The schema now:\n${JSON.stringify(schema)}`, `Request: ${request}`].join(
    '\n\n',
  );
}

/** A follow-up in the same chat, with the schema as it is now (edits since included). */
export function buildSchemaFollowup(request: string, schema: any[]): string {
  return [
    `The schema now (the user may have edited it):\n${JSON.stringify(schema)}`,
    `Request: ${request}`,
    'Reply again with one ```json block {"summary", "changes"}.',
  ].join('\n\n');
}

export function buildFixPrompt(problems: string[], schema: any[]): string {
  return [
    `Your changes were applied, but these problems remain:\n${problems.map((p) => `- ${p}`).join('\n')}`,
    `The schema now:\n${JSON.stringify(schema)}`,
    'Reply with one ```json block {"summary", "changes"} that fixes them.',
  ].join('\n\n');
}

// The agent's /messages endpoint rejects content over 50000 characters (see
// src/inspector/promptBudget.ts, which measured it). A big schema degrades in steps.

function withoutFormulas(schema: any[]): any[] {
  const strip = (f: any) =>
    f && typeof f.formula === 'string'
      ? { ...f, formula: `(formula of ${f.formula.length} characters, not shown)` }
      : f;
  return schema.map((sec) => ({
    ...sec,
    fields: sec.fields.map((f: any) =>
      f.columns
        ? { ...f, columns: f.columns.map(strip) }
        : f.value
          ? { ...f, value: strip(f.value) }
          : strip(f),
    ),
  }));
}

export type Fitted =
  { ok: true; prompt: string; note: string | null } | { ok: false; error: string };

/** The prompt for `schema`, or a smaller one without formula bodies, or a clear refusal. */
export function fitSchema(schema: any[], build: (schema: any[]) => string): Fitted {
  const full = build(schema);
  if (full.length <= MAX_PROMPT) return { ok: true, prompt: full, note: null };
  const lean = build(withoutFormulas(schema));
  if (lean.length <= MAX_PROMPT) {
    return {
      ok: true,
      prompt: lean,
      note: 'The schema is large, so formulas were left out of what Mr. Fabry saw.',
    };
  }
  return {
    ok: false,
    error: `This schema is too large to send to Mr. Fabry in one message (${lean.length} characters; the limit is ${MAX_PROMPT}).`,
  };
}

// ---- What Mr. Fabry returns -----------------------------------------------------------

export type SchemaChange = Record<string, any>;
export type ParsedChanges =
  { ok: true; summary: string; changes: SchemaChange[] } | { ok: false; error: string };

export function parseSchemaReply(text: string): ParsedChanges {
  const none = 'Mr. Fabry did not return a list of changes';
  const r = parseReplyObject(text, {
    none,
    invalid: 'Mr. Fabry returned changes that are not valid JSON',
  });
  if (!r.ok) return r;
  const obj = r.value;
  if (!Array.isArray(obj.changes)) return { ok: false, error: none };
  return {
    ok: true,
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    changes: obj.changes.filter((c: unknown) => c && typeof c === 'object'),
  };
}

// ---- Applying ------------------------------------------------------------------------

export type ApplyResult = {
  nodes: Node[];
  applied: number;
  skipped: { change: SchemaChange; reason: string }[];
};

function clean(attrs: unknown, drop: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs))
      if (!NEVER_SET.includes(k) && !drop.includes(k)) out[k] = v;
  }
  return out;
}

function liveRow(nodes: Node[], id: unknown): Row | undefined {
  return flatten(nodes).find((r) => !r.deleted && String(r.node.id) === String(id));
}

function indexAfter(list: Node[], afterId: unknown): number {
  const i = list.findIndex((n) => !n.__deleted && String(n.id) === String(afterId));
  return i < 0 ? list.length : i + 1;
}

// One change → the next tree, or the reason it cannot be applied.
function applyOne(nodes: Node[], c: SchemaChange): Node[] | string {
  const used = (id: unknown) => !!liveRow(nodes, id);
  switch (c.op) {
    case 'set': {
      const row = liveRow(nodes, c.id);
      if (!row) return `No field with ID ${c.id}`;
      const attrs = clean(c.attrs);
      if (!Object.keys(attrs).length) return `Nothing to set on ${c.id}`;
      if (typeof attrs.id === 'string' && attrs.id !== c.id && used(attrs.id)) {
        return `The ID ${attrs.id} is already used`;
      }
      return mergeAttrs(nodes, row.key, attrs);
    }
    case 'add': {
      const parent = liveRow(nodes, c.parent);
      if (!parent || (parent.kind !== 'section' && parent.kind !== 'tuple')) {
        return `No section or table row with ID ${c.parent}`;
      }
      const f = c.field || {};
      if (!f.id) return 'The new field has no ID';
      if (used(f.id)) return `The ID ${f.id} is already used`;
      const kind = c.kind || 'field';
      if (kind !== 'field' && parent.kind === 'tuple') return 'A table row can only hold fields';
      let node: Node;
      if (kind === 'table') node = newTable(freshKeys(nodes, 3), f.id, f.label ?? f.id);
      else if (kind === 'list') node = newList(freshKeys(nodes, 2), f.id, f.label ?? f.id);
      else if (kind === 'field')
        node = newDatapoint(nextKey(nodes), f.id, f.label ?? f.id, f.type ?? 'string');
      else return `Unknown kind "${kind}"`;
      let next = addField(nodes, parent.key, node);
      if (kind === 'field') {
        const extra = clean(f, ['id', 'label', 'type']);
        if (Object.keys(extra).length) next = mergeAttrs(next, node.__key, extra);
      }
      if (c.after != null) {
        const siblings = kids(findByKey(nodes, parent.key)!);
        next = move(next, node.__key, parent.key, indexAfter(siblings, c.after));
      }
      return next;
    }
    case 'add_section': {
      if (!c.id) return 'The new section has no ID';
      if (used(c.id)) return `The ID ${c.id} is already used`;
      const sec = newSection(nextKey(nodes), c.id, c.label ?? c.id);
      let next = addSection(nodes, sec);
      if (c.after != null) next = move(next, sec.__key, null, indexAfter(nodes, c.after));
      return next;
    }
    case 'delete': {
      const row = liveRow(nodes, c.id);
      if (!row) return `No field with ID ${c.id}`;
      return setDeleted(nodes, row.key, true);
    }
    case 'move': {
      const row = liveRow(nodes, c.id);
      if (!row) return `No field with ID ${c.id}`;
      if (row.kind === 'section') {
        if (c.parent) return 'A section can only move among sections';
        const without = nodes.filter((n) => n.__key !== row.key);
        return move(
          nodes,
          row.key,
          null,
          c.after != null ? indexAfter(without, c.after) : without.length,
        );
      }
      const parent =
        c.parent != null
          ? liveRow(nodes, c.parent)
          : liveRow(nodes, findByKey(nodes, row.parentKey!)?.id);
      const fits =
        parent &&
        (parent.kind === 'section'
          ? row.kind !== 'tuple'
          : parent.kind === 'tuple' && row.kind === 'datapoint');
      if (!parent || !fits) return `Cannot move ${c.id} into ${c.parent}`;
      const siblings = kids(findByKey(nodes, parent.key)!).filter((n) => n.__key !== row.key);
      return move(
        nodes,
        row.key,
        parent.key,
        c.after != null ? indexAfter(siblings, c.after) : siblings.length,
      );
    }
    default:
      return `Unknown change "${c.op}"`;
  }
}

/**
 * What is still wrong after an answer, for the chat and for "fix": the skipped changes, a
 * validate that could not run, then each error (on a row: `<field id>: message`).
 */
export function problemList(
  r: ApplyResult,
  unvalidated: string | null,
  errors: RowError[],
): string[] {
  const idOf = new Map(flatten(r.nodes).map((x) => [x.key, String(x.node.id)]));
  return [
    ...r.skipped.map((x) => `Skipped: ${x.reason}`),
    ...(unvalidated ? [unvalidated] : []),
    ...errors.map((e) => (e.key ? `${idOf.get(e.key)}: ${e.message}` : e.message)),
  ];
}

/** Apply every change that can be applied, in order; the rest come back with a reason. */
export function applyChanges(nodes: Node[], changes: SchemaChange[]): ApplyResult {
  let cur = nodes;
  let applied = 0;
  const skipped: ApplyResult['skipped'] = [];
  for (const c of changes) {
    const r = applyOne(cur, c);
    if (typeof r === 'string') skipped.push({ change: c, reason: r });
    else {
      cur = r;
      applied++;
    }
  }
  return { nodes: cur, applied, skipped };
}
