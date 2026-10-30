// src/builder/rules.ts
// Which schema fields a native Rule uses: the ones its trigger_condition reads (`field.<id>`)
// and the ones its actions target (payload `schema_id` / `schema_ids`). A text scan, so a
// `field.x` inside a comment or string counts too — for highlighting, a false positive is
// cheaper than a miss.

export type RuleRefs = { condition: Set<string>; actions: Set<string> };
export type RuleRole = 'condition' | 'action' | 'both';

/** A `field.<id>` read in TxScript. */
export const FIELD_RE = /(?<![\w.])field\.([A-Za-z_][A-Za-z0-9_]*)/g;

/** A rule as the API returns it — untyped on the wire. */
export function ruleFieldRefs(rule: any): RuleRefs {
  const condition = new Set<string>();
  for (const m of String(rule?.trigger_condition ?? '').matchAll(FIELD_RE)) condition.add(m[1]);
  const actions = new Set<string>();
  for (const a of Array.isArray(rule?.actions) ? rule.actions : []) {
    for (const id of anchors(a)) actions.add(id);
  }
  return { condition, actions };
}

export function ruleRoles(refs: RuleRefs): Map<string, RuleRole> {
  const out = new Map<string, RuleRole>();
  for (const id of refs.condition) out.set(id, 'condition');
  for (const id of refs.actions) out.set(id, out.has(id) ? 'both' : 'action');
  return out;
}

/** Per field id: the rules that use it, with how (for the grid's Rules column). */
export function rulesByField(rules: any[]): Map<string, { rule: any; role: RuleRole }[]> {
  const out = new Map<string, { rule: any; role: RuleRole }[]>();
  for (const rule of rules) {
    for (const [id, role] of ruleRoles(ruleFieldRefs(rule))) {
      out.set(id, [...(out.get(id) || []), { rule, role }]);
    }
  }
  return out;
}

/** What one action does, for an icon: a message's severity, show/hide, a blocker, or the type. */
export type ActionMark = { kind: string; text: string; event: string };

function markOf(a: any): ActionMark {
  const p = a?.payload || {};
  const event = String(a?.event ?? '');
  if (a?.type === 'show_message') {
    const kind = ['error', 'warning', 'info'].includes(p.type) ? p.type : 'error';
    return { kind, text: String(p.content ?? ''), event };
  }
  if (a?.type === 'add_automation_blocker')
    return { kind: 'blocker', text: String(p.content ?? ''), event };
  if (a?.type === 'show_hide_field')
    return { kind: 'show_hide', text: 'Shown when the rule fires', event };
  return { kind: String(a?.type ?? 'action'), text: event, event };
}

/** The fields one action targets: its payload's `schema_id` and `schema_ids`. */
function anchors(a: any): string[] {
  const p = a?.payload || {};
  const ids = [
    ...(typeof p.schema_id === 'string' && p.schema_id ? [p.schema_id] : []),
    ...(Array.isArray(p.schema_ids)
      ? p.schema_ids.filter((x: unknown) => typeof x === 'string' && x)
      : []),
  ];
  return [...new Set(ids)];
}

/** Per field id: the marks of the actions anchored on it, in action order. */
export function fieldActionMarks(rule: any): Map<string, ActionMark[]> {
  const out = new Map<string, ActionMark[]>();
  for (const a of Array.isArray(rule?.actions) ? rule.actions : []) {
    for (const id of anchors(a)) out.set(id, [...(out.get(id) || []), markOf(a)]);
  }
  return out;
}

/** The actions with no field anchor: document-level messages and blockers, emails, moves… */
export function globalActionMarks(rule: any): ActionMark[] {
  return (Array.isArray(rule?.actions) ? rule.actions : [])
    .filter((a: any) => !anchors(a).length)
    .map(markOf);
}
