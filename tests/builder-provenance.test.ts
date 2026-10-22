import { describe, it, expect } from 'vitest';
import {
  provenanceInputs,
  provenanceConfigs,
  configValues,
  configOutcome,
} from '../src/builder/provenance.js';

const schema = [
  {
    category: 'section',
    id: 's',
    children: [
      { category: 'datapoint', id: 'vat', type: 'string' },
      { category: 'datapoint', id: 'total', type: 'number' },
      {
        category: 'multivalue',
        id: 'items',
        children: {
          category: 'tuple',
          id: 'item',
          children: [
            { category: 'datapoint', id: 'item_code', type: 'string' },
            { category: 'datapoint', id: 'item_match', type: 'enum' },
          ],
        },
      },
    ],
  },
];
const content = [
  {
    category: 'section',
    schema_id: 's',
    children: [
      { category: 'datapoint', schema_id: 'vat', content: { value: 'DK1' } },
      {
        category: 'datapoint',
        schema_id: 'total',
        content: { value: '1,000', normalized_value: '1000' },
      },
      {
        category: 'multivalue',
        schema_id: 'items',
        children: ['A', 'B'].map((c) => ({
          category: 'tuple',
          schema_id: 'item',
          children: [
            { category: 'datapoint', schema_id: 'item_code', content: { value: c } },
            { category: 'datapoint', schema_id: 'item_match', content: { value: '' } },
          ],
        })),
      },
    ],
  },
];
const hooks = [
  {
    id: 7,
    name: 'Matching',
    settings: {
      configurations: [
        {
          name: 'vendor',
          source: { dataset: 'v', queries: [{ find: { vat: '{vat}' } }] },
          mapping: { target_schema_id: 'vendor' },
        },
        {
          name: 'items',
          source: { dataset: 'p', queries: [{ find: { code: '{item_code}' } }] },
          mapping: { target_schema_id: 'item_match' },
        },
      ],
    },
  },
  { id: 8, name: 'Not MDH', settings: {} },
];

describe('provenance inputs', () => {
  it('flattens the annotation, typed by the schema', () => {
    const p = provenanceInputs(content, schema);
    expect(p.headerValues).toMatchObject({ vat: 'DK1', total: '1000' });
    expect(p.rowValues.item_code).toEqual(['A', 'B']);
    expect(p.types).toMatchObject({ vat: 'string', total: 'number' });
    expect(p.tables.map((t: any) => [t.schemaId, t.rowCount])).toEqual([['items', 2]]);
  });

  it('lists the MDH configurations with their hook and number', () => {
    const list = provenanceConfigs(hooks);
    expect(list.map((x) => [x.hook.id, x.index, x.cfg.name, x.cfg.dataset])).toEqual([
      [7, 0, 'vendor', 'v'],
      [7, 1, 'items', 'p'],
    ]);
  });

  it('a header configuration reads header values; a table one reads the chosen row', () => {
    const p = provenanceInputs(content, schema);
    const [vendor, items] = provenanceConfigs(hooks);
    expect(configValues(vendor.cfg, p, 0)).toMatchObject({ scope: null, values: { vat: 'DK1' } });
    const r = configValues(items.cfg, p, 1);
    expect(r.scope).toEqual({ tableSchemaId: 'items', rowCount: 2 });
    expect(r.values.item_code).toBe('B');
  });
});

describe('configOutcome', () => {
  it('sums up a configuration from its query results', () => {
    expect(
      configOutcome([
        { status: 'empty' },
        { status: 'winner', hint: '1 hit' },
        { status: 'skipped' },
      ]),
    ).toEqual({
      kind: 'matched',
      query: 1,
      hint: '1 hit',
    });
    expect(configOutcome([{ status: 'empty' }, { status: 'empty' }])).toEqual({ kind: 'nomatch' });
    expect(configOutcome([{ status: 'gated' }, { status: 'gated' }])).toEqual({ kind: 'gated' });
    expect(configOutcome([{ status: 'empty' }, { status: 'error', hint: 'boom' }])).toEqual({
      kind: 'error',
      hint: 'boom',
    });
    expect(configOutcome([{ status: 'winner' }, { status: 'pending' }]).kind).toBe('matched');
    expect(configOutcome([{ status: 'pending' }, { status: 'empty' }])).toEqual({
      kind: 'pending',
    });
    expect(configOutcome([])).toEqual({ kind: 'nomatch' });
  });
});
