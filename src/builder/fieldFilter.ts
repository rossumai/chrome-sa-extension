// src/builder/fieldFilter.ts
// The grid's filters: which rows to show for a text query on id or label, and/or a rule. A match keeps its
// ancestors (so a column still shows under its table and section) and, when the match is a
// container, everything inside it.
import { flatten, type Node } from './model.js';

function matches(n: Node, q: string): boolean {
  return (
    String(n.id ?? '')
      .toLowerCase()
      .includes(q) ||
    String(n.label ?? '')
      .toLowerCase()
      .includes(q)
  );
}

/**
 * Keys of the rows to show, or null to show everything. With `ruleIds`, mode 'and' shows the
 * rule's fields that match the text; mode 'or' (rule mode) shows the rule's fields PLUS any
 * text match, so a field the rule does not use yet can be found and clicked in.
 */
export function visibleKeys(
  nodes: Node[],
  query: string,
  ruleIds: Set<string> | null = null,
  mode: 'and' | 'or' = 'and',
): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q && !ruleIds) return null;
  const inRule = (n: Node) => !!ruleIds && ruleIds.has(String(n.id));
  const hit = (n: Node) =>
    !ruleIds
      ? matches(n, q)
      : mode === 'or'
        ? inRule(n) || (!!q && matches(n, q))
        : inRule(n) && (!q || matches(n, q));
  const rows = flatten(nodes);
  const parent = new Map(rows.map((r) => [r.key, r.parentKey]));
  const keep = new Set<string>();
  const shown = new Set<string>(); // matched, or inside a matched container
  for (const r of rows) {
    const inside = r.parentKey !== null && shown.has(r.parentKey);
    if (!inside && !hit(r.node)) continue;
    shown.add(r.key);
    for (let k: string | null = r.key; k !== null && !keep.has(k); k = parent.get(k) ?? null) {
      keep.add(k);
    }
  }
  return keep;
}

/** How many nodes match the query themselves (ancestors and container contents not counted). */
export function countMatches(nodes: Node[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  return flatten(nodes).filter((r) => matches(r.node, q)).length;
}

/** `keys` plus every ancestor of them, so a changed column still shows under its table. */
export function withAncestors(nodes: Node[], keys: Set<string>): Set<string> {
  const parent = new Map(flatten(nodes).map((r) => [r.key, r.parentKey]));
  const out = new Set<string>();
  for (const key of keys) {
    for (let k: string | null = key; k !== null && !out.has(k); k = parent.get(k) ?? null)
      out.add(k);
  }
  return out;
}
