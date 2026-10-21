// src/builder/values.ts
// Read one annotation's content into what the grid shows: every value per schema id, in
// document order (one entry for a header field, one per row for a table column), and the
// row count of every table.

export type AnnotationValues = {
  values: Map<string, string[]>;
  rows: Map<string, number>;
  /** Datapoint id → its field and row (0 for a header field), to place validation messages. */
  ids: Map<number, { schemaId: string; row: number }>;
};

export function annotationValues(content: any[]): AnnotationValues {
  const values = new Map<string, string[]>();
  const rows = new Map<string, number>();
  const ids = new Map<number, { schemaId: string; row: number }>();
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.category === 'datapoint') {
      const v = n.content?.value;
      const list = [...(values.get(n.schema_id) || []), v == null ? '' : String(v)];
      values.set(n.schema_id, list);
      if (typeof n.id === 'number') ids.set(n.id, { schemaId: n.schema_id, row: list.length - 1 });
      return;
    }
    const kids = Array.isArray(n.children) ? n.children : [];
    if (n.category === 'multivalue') rows.set(n.schema_id, kids.length);
    kids.forEach(walk);
  };
  if (Array.isArray(content)) content.forEach(walk);
  return { values, rows, ids };
}
