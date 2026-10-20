// src/builder/ruleDraft.ts
// The editable part of a native Rule, and the small decisions around it: a new rule's
// starting shape, action ids, an action's payload when its type changes, and the checks
// Save makes before sending. Shapes follow the rossum-sa business-rules reference.

export type RuleDraft = {
  name: string;
  description: string;
  enabled: boolean;
  trigger_condition: string;
  actions: any[]; // raw action objects — the API's shape, kept as is for types we do not edit
};

export const ACTION_TYPES = ['show_message', 'add_automation_blocker', 'show_hide_field'];
export const ACTION_EVENTS = [
  'validation',
  'annotation_imported',
  'annotation_confirmed',
  'annotation_exported',
  'annotation_import_succeeded',
  'annotation_import_failed',
  'annotation_export_succeeded',
  'annotation_export_failed',
];

/** A rule as the API returns it — untyped on the wire. */
export function draftFromRule(rule: any): RuleDraft {
  return {
    name: String(rule?.name ?? ''),
    description: String(rule?.description ?? ''),
    enabled: rule?.enabled !== false,
    trigger_condition: String(rule?.trigger_condition ?? ''),
    actions: Array.isArray(rule?.actions) ? rule.actions : [],
  };
}

export function emptyDraft(): RuleDraft {
  return {
    name: '',
    description: '',
    enabled: true,
    trigger_condition: '',
    actions: [newAction([])],
  };
}

/** The request body. A create also attaches the rule to the queue it was made from. */
export function draftBody(
  d: RuleDraft,
  create?: { queueUrl: string; organization?: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...d };
  if (create) {
    body.queues = [create.queueUrl];
    if (create.organization) body.organization = create.organization;
  }
  return body;
}

export function newAction(existing: any[]): any {
  const ids = new Set(existing.map((a) => a?.id));
  let n = existing.length + 1;
  while (ids.has(`action-${n}`)) n++;
  return {
    id: `action-${n}`,
    enabled: true,
    type: 'show_message',
    event: 'validation',
    payload: { type: 'error', content: '', schema_id: '' },
  };
}

/** Switch an action's type; the payload becomes that type's shape, keeping the anchor field. */
export function withActionType(action: any, type: string): any {
  const p = action?.payload || {};
  const anchor = p.schema_id || (Array.isArray(p.schema_ids) ? p.schema_ids[0] : '') || '';
  let payload: Record<string, unknown> = {};
  if (type === 'show_message')
    payload = { type: p.type || 'error', content: p.content || '', schema_id: anchor };
  else if (type === 'add_automation_blocker')
    payload = { content: p.content || '', schema_id: anchor };
  else if (type === 'show_hide_field') payload = { schema_ids: anchor ? [anchor] : [] };
  return { ...action, type, payload };
}

export function draftErrors(d: RuleDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('The rule needs a name');
  else if (d.name.length > 255) out.push('The name is longer than 255 characters');
  if (d.description.length > 255) out.push('The description is longer than 255 characters');
  if (!d.trigger_condition.trim()) out.push('The rule needs a condition');
  return out;
}

export function sameDraft(a: RuleDraft, b: RuleDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
