// src/builder/model.ts
// Pure core of the Builder: a keyed working copy of a schema's `content` and the tree
// edits the screen makes on it. Every edit returns a new tree; inputs are never mutated.
//
// Each node carries an internal `__key` that survives an `id` rename, so row highlights,
// selection and restore follow the row. A deleted node stays in the tree as
// `__deleted: true` until Save, which is what lets the grid show it struck through.
// Both markers are stripped by `stripForSave` — the API silently drops unknown keys,
// so a leaked marker would not fail, it would just make the sent-vs-landed check noisy.

import { FIELD_RE } from './rules.js';

/** A schema node (raw API shape — untyped on the wire) plus the internal markers. */
export type Node = Record<string, any>;
export type Kind = 'section' | 'datapoint' | 'multivalue' | 'tuple';
export type Row = {
  key: string;
  kind: Kind;
  depth: number;
  node: Node;
  parentKey: string | null;
  deleted: boolean;
};

/** A multivalue's `children` is ONE object in the API; sections and tuples hold arrays. */
export function kids(n: Node): Node[] {
  const c = n.children;
  if (Array.isArray(c)) return c;
  return c && typeof c === 'object' ? [c] : [];
}

function withKids(n: Node, next: Node[]): Node {
  if (Array.isArray(n.children)) return { ...n, children: next };
  return { ...n, children: next[0] };
}

export function withKeys(content: any[]): Node[] {
  let i = 0;
  const walk = (n: Node): Node => {
    const out: Node = { ...n, __key: `k${++i}` };
    if (n.children !== undefined) {
      const ks = kids(n).map(walk);
      out.children = Array.isArray(n.children) ? ks : ks[0];
    }
    return out;
  };
  return content.map(walk);
}

export function cleanAttrs(node: Node): Node {
  if (node.category !== 'datapoint') return node;
  const src = node.ui_configuration?.type;
  // No Source set: leave the field exactly as loaded — an untouched row must not lose
  // a formula or prompt just because it never carried ui_configuration.
  if (src === undefined) return node;
  const out = { ...node };
  if (src !== 'formula') delete out.formula;
  if (src !== 'reasoning') {
    delete out.prompt;
    delete out.context;
  }
  return out;
}

export function stripForSave(nodes: Node[]): any[] {
  const walk = (n: Node): Node => {
    // __engine: a staged engine-field edit (see engine.ts), sent to /engine_fields, not here
    const { __key, __deleted, __engine, ...rest } = n;
    const out = cleanAttrs(rest);
    if (n.children !== undefined) {
      const ks = kids(n)
        .filter((c) => !c.__deleted)
        .map(walk);
      out.children = Array.isArray(n.children) ? ks : ks[0];
    }
    return out;
  };
  return nodes.filter((n) => !n.__deleted).map(walk);
}

export function flatten(nodes: Node[]): Row[] {
  const rows: Row[] = [];
  const walk = (n: Node, depth: number, parentKey: string | null, parentDeleted: boolean) => {
    const deleted = parentDeleted || !!n.__deleted;
    rows.push({ key: n.__key, kind: n.category, depth, node: n, parentKey, deleted });
    for (const c of kids(n)) walk(c, depth + 1, n.__key, deleted);
  };
  for (const n of nodes) walk(n, 0, null, false);
  return rows;
}

export function findByKey(nodes: Node[], key: string): Node | null {
  for (const n of nodes) {
    if (n.__key === key) return n;
    const hit = findByKey(kids(n), key);
    if (hit) return hit;
  }
  return null;
}

// Rebuild only the path to the node with `key`, replacing it with fn(node).
function update(nodes: Node[], key: string, fn: (n: Node) => Node): Node[] {
  let changed = false;
  const out = nodes.map((n) => {
    if (n.__key === key) {
      changed = true;
      return fn(n);
    }
    const ks = kids(n);
    if (!ks.length) return n;
    const next = update(ks, key, fn);
    if (next === ks) return n;
    changed = true;
    return withKids(n, next);
  });
  return changed ? out : nodes;
}

