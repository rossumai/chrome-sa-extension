// src/builder/links.ts
// Pure data for the pickers: queues grouped by workspace, the schemas no queue uses, and a
// queue's annotations.

export type QueueGroup = { ws: any; qs: any[] };

export function queueGroups(workspaces: any[], queues: any[], filter: string): QueueGroup[] {
  const f = filter.trim().toLowerCase();
  return (
    workspaces
      .map((ws) => ({
        ws,
        qs: queues.filter(
          (q) => q.workspace === ws.url && (!f || String(q.name).toLowerCase().includes(f)),
        ),
      }))
      // An empty workspace stays visible (a new one has no queues yet) unless filtering.
      .filter((g) => g.qs.length || !f)
  );
}

/** Schemas that no queue uses (across ALL queues, not only the listed ones), by name. */
export function orphanSchemas(
  schemas: { id: number; url: string; name: string }[],
  queues: any[],
  filter: string,
): { id: number; url: string; name: string }[] {
  const used = new Set(queues.map((q) => q.schema));
  const f = filter.trim().toLowerCase();
  return schemas.filter(
    (x) => !used.has(x.url) && (!f || String(x.name).toLowerCase().includes(f)),
  );
}

/** The annotation picker's rows, from one listAnnotations page (documents sideloaded). */
export function annotationRows(page: any): { id: number; label: string }[] {
  const docs = new Map<string, any>((page?.documents || []).map((d: any) => [d.url, d]));
  return (page?.results || []).map((a: any) => ({
    id: a.id,
    label: `${docs.get(a.document)?.original_file_name || 'annotation'} (${a.id}) · ${a.status}`,
  }));
}
