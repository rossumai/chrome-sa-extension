// src/builder/fieldFilter.ts
// The grid's field filter: which rows to show for a query on id or label. A match keeps its
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

/** Keys of the rows to show, or null when the query is empty (show everything). */
export function visibleKeys(nodes: Node[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const rows = flatten(nodes);
  const parent = new Map(rows.map((r) => [r.key, r.parentKey]));
  const keep = new Set<string>();
  const shown = new Set<string>(); // matched, or inside a matched container
  for (const r of rows) {
    const inside = r.parentKey !== null && shown.has(r.parentKey);
    if (!inside && !matches(r.node, q)) continue;
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
