// src/builder/fieldAssist.ts
// Mr. Fabry in the field inspector, formulas first: a plain-language request comes back as
// the attributes to change on ONE field, which the caller applies as one undoable schema
// edit. Formula rules follow the rossum-sa txscript reference.
import { extractJson, fieldLines, type FieldInfo } from './assist.js';

const FORMULA_MAX = 2000;
const NEVER = ['category', 'children', '__key', '__deleted'];

const CONTRACT = [
  'You change ONE field of a Rossum schema. Do not create or change anything in Rossum — only propose.',
  'Reply with exactly one ```json block holding ONLY the attributes to change, for example',
  '{"formula": "..."} or {"label": "...", "constraints": {"required": true}}. Use null to remove an',
  'attribute. Never change "category" or "children". Change "id" only if asked to.',
  'A formula is TxScript (Python): the last expression is the field value; name intermediate',
  'results with `x = ...`. Read fields as field.<id>. At most 2000 characters, comments included.',
  'It must never read its own field. Helpers need no import: default_to, is_empty, is_set, len,',
  'sum, min, max, re, date, timedelta. A formula field has "ui_configuration": {"type": "formula"}.',
  'Use only field ids from the list below.',
].join('\n');

/** The field as the API holds it (untyped), without Builder's internal markers. */
function plain(field: any): any {
  const { __key, __deleted, children, ...rest } = field || {};
  return rest;
}

export function buildFieldPrompt({
  request,
  field,
  fields,
  table,
}: {
  request: string;
  field: any;
  fields: FieldInfo[];
  table: string | null;
}): string {
  return [
    CONTRACT,
    `Schema fields:\n${fieldLines(fields)}`,
    table
      ? `This field is a column of table ${table}: its formula runs once per row, where field.<column> is that row's value and a header field still reads as field.<id>.`
      : 'This is a header field: to read a table column use field.<column>.all_values.',
    `The field now:\n${JSON.stringify(plain(field), null, 2)}`,
    `Request: ${request}`,
  ].join('\n\n');
}

/** A follow-up in the same chat, with the field as it is now (the user may have edited it). */
export function buildFieldFollowup(request: string, field: any): string {
  return [
    `The field now:\n${JSON.stringify(plain(field), null, 2)}`,
    `Request: ${request}`,
    'Reply again with exactly one ```json block holding only the attributes to change.',
  ].join('\n\n');
}

export type ParsedField =
  { ok: true; patch: Record<string, unknown>; warnings: string[] } | { ok: false; error: string };

const FIELD_RE = /(?<![\w.])field\.([A-Za-z_][A-Za-z0-9_]*)/g;

export function parseFieldReply(
  text: string,
  { selfId, schemaIds }: { selfId: string; schemaIds: Set<string> },
): ParsedField {
  const none = { ok: false as const, error: 'Mr. Fabry did not return any field changes' };
  const raw = extractJson(text);
  if (!raw) return none;
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Mr. Fabry returned changes that are not valid JSON' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return none;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!NEVER.includes(k)) patch[k] = v;
  if (!Object.keys(patch).length) return none;

  const warnings: string[] = [];
  if (typeof patch.formula === 'string') {
    const f = patch.formula;
    if (f.length > FORMULA_MAX) {
      return {
        ok: false,
        error: `The formula is ${f.length} characters; the limit is ${FORMULA_MAX}`,
      };
    }
    const refs = [...f.matchAll(FIELD_RE)].map((m) => m[1]);
    if (refs.includes(selfId))
      return { ok: false, error: `The formula reads its own field (${selfId})` };
    const unknown = [...new Set(refs)].filter((id) => !schemaIds.has(id));
    if (typeof patch.id === 'string' && patch.id !== selfId) {
      warnings.push(`This renames the field to ${patch.id}`);
    }
    if (unknown.length) warnings.push(`Not in this schema: ${unknown.join(', ')}`);
  } else if (typeof patch.id === 'string' && patch.id !== selfId) {
    warnings.push(`This renames the field to ${patch.id}`);
  }
  return { ok: true, patch, warnings };
}
