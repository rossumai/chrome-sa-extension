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
 * Keys of the rows to show, or null to show everything. A row matches when it matches the
 * text query (if any) AND, given `ruleIds`, is one of the fields a rule uses.
 */
export function visibleKeys(
  nodes: Node[],
  query: string,
  ruleIds: Set<string> | null = null,
): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q && !ruleIds) return null;
  const hit = (n: Node) => (!q || matches(n, q)) && (!ruleIds || ruleIds.has(String(n.id)));
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
