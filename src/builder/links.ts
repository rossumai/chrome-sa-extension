// src/builder/links.ts
// Pure layout data for the navigator: queues grouped by workspace, and schemas ordered so
// their lines to the queues cross as little as possible.

export type QueueGroup = { ws: any; qs: any[] };
export type SchemaItem = { id: number; url: string; name: string; queueIds: number[] };

export function queueGroups(workspaces: any[], queues: any[], filter: string): QueueGroup[] {
  const f = filter.trim().toLowerCase();
  return workspaces
    .map((ws) => ({
      ws,
      qs: queues.filter(
        (q) => q.workspace === ws.url && (!f || String(q.name).toLowerCase().includes(f)),
      ),
    }))
    .filter((g) => g.qs.length);
}

/**
 * Schemas in the order of their first VISIBLE queue, each with the visible queues that use
 * it (its link lines). Schemas no visible queue uses come last, in their original order.
 */
export function schemaItems(
  schemas: { id: number; url: string; name: string }[],
  groups: QueueGroup[],
): SchemaItem[] {
  const byUrl = new Map<string, number[]>();
  for (const q of groups.flatMap((g) => g.qs)) {
    byUrl.set(q.schema, [...(byUrl.get(q.schema) || []), q.id]);
  }
  const order = [...byUrl.keys()];
  const rank = (s: { url: string }) => {
    const i = order.indexOf(s.url);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return schemas
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(({ s }) => ({ id: s.id, url: s.url, name: s.name, queueIds: byUrl.get(s.url) || [] }));
}
