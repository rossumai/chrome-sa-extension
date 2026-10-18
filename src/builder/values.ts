// src/builder/values.ts
// Read one annotation's content into what the grid shows: every value per schema id, in
// document order (one entry for a header field, one per row for a table column), and the
// row count of every table.

export type AnnotationValues = { values: Map<string, string[]>; rows: Map<string, number> };

export function annotationValues(content: any[]): AnnotationValues {
  const values = new Map<string, string[]>();
  const rows = new Map<string, number>();
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.category === 'datapoint') {
      const v = n.content?.value;
      values.set(n.schema_id, [...(values.get(n.schema_id) || []), v == null ? '' : String(v)]);
      return;
    }
    const kids = Array.isArray(n.children) ? n.children : [];
    if (n.category === 'multivalue') rows.set(n.schema_id, kids.length);
    kids.forEach(walk);
  };
  if (Array.isArray(content)) content.forEach(walk);
  return { values, rows };
}
