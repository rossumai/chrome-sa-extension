// src/builder/hookAssist.ts
// Mr. Fabry in hook mode: change an MDH hook's settings (its match configurations) as asked.
// The answer is the WHOLE settings object, which fills the JSON editor unsaved.
import { extractJson, fieldLines, type FieldInfo } from './assist.js';
import { hookFieldRefs } from './matching.js';

const CONTRACT = [
  'You change the settings of ONE Rossum Master Data Hub (MDH) matching hook. Do not create or',
  'change anything in Rossum — only propose. Keep the existing structure and every key you are not',
  'asked to change. Each entry of "configurations" matches against a dataset: "source.queries" are',
  'tried in order (MongoDB find or aggregate), and a schema field is substituted as a quoted',
  'placeholder "{schema_id}". "mapping.target_schema_id" is the field the match fills (with',
  '"mapping.dataset_key"); "additional_mappings" fill more fields from the matched record.',
  'Use only field ids from the list below.',
  'Reply with exactly one ```json block holding the WHOLE new settings object, and nothing after it.',
].join('\n');

export function buildHookPrompt({
  request,
  settings,
  fields,
  name,
}: {
  request: string;
  settings: unknown;
  fields: FieldInfo[];
  name: string;
}): string {
  return [
    CONTRACT,
    `Schema fields:\n${fieldLines(fields)}`,
    `The hook "${name}" has these settings now:\n${JSON.stringify(settings, null, 2)}`,
    `Request: ${request}`,
  ].join('\n\n');
}

export function buildHookFollowup(request: string, settings: unknown): string {
  return [
    `The settings now (the user may have edited them):\n${JSON.stringify(settings, null, 2)}`,
    `Request: ${request}`,
    'Reply again with exactly one ```json block holding the whole new settings object.',
  ].join('\n\n');
}

export type ParsedHook =
  | { ok: true; settings: Record<string, unknown>; warnings: string[] }
  | { ok: false; error: string };

export function parseHookReply(text: string, schemaIds: Set<string>): ParsedHook {
  const raw = extractJson(text);
  if (!raw) return { ok: false, error: 'Mr. Fabry did not return hook settings' };
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Mr. Fabry returned settings that are not valid JSON' };
  }
  // Accept {"settings": {...}} too, when the wrapper is all there is.
  if (obj && typeof obj === 'object' && obj.settings && !obj.configurations && !obj.configs) {
    obj = obj.settings;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'Mr. Fabry did not return hook settings' };
  }
  const refs = hookFieldRefs({ settings: obj });
  const unknown = [...new Set([...refs.inputs, ...refs.outputs])].filter(
    (id) => !schemaIds.has(id),
  );
  return {
    ok: true,
    settings: obj,
    warnings: unknown.length ? [`Not in this schema: ${unknown.join(', ')}`] : [],
  };
}
