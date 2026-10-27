// src/builder/engine.ts
// A queue's extraction engine, as the Builder shows and stages it. Exactly one of the queue's
// `engine` (custom), `dedicated_engine` or `generic_engine` is set (rossum-reference →
// Extraction Engines). On a custom engine every extracted datapoint needs an engine field
// whose `name` equals the datapoint id, its `rir_field_names` must be empty and it must not
// have `disable_prediction: true`. On the generic engine `rir_field_names` picks the field.
//
// Staged engine-field edits live on the schema node as `__engine` (stripped on save), so
// undo, redo and the row's "edited" mark cover them like any other edit.

import { flatten, kids, type Node } from './model.js';

export type EngineKind = 'custom' | 'generic' | 'dedicated' | 'none';

/** The engine side of a datapoint: the catalog seed picked for it, if any. */
export type EngineStage = { pre_trained_field_id?: string | null };

/** Sources that are not extracted, so need no engine field. */
const NOT_EXTRACTED = ['formula', 'data', 'manual', 'reasoning'];

export function engineKind(queue: any): EngineKind {
  if (queue?.engine) return 'custom';
  if (queue?.dedicated_engine) return 'dedicated';
  if (queue?.generic_engine) return 'generic';
  return 'none';
}

/** Live datapoints the engine extracts into, with whether each is a table column. */
export function extractedFields(nodes: Node[]): { node: Node; tabular: boolean }[] {
  const out: { node: Node; tabular: boolean }[] = [];
  const walk = (list: Node[], tabular: boolean) => {
    for (const n of list) {
      if (n.__deleted) continue;
      if (n.category === 'datapoint') {
        if (isExtracted(n)) out.push({ node: n, tabular });
        continue;
      }
      walk(kids(n), tabular || n.category === 'multivalue');
    }
  };
  walk(nodes, false);
  return out;
}

// Buttons hold no extracted value (not verified against the API).
export function isExtracted(node: Node): boolean {
  return (
    node.category === 'datapoint' &&
    !NOT_EXTRACTED.includes(node.ui_configuration?.type) &&
    node.type !== 'button'
  );
}

/** Shown to explain the "!" on a captured field that is hidden. */
export const HIDDEN_CAPTURED =
  'Captured but hidden: nobody sees or corrects its prediction, yet confirmed documents still teach the AI with it.';

/** A captured datapoint that is hidden: legal, but its unchecked predictions train the engine. */
export function isHiddenCaptured(node: Node): boolean {
  return (
    node.category === 'datapoint' &&
    node.hidden === true &&
    (node.ui_configuration?.type ?? 'captured') === 'captured'
  );
}

/** What the API rejects on a custom engine: AI fields set, or prediction disabled. */
export function isRejected(node: Node): boolean {
  return (node.rir_field_names?.length ?? 0) > 0 || node.disable_prediction === true;
}

export type EngineStatus = {
  /** seeded: has a catalog seed; learning: no seed, learns from confirmed documents; new: no
   *  engine field yet — Save creates it (seeded or learning by `seed`). */
  state: 'seeded' | 'learning' | 'new';
  seed: string | null;
  field: any | null;
};

export function engineStatus(node: Node, fieldsByName: Map<string, any>): EngineStatus {
  const field = fieldsByName.get(String(node.id)) ?? null;
  const staged: EngineStage = node.__engine || {};
  const seed =
    staged.pre_trained_field_id !== undefined
      ? staged.pre_trained_field_id
      : (field?.pre_trained_field_id ?? null);
  return { state: !field ? 'new' : seed ? 'seeded' : 'learning', seed, field };
}

export type EnginePlan = {
  create: Record<string, unknown>[];
  patch: { id: number; name: string; body: Record<string, unknown> }[];
};

/**
 * What Save sends before the schema: engine fields to create (one per extracted datapoint
 * without one) and to patch (a changed seed, or a type that no longer matches the schema —
 * the API rejects a mismatch). Unused engine fields are left alone: other queues bound to
 * the same engine may use them.
 */
