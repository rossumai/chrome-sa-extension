// src/builder/rules.ts
// Which schema fields a native Rule uses: the ones its trigger_condition reads (`field.<id>`)
// and the ones its actions target (payload `schema_id` / `schema_ids`). A text scan, so a
// `field.x` inside a comment or string counts too — for highlighting, a false positive is
// cheaper than a miss.

export type RuleRefs = { condition: Set<string>; actions: Set<string> };
export type RuleRole = 'condition' | 'action' | 'both';

const FIELD_RE = /(?<![\w.])field\.([A-Za-z_][A-Za-z0-9_]*)/g;

/** A rule as the API returns it — untyped on the wire. */
export function ruleFieldRefs(rule: any): RuleRefs {
  const condition = new Set<string>();
  for (const m of String(rule?.trigger_condition ?? '').matchAll(FIELD_RE)) condition.add(m[1]);
  const actions = new Set<string>();
  for (const a of Array.isArray(rule?.actions) ? rule.actions : []) {
    const p = a?.payload || {};
    if (typeof p.schema_id === 'string' && p.schema_id) actions.add(p.schema_id);
    for (const id of Array.isArray(p.schema_ids) ? p.schema_ids : []) {
      if (typeof id === 'string' && id) actions.add(id);
    }
  }
  return { condition, actions };
}

export function ruleRoles(refs: RuleRefs): Map<string, RuleRole> {
  const out = new Map<string, RuleRole>();
  for (const id of refs.condition) out.set(id, 'condition');
  for (const id of refs.actions) out.set(id, out.has(id) ? 'both' : 'action');
  return out;
}
