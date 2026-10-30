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

function configRefs(cfg: any): HookRefs {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  collectPlaceholders(cfg?.source?.queries ?? cfg?.matching?.queries, inputs);
  if (typeof cfg?.action_condition === 'string') collectPlaceholders(cfg.action_condition, inputs);
  const target = cfg?.mapping?.target_schema_id;
  if (typeof target === 'string' && target) outputs.add(target);
  for (const m of Array.isArray(cfg?.additional_mappings) ? cfg.additional_mappings : []) {
    if (typeof m?.target_schema_id === 'string' && m.target_schema_id)
      outputs.add(m.target_schema_id);
  }
  return { inputs, outputs };
}

/**
 * The fields a hook (or `{settings}` being edited — untyped on the wire) uses, across all its
 * configurations or, given `index`, just that one.
 */
export function hookFieldRefs(hook: any, index?: number): HookRefs {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  hookConfigs(hook).forEach((cfg, i) => {
    if (index != null && i !== index) return;
    const r = configRefs(cfg);
    r.inputs.forEach((x) => inputs.add(x));
    r.outputs.forEach((x) => outputs.add(x));
  });
  return { inputs, outputs };
}

export type ConfigSummary = { index: number; name: string; dataset: string; target: string };

const configName = (cfg: any, i: number) =>
  cfg?.name ? String(cfg.name) : `Configuration ${i + 1}`;

/** One line per configuration, for the hook panel's list. */
export function configSummaries(hook: any): ConfigSummary[] {
  return hookConfigs(hook).map((cfg, i) => ({
    index: i,
    name: configName(cfg, i),
    dataset: String(cfg?.source?.dataset ?? ''),
    target: String(cfg?.mapping?.target_schema_id ?? ''),
  }));
}

/** Per field id: which configurations (all, or just `index`) use it, and how (in / out / both). */
export function fieldConfigs(
  hook: any,
  index?: number,
): Map<string, { index: number; name: string; role: HookRole }[]> {
  const out = new Map<string, { index: number; name: string; role: HookRole }[]>();
  hookConfigs(hook).forEach((cfg, i) => {
    if (index != null && i !== index) return;
    for (const [id, role] of hookRoles(configRefs(cfg))) {
      out.set(id, [...(out.get(id) || []), { index: i, name: configName(cfg, i), role }]);
    }
  });
  return out;
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
