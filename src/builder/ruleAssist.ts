// src/builder/ruleAssist.ts
// Mr. Fabry in the rule editor: turn a plain-language request into a native Rule. The prompt
// pins the answer to one JSON block in the rule's own shape; the reply is parsed and checked
// before it may fill the editor (the user still saves). Shared plumbing is in assist.ts.
import { draftFromRule, draftErrors, type RuleDraft } from './ruleDraft.js';
import { ruleFieldRefs } from './rules.js';
import { extractJson, fieldLines, type FieldInfo } from './assist.js';

const CONTRACT = [
  'You write ONE Rossum native Rule. Do not create or change anything in Rossum — only propose.',
  'Rule shape (JSON): {"name", "description", "enabled": true, "trigger_condition", "actions": [...]}.',
  '- name and description: short, at most 255 characters each.',
  '- trigger_condition: a TxScript (Python) boolean expression. The actions run when it is True,',
  '  so it describes the PROBLEM state. Read fields as field.<id>; a table column as',
  '  field.<column>.all_values. Guard empty values with is_empty(field.x) / is_set(field.x).',
  '- actions: objects {"id", "enabled": true, "type", "event": "validation", "payload"}, where type is',
  '  show_message (payload {"type": "error"|"warning"|"info", "content", "schema_id"}),',
  '  add_automation_blocker (payload {"content", "schema_id"}), or',
  '  show_hide_field (payload {"schema_ids": [...]}; those fields are SHOWN when the rule fires).',
  '- Use only field ids from the list below.',
  'Reply with exactly one ```json block holding the whole rule, and nothing after it.',
].join('\n');

export function buildRulePrompt({
  request,
  fields,
  startField,
  current,
}: {
  request: string;
  fields: FieldInfo[];
  startField?: string | null;
  current?: RuleDraft | null;
}): string {
  return [
    CONTRACT,
    `Schema fields:\n${fieldLines(fields)}`,
    startField ? `The rule starts from the field ${startField}.` : '',
    current ? `Current rule (change it as asked):\n${JSON.stringify(current, null, 2)}` : '',
    `Request: ${request}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** A follow-up in the same chat: the editor's current state, the request, the same answer shape. */
export function buildFollowupPrompt(request: string, current: RuleDraft): string {
  return [
    `The rule now reads (the user may have edited it):\n${JSON.stringify(current, null, 2)}`,
    `Request: ${request}`,
    'Reply with the whole updated rule as exactly one ```json block, same shape as before.',
  ].join('\n\n');
}

export type ParsedRule =
  { ok: true; draft: RuleDraft; unknownFields: string[] } | { ok: false; error: string };

/** Parse and check a reply. Missing action ids, `enabled` and `event` get their defaults. */
export function parseRuleReply(text: string, schemaIds: Set<string>): ParsedRule {
  const raw = extractJson(text);
  if (!raw) return { ok: false, error: 'Mr. Fabry did not return a rule' };
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Mr. Fabry returned a rule that is not valid JSON' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'Mr. Fabry did not return a rule' };
  }
  if (obj.actions != null && !Array.isArray(obj.actions)) {
    return { ok: false, error: "The rule's actions are not a list" };
  }
  const draft = draftFromRule(obj);
  draft.actions = draft.actions.map((a: any, i: number) => ({
    id: a?.id || `action-${i + 1}`,
    enabled: a?.enabled !== false,
    event: a?.event || 'validation',
    ...a,
    payload: a?.payload || {},
  }));
  const errors = draftErrors(draft);
  if (errors.length) return { ok: false, error: errors[0] };
  const refs = ruleFieldRefs(draft);
  const unknownFields = [...new Set([...refs.condition, ...refs.actions])].filter(
    (id) => !schemaIds.has(id),
  );
  return { ok: true, draft, unknownFields };
}
