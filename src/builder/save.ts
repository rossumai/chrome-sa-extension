// src/builder/save.ts
// The Builder's save pipeline: local checks -> stale check -> the caller's earlier writes ->
// validate (dry run) -> PATCH -> re-fetch and compare. Network calls are injected so the order and the stops
// are unit-tested. A 429 is thrown through untouched: the caller shows it and the user
// retries (spec 2026-10-13 §4.3).

import { localErrors, stripForSave, kids, type Node } from './model.js';
import { isRateLimited } from '../net/rateLimit.js';

export type RowError = { key: string | null; message: string };

export type SaveResult =
  | { ok: true; schema: any; warnings: string[] }
  | { ok: false; stage: 'local' | 'engine' | 'stale' | 'validate' | 'patch'; errors: RowError[] };

export type SaveDeps = {
  getSchema: (id: number) => Promise<any>;
  validateSchema: (id: number, content: any[]) => Promise<any>;
  patchSchema: (id: number, content: any[], name?: string) => Promise<any>;
};

function liveKids(n: Node | undefined): Node[] {
  return n ? kids(n).filter((k) => !k.__deleted) : [];
}

// Flatten an error value (string, list, or nested object of lists) into "path: message".
function messages(v: unknown, prefix: string): string[] {
  if (typeof v === 'string') return [prefix ? `${prefix}: ${v}` : v];
  if (Array.isArray(v)) return v.flatMap((x) => messages(x, prefix));
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => messages(x, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

/**
 * The validate endpoint's error tree mirrors the SENT content positionally: a list per
 * section, then `children` keyed by index (a multivalue's single child is not indexed).
 * Sent content omits soft-deleted nodes, so positions are resolved against live nodes.
 */
export function mapValidateErrors(tree: any, work: Node[]): RowError[] {
  const out: RowError[] = [];
  const walk = (err: any, node: Node | undefined) => {
    const key = node ? node.__key : null;
    if (!err || typeof err !== 'object' || Array.isArray(err)) {
      for (const m of messages(err, '')) out.push({ key, message: m });
      return;
    }
    for (const [k, v] of Object.entries(err)) {
      if (k !== 'children' || !node) {
        for (const m of messages(v, k)) out.push({ key, message: m });
        continue;
      }
      const kids = liveKids(node);
      if (!Array.isArray(node.children)) {
        walk(v, kids[0]);
        continue;
      }
      for (const [idx, e] of Object.entries(v as any)) {
        if (typeof e === 'string') out.push({ key, message: `children: ${e}` });
        else walk(e, kids[Number(idx)]);
      }
    }
  };
  const top = work.filter((n) => !n.__deleted);
  for (const [k, v] of Object.entries(tree || {})) {
    if (k === 'content' && Array.isArray(v)) {
      v.forEach((e, i) => (typeof e === 'string' ? walk(e, undefined) : walk(e, top[i])));
    } else {
      for (const m of messages(v, k)) out.push({ key: null, message: m });
    }
  }
  return out;
}

/**
 * Paths whose SENT value did not land. Keys the API added (absent from `sent`) are its
 * injected defaults and are ignored; a key we sent that came back missing or different
 * is reported — PATCH drops unknown keys silently with a 200.
 */
export function landedDiff(sent: any, got: any, path = ''): string[] {
  if (Array.isArray(sent) && Array.isArray(got)) {
    const n = Math.max(sent.length, got.length);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(...landedDiff(sent[i], got[i], `${path}[${i}]`));
    return out;
  }
  const isObj = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);
  if (isObj(sent) && isObj(got)) {
    return Object.keys(sent).flatMap((k) => landedDiff(sent[k], got[k], `${path}.${k}`));
  }
  return JSON.stringify(sent) === JSON.stringify(got) ? [] : [path];
}

/** The checks that need no network: an empty name, an empty or duplicate ID. */
export function localStage(work: Node[], name?: string): SaveResult | null {
  if (name !== undefined && !name.trim()) {
    return { ok: false, stage: 'local', errors: [{ key: null, message: 'Schema name is empty' }] };
  }
  const local = localErrors(work);
  return local.length ? { ok: false, stage: 'local', errors: local } : null;
}

export async function saveSchema(
  {
    schemaId,
    baseModifiedAt,
    work,
    force,
    name,
    baseName,
    beforeWrite,
  }: {
    schemaId: number;
    baseModifiedAt: string | null;
    work: Node[];
    force: boolean;
    name?: string;
    baseName?: string;
    /** Writes that must land after the stale check and before the schema; a result stops. */
    beforeWrite?: () => Promise<SaveResult | null>;
  },
  deps: SaveDeps,
): Promise<SaveResult> {
  const local = localStage(work, name);
  if (local) return local;
  const renamed = name !== undefined && name !== baseName;

  const current = await deps.getSchema(schemaId);
  if (!force && current?.modified_at !== baseModifiedAt) {
    return {
      ok: false,
      stage: 'stale',
      errors: [{ key: null, message: 'Someone changed this schema after you opened it.' }],
    };
  }

  const blocked = await beforeWrite?.();
  if (blocked) return blocked;

  const content = stripForSave(work);
  const verdict = await deps.validateSchema(schemaId, content);
  if (verdict && Object.keys(verdict).length) {
    const errors = mapValidateErrors(verdict, work);
    if (!errors.length) errors.push({ key: null, message: JSON.stringify(verdict) });
    return { ok: false, stage: 'validate', errors };
  }

  let patched: any;
  try {
    patched = renamed
      ? await deps.patchSchema(schemaId, content, name)
      : await deps.patchSchema(schemaId, content);
  } catch (err: any) {
    if (isRateLimited(err)) throw err;
    return {
      ok: false,
      stage: 'patch',
      errors: [{ key: null, message: err?.message || 'Save failed' }],
    };
  }

  // The PATCH landed. A failed re-read must not turn that into "Save failed": fall back
  // to the PATCH response so the new base matches what the server now holds.
  let schema: any;
  try {
    schema = await deps.getSchema(schemaId);
  } catch (err: any) {
    const why = err?.message || 'unknown error';
    return {
      ok: true,
      schema: patched,
      warnings: [`Saved, but the schema could not be re-read to check it (${why}).`],
    };
  }
  const warnings = landedDiff(content, schema?.content || []);
  if (renamed && schema?.name !== name) warnings.unshift('name');
  return { ok: true, schema, warnings };
}
