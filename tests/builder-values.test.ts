import { describe, it, expect } from 'vitest';
import { annotationValues } from '../src/builder/values.js';

const content = [
  {
    category: 'section',
    schema_id: 'basic_section',
    children: [
      { category: 'datapoint', id: 101, schema_id: 'doc_id', content: { value: 'INV-1' } },
      { category: 'datapoint', schema_id: 'empty', content: { value: '' } },
    ],
  },
  {
    category: 'section',
    schema_id: 'items_section',
    children: [
      {
        category: 'multivalue',
        schema_id: 'items',
        children: [
          {
            category: 'tuple',
            schema_id: 'item',
            children: [
              {
                category: 'datapoint',
                id: 201,
                schema_id: 'item_desc',
                content: { value: 'Bolts' },
              },
            ],
          },
          {
            category: 'tuple',
            schema_id: 'item',
            children: [
              {
                category: 'datapoint',
                id: 202,
                schema_id: 'item_desc',
                content: { value: 'Nuts' },
              },
            ],
          },
        ],
      },
      {
        category: 'multivalue',
        schema_id: 'po_numbers',
        children: [{ category: 'datapoint', schema_id: 'po_number', content: { value: 'PO-7' } }],
      },
    ],
  },
];

describe('annotationValues', () => {
  it('collects header values, table row counts and column values per row', () => {
    const v = annotationValues(content);
    expect(v.values.get('doc_id')).toEqual(['INV-1']);
    expect(v.values.get('empty')).toEqual(['']);
    expect(v.rows.get('items')).toBe(2);
    expect(v.values.get('item_desc')).toEqual(['Bolts', 'Nuts']);
    expect(v.rows.get('po_numbers')).toBe(1);
    expect(v.values.get('po_number')).toEqual(['PO-7']);
  });

  it('tolerates an empty or malformed content', () => {
    expect(annotationValues([]).values.size).toBe(0);
    expect(annotationValues(null as any).rows.size).toBe(0);
  });
});

describe('annotationValues ids', () => {
  it('maps each datapoint id to its field and row', () => {
    const v = annotationValues(content);
    expect(v.ids.get(101)).toEqual({ schemaId: 'doc_id', row: 0 });
    expect(v.ids.get(202)).toEqual({ schemaId: 'item_desc', row: 1 });
  });
});