export function setAttr(nodes: Node[], key: string, path: string[], value: unknown): Node[] {
  const set = (obj: Node, i: number): Node => {
    const out = { ...obj };
    const k = path[i];
    if (i === path.length - 1) {
      if (value === undefined) delete out[k];
      else out[k] = value;
    } else {
      const cur = obj[k];
      out[k] = set(cur && typeof cur === 'object' ? cur : {}, i + 1);
    }
    return out;
  };
  return update(nodes, key, (n) => set(n, 0));
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base: Node, patch: Record<string, unknown>): Node {
  const out: Node = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (isPlain(v) && isPlain(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

/** Merge attribute changes into one node: objects merge, arrays replace, null deletes. */
export function mergeAttrs(nodes: Node[], key: string, patch: Record<string, unknown>): Node[] {
  return update(nodes, key, (n) => ({ ...deepMerge(n, patch), __key: n.__key }));
}

export function addField(nodes: Node[], parentKey: string, field: Node): Node[] {
  return update(nodes, parentKey, (p) => ({ ...p, children: [...kids(p), field] }));
}

export function addSection(nodes: Node[], section: Node): Node[] {
  return [...nodes, section];
}

export function setDeleted(nodes: Node[], key: string, deleted: boolean): Node[] {
  return update(nodes, key, (n) => {
    const out = { ...n };
    if (deleted) out.__deleted = true;
    else delete out.__deleted;
    return out;
  });
}

export function move(
  nodes: Node[],
  key: string,
  targetParentKey: string | null,
  index: number,
): Node[] {
  const node = findByKey(nodes, key);
  if (!node) return nodes;
  const remove = (list: Node[]): Node[] =>
    list
      .filter((n) => n.__key !== key)
      .map((n) => {
        const ks = kids(n);
        if (!ks.length) return n;
        const next = remove(ks);
        return next.length === ks.length && next.every((c, i) => c === ks[i])
          ? n
          : withKids(n, next);
      });
  const without = remove(nodes);
  const insert = (list: Node[]) => {
    const at = Math.max(0, Math.min(index, list.length));
    return [...list.slice(0, at), node, ...list.slice(at)];
  };
  if (targetParentKey === null) return insert(without);
  return update(without, targetParentKey, (p) => ({ ...p, children: insert(kids(p)) }));
}

/** A new schema's content: one empty section. */
export function emptySchemaContent(): any[] {
  return [
    { category: 'section', id: 'basic_info_section', label: 'Basic information', children: [] },
  ];
}

export function newDatapoint(key: string, id: string, label: string, type: string): Node {
  const n: Node = {
    __key: key,
    category: 'datapoint',
    id,
    label,
    type,
    rir_field_names: [],
    constraints: { required: false },
    hidden: false,
    can_export: true,
    ui_configuration: { type: 'manual', edit: 'enabled' },
  };
  if (type === 'enum') n.options = [];
  return n;
}

export function newSection(key: string, id: string, label: string): Node {
  return { __key: key, category: 'section', id, label, children: [] };
}

/** A list: a multivalue whose one child is a datapoint (e.g. several PO numbers). */
export function newList([mk, ck]: string[], id: string, label: string): Node {
  return {
    __key: mk,
    category: 'multivalue',
    id,
    label,
    children: newDatapoint(ck, `${id}_value`, label, 'string'),
  };
}

/** A table: a multivalue whose child is a tuple (the row) with one starter column. */
export function newTable([mk, tk, ck]: string[], id: string, label: string): Node {
  return {
    __key: mk,
    category: 'multivalue',
    id,
    label,
    children: {
      __key: tk,
      category: 'tuple',
      id: `${id}_row`,
      label: `${label} row`,
      children: [newDatapoint(ck, `${id}_column`, 'Column', 'string')],
    },
  };
}

/** `n` keys not used in the tree, for a node built with several keyed parts. */
export function freshKeys(nodes: Node[], n: number): string[] {
  const first = Number(nextKey(nodes).slice(1));
  return Array.from({ length: n }, (_, i) => `k${first + i}`);
}

export function nextKey(nodes: Node[]): string {
  let max = 0;
  for (const r of flatten(nodes)) {
    const m = /^k(\d+)$/.exec(r.key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `k${max + 1}`;
}

const FORMULA_MAX = 2000;

/** What Rossum refuses in a formula: over 2000 characters, or reading its own field `id`. */
export function formulaError(id: string, formula: unknown): string | null {
  if (typeof formula !== 'string') return null;
  if (formula.length > FORMULA_MAX) {
    return `The formula is ${formula.length} characters; the limit is ${FORMULA_MAX}`;
  }
  if ([...formula.matchAll(FIELD_RE)].some((m) => m[1] === id)) {
    return `The formula reads its own field (${id})`;
  }
  return null;
}

export function localErrors(nodes: Node[]): { key: string | null; message: string }[] {
  const live = flatten(nodes).filter((r) => !r.deleted);
  if (!live.some((r) => r.kind === 'section')) {
    return [{ key: null, message: 'The schema would be empty' }];
  }
  const errs: { key: string | null; message: string }[] = [];
  const byId = new Map<string, Row[]>();
  for (const r of live) {
    const id = String(r.node.id ?? '').trim();
    if (!id) {
      errs.push({ key: r.key, message: 'ID is empty' });
      continue;
    }
    // The formula Save would send (cleanAttrs drops it from a field whose source is not formula).
    const formula = r.kind === 'datapoint' ? formulaError(id, cleanAttrs(r.node).formula) : null;
    if (formula) errs.push({ key: r.key, message: formula });
    byId.set(id, [...(byId.get(id) || []), r]);
  }
  for (const [id, rows] of byId) {
    if (rows.length < 2) continue;
    for (const r of rows) errs.push({ key: r.key, message: `Duplicate ID "${id}"` });
  }
  return errs;
}

// A node's own attributes, without its children or the internal markers.
function ownAttrs(n: Node): string {
  const { children, __key, __deleted, ...rest } = n;
  return JSON.stringify(rest);
}

function parents(nodes: Node[]): Map<string, string | null> {
  return new Map(flatten(nodes).map((r) => [r.key, r.parentKey]));
}

// key -> index among the siblings that sit under the SAME parent in both trees.
// Counting only those means a field moved out of a section does not count its former
// neighbours as moved too.
function positions(nodes: Node[], stayers: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (list: Node[]) => {
    let i = 0;
    for (const n of list) {
      if (stayers.has(n.__key)) out.set(n.__key, i++);
      walk(kids(n));
    }
  };
  walk(nodes);
  return out;
}

export function rowStatus(base: Node[], work: Node[]): Map<string, 'new' | 'edited' | 'deleted'> {
  const baseRows = new Map(flatten(base).map((r) => [r.key, r]));
  const out = new Map<string, 'new' | 'edited' | 'deleted'>();
  for (const r of flatten(work)) {
    const b = baseRows.get(r.key);
    if (!b) out.set(r.key, 'new');
    else if (r.deleted && !b.deleted) out.set(r.key, 'deleted');
    else if (ownAttrs(r.node) !== ownAttrs(b.node)) out.set(r.key, 'edited');
  }
  return out;
}

/** Rows that moved: a different parent, or a new place among siblings that stayed put. */
export function movedKeys(base: Node[], work: Node[]): Set<string> {
  const out = new Set<string>();
  const bp = parents(base);
  const wp = parents(work);
  const stayers = new Set<string>();
  for (const [k, p] of wp) {
    if (!bp.has(k)) continue;
    if (bp.get(k) === p) stayers.add(k);
    else out.add(k);
  }
  const ib = positions(base, stayers);
  for (const [k, i] of positions(work, stayers)) if (ib.get(k) !== i) out.add(k);
  return out;
}

/** Counts from rowStatus and movedKeys, passed in so a caller computes each once. */
export function changeSummary(
  status: Map<string, 'new' | 'edited' | 'deleted'>,
  moved: Set<string>,
): { added: number; edited: number; deleted: number; moved: number } {
  const s = { added: 0, edited: 0, deleted: 0, moved: moved.size };
  for (const v of status.values()) {
    if (v === 'new') s.added++;
    else if (v === 'edited') s.edited++;
    else s.deleted++;
  }
  return s;
}

/** The change summary as one line ("2 edited · 1 new"), "renamed" first. */
export function summaryText(
  x: { added: number; edited: number; deleted: number; moved: number },
  renamed = false,
): string {
  return [
    renamed && 'renamed',
    x.edited && `${x.edited} edited`,
    x.added && `${x.added} new`,
    x.deleted && `${x.deleted} deleted`,
    x.moved && `${x.moved} moved`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Where a drag of `draggedKey` dropped on `targetKey` lands, or null when the drop is not
 * allowed. Sections reorder among sections; header fields and tables move within or across
 * sections; table columns move within or across tables. A deleted row is never a target —
 * a field dropped into a deleted section would vanish on Save with no Restore of its own.
 */
export function dropTarget(
  nodes: Node[],
  draggedKey: string,
  targetKey: string,
): { parent: string | null; index: number } | null {
  const rows = flatten(nodes);
  const tr = rows.find((r) => r.key === targetKey);
  const dr = rows.find((r) => r.key === draggedKey);
  if (!tr || !dr || tr.key === dr.key || tr.deleted || dr.deleted) return null;
  const indexIn = (parent: string | null, key: string) => {
    const list = parent === null ? nodes : kids(findByKey(nodes, parent)!);
    return list.findIndex((n) => n.__key === key);
  };
  if (dr.kind === 'section') {
    return tr.kind === 'section' ? { parent: null, index: indexIn(null, tr.key) } : null;
  }
  if (dr.depth === 1) {
    if (tr.kind === 'section') return { parent: tr.key, index: 0 };
    if (tr.depth === 1) return { parent: tr.parentKey, index: indexIn(tr.parentKey, tr.key) };
    return null;
  }
  if (dr.depth === 3) {
    if (tr.kind === 'tuple') return { parent: tr.key, index: 0 };
    if (tr.depth === 3) return { parent: tr.parentKey, index: indexIn(tr.parentKey, tr.key) };
  }
  return null;
}
