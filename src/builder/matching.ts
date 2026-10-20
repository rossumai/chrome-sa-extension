// src/builder/matching.ts
// Which schema fields an MDH (Master Data Hub) hook uses. A field is an INPUT when a match
// configuration's query or action_condition substitutes it as a "{field}" placeholder, and an
// OUTPUT when the configuration writes it (mapping / additional_mappings target_schema_id).
// The config shape and the placeholder grammar are the popup provenance card's — reused, not
// copied.
import { hookConfigs, isMdhHook, collectPlaceholders } from '../popup/mdh-provenance.js';

export type HookRefs = { inputs: Set<string>; outputs: Set<string> };
export type HookRole = 'in' | 'out' | 'both';

/** The queue's hooks that are MDH matching hooks (raw API objects). */
export function mdhHooks(hooks: any[]): any[] {
  return hooks.filter(isMdhHook);
}

/** A hook (or `{settings}` being edited) — untyped on the wire. */
export function hookFieldRefs(hook: any): HookRefs {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  for (const cfg of hookConfigs(hook)) {
    collectPlaceholders(cfg?.source?.queries ?? cfg?.matching?.queries, inputs);
    if (typeof cfg?.action_condition === 'string')
      collectPlaceholders(cfg.action_condition, inputs);
    const target = cfg?.mapping?.target_schema_id;
    if (typeof target === 'string' && target) outputs.add(target);
    for (const m of Array.isArray(cfg?.additional_mappings) ? cfg.additional_mappings : []) {
      if (typeof m?.target_schema_id === 'string' && m.target_schema_id)
        outputs.add(m.target_schema_id);
    }
  }
  return { inputs, outputs };
}

export function hookRoles(refs: HookRefs): Map<string, HookRole> {
  const out = new Map<string, HookRole>();
  for (const id of refs.inputs) out.set(id, 'in');
  for (const id of refs.outputs) out.set(id, out.has(id) ? 'both' : 'out');
  return out;
}

/** Per field id: the MDH hooks that use it, with how (for the grid's Matching column). */
export function hooksByField(hooks: any[]): Map<string, { hook: any; role: HookRole }[]> {
  const out = new Map<string, { hook: any; role: HookRole }[]>();
  for (const hook of hooks) {
    for (const [id, role] of hookRoles(hookFieldRefs(hook))) {
      out.set(id, [...(out.get(id) || []), { hook, role }]);
    }
  }
  return out;
}