export function enginePlan(
  nodes: Node[],
  fields: any[],
  engineUrl: string,
  catalog: any[],
): EnginePlan {
  const byName = new Map(fields.map((f) => [String(f.name), f]));
  const cat = new Map(catalog.map((c) => [String(c.name), c]));
  const plan: EnginePlan = { create: [], patch: [] };
  for (const { node, tabular } of extractedFields(nodes)) {
    const id = String(node.id ?? '').trim();
    if (!id) continue;
    const type = node.type ?? 'string';
    const st = engineStatus(node, byName);
    if (!st.field) {
      const c = st.seed ? cat.get(st.seed) : undefined;
      // The schema's type wins; the catalog's subtype only fits its own type.
      plan.create.push({
        engine: engineUrl,
        name: id,
        label: String(node.label ?? id),
        type,
        subtype: c && c.type === type ? (c.subtype ?? null) : null,
        pre_trained_field_id: st.seed,
        tabular,
        multiline: c?.multiline ?? 'false',
      });
      continue;
    }
    const body: Record<string, unknown> = {};
    if ((st.field.pre_trained_field_id ?? null) !== st.seed) body.pre_trained_field_id = st.seed;
    if (st.field.type !== type) {
      body.type = type;
      body.subtype = null;
    }
    if (Object.keys(body).length) plan.patch.push({ id: st.field.id, name: id, body });
  }
  return plan;
}

/** Rules the API enforces on a custom-engine queue's schema, as row errors before Save. */
export function bindingErrors(nodes: Node[]): { key: string; message: string }[] {
  const out: { key: string; message: string }[] = [];
  for (const { node } of extractedFields(nodes)) {
    if (Array.isArray(node.rir_field_names) && node.rir_field_names.length) {
      out.push({
        key: node.__key,
        message: 'On a custom engine, AI fields (rir_field_names) must be empty',
      });
    }
    if (node.disable_prediction === true) {
      out.push({ key: node.__key, message: 'On a custom engine, disable prediction must be off' });
    }
  }
  return out;
}

/** Engine fields no extracted datapoint of this schema uses. */
export function unusedEngineFields(nodes: Node[], fields: any[]): any[] {
  const used = new Set(extractedFields(nodes).map((x) => String(x.node.id)));
  return fields.filter((f) => !used.has(String(f.name)));
}

/** A renamed row's old id, when that old name has an engine field (it keeps what it learned). */
export function renamedFrom(base: Node[], node: Node, fieldsByName: Map<string, any>) {
  const old = flatten(base).find((r) => r.key === node.__key)?.node;
  if (!old || String(old.id) === String(node.id)) return null;
  return fieldsByName.has(String(old.id)) ? String(old.id) : null;
}

/** Whether the row sits in a table (its engine field and catalog seed are tabular). */
export function isTabular(nodes: Node[], key: string): boolean {
  const rows = new Map(flatten(nodes).map((r) => [r.key, r]));
  for (let r = rows.get(key); r; r = r.parentKey ? rows.get(r.parentKey) : undefined) {
    if (r.kind === 'multivalue') return true;
  }
  return false;
}

/**
 * Which other queues use each engine field: an extracted datapoint whose id is the field's
 * name, in the schema of another queue bound to the same engine.
 */
/**
 * The other queues bound to the engine `engineUrl`, by schema URL. Queues on the open schema
 * are not "other": their fields are this schema's.
 */
export function otherEngineQueues(
  queues: any[],
  engineUrl: string,
  queueId: number | null,
  schemaUrl: unknown,
): Map<string, any[]> {
  const out = new Map<string, any[]>();
  for (const q of queues) {
    if (q.engine !== engineUrl || q.id === queueId || q.schema === schemaUrl) continue;
    out.set(q.schema, [...(out.get(q.schema) ?? []), q]);
  }
  return out;
}

export function engineFieldUsers(
  others: { queue: string; content: Node[] }[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { queue, content } of others) {
    for (const { node } of extractedFields(content)) {
      const name = String(node.id);
      const list = out.get(name) ?? [];
      if (!list.includes(queue)) out.set(name, [...list, queue]);
    }
  }
  return out;
}

/**
 * Engine fields safe to delete: no extracted datapoint of this schema uses one, and no other
 * queue on the engine does (`users`, from their schemas). The API refuses (409) to delete one
 * a schema still uses.
 */
export function deletableFields(nodes: Node[], fields: any[], users: Map<string, string[]>): any[] {
  return unusedEngineFields(nodes, fields).filter((f) => !users.has(String(f.name)));
}
