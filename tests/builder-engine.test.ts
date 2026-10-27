import { describe, it, expect } from 'vitest';
import { withKeys, setAttr, stripForSave } from '../src/builder/model.js';
import { section, dp, keyOf, rowOf } from './support/builder.js';
import {
  engineKind,
  extractedFields,
  engineStatus,
  enginePlan,
  bindingErrors,
  unusedEngineFields,
  renamedFrom,
  engineFieldUsers,
  isHiddenCaptured,
} from '../src/builder/engine.js';

const schema = () =>
  withKeys([
    section('s', [
      dp('doc_id', { ui_configuration: { type: 'captured' } }),
      dp('total', { type: 'number' }),
      dp('calc', { ui_configuration: { type: 'formula' }, formula: '1' }),
      dp('btn', { type: 'button' }),
      {
        category: 'multivalue',
        id: 'items',
        rir_field_names: ['line_items'],
        children: { category: 'tuple', id: 'item', children: [dp('item_desc')] },
      },
    ]),
  ]);
const ENGINE = 'https://x/api/v1/engines/5';
const fields = [
  { id: 1, name: 'doc_id', type: 'string', pre_trained_field_id: 'document_id' },
  { id: 2, name: 'total', type: 'string', pre_trained_field_id: null },
  { id: 3, name: 'old_field', type: 'string', pre_trained_field_id: null },
];
const catalog = [
  { name: 'document_id', type: 'string', subtype: 'alphanumeric', multiline: 'false' },
  {
    name: 'table_column_description',
    type: 'string',
    subtype: null,
    multiline: 'true',
    tabular: true,
  },
];

describe('engine', () => {
  it('tells the queue binding from its engine properties', () => {
    expect(engineKind({ engine: 'e', generic_engine: null })).toBe('custom');
    expect(engineKind({ engine: null, generic_engine: 'g' })).toBe('generic');
    expect(engineKind({ dedicated_engine: 'd' })).toBe('dedicated');
    expect(engineKind({})).toBe('none');
  });

  it('extracts captured and unset sources, not formula fields or buttons; marks table columns', () => {
    expect(extractedFields(schema()).map((x) => [x.node.id, x.tabular])).toEqual([
      ['doc_id', false],
      ['total', false],
      ['item_desc', true],
    ]);
  });

  it('a field is seeded, learning, or new; a staged seed wins', () => {
    const byName = new Map(fields.map((f) => [f.name, f]));
    const nodes = schema();
    const node = (id: string) => rowOf(nodes, id).node;
    expect(engineStatus(node('doc_id'), byName)).toMatchObject({
      state: 'seeded',
      seed: 'document_id',
    });
    expect(engineStatus(node('total'), byName)).toMatchObject({ state: 'learning', seed: null });
    expect(engineStatus(node('item_desc'), byName)).toMatchObject({ state: 'new', seed: null });
    const staged = setAttr(
      nodes,
      keyOf(nodes, 'doc_id'),
      ['__engine', 'pre_trained_field_id'],
      null,
    );
    const n = rowOf(staged, 'doc_id').node;
    expect(engineStatus(n, byName)).toMatchObject({ state: 'learning', seed: null });
  });

  it('plans a create for a field without an engine field, with the schema type and the seed', () => {
    let nodes = schema();
    nodes = setAttr(
      nodes,
      keyOf(nodes, 'item_desc'),
      ['__engine', 'pre_trained_field_id'],
      'table_column_description',
    );
    const plan = enginePlan(nodes, fields, ENGINE, catalog);
    expect(plan.create).toEqual([
      {
        engine: ENGINE,
        name: 'item_desc',
        label: 'item_desc',
        type: 'string',
        subtype: null,
        pre_trained_field_id: 'table_column_description',
        tabular: true,
        multiline: 'true',
      },
    ]);
  });

  it('plans a patch for a changed seed and for a type that no longer matches', () => {
    let nodes = schema();
    nodes = setAttr(nodes, keyOf(nodes, 'doc_id'), ['__engine', 'pre_trained_field_id'], null);
    const plan = enginePlan(nodes, fields, ENGINE, catalog);
    expect(plan.patch).toEqual([
      { id: 1, name: 'doc_id', body: { pre_trained_field_id: null } },
      { id: 2, name: 'total', body: { type: 'number', subtype: null } },
    ]);
  });

  it('reports what the API would reject on a custom engine', () => {
    let nodes = schema();
    nodes = setAttr(nodes, keyOf(nodes, 'doc_id'), ['rir_field_names'], ['document_id']);
    nodes = setAttr(nodes, keyOf(nodes, 'total'), ['disable_prediction'], true);
    expect(bindingErrors(nodes).map((e) => e.message)).toEqual([
      'On a custom engine, AI fields (rir_field_names) must be empty',
      'On a custom engine, disable prediction must be off',
    ]);
  });

  it('lists engine fields the schema does not use, and the old name of a renamed field', () => {
    const nodes = schema();
    expect(unusedEngineFields(nodes, fields).map((f) => f.name)).toEqual(['old_field']);
    const renamed = setAttr(nodes, keyOf(nodes, 'total'), ['id'], 'grand_total');
    const node = rowOf(renamed, 'grand_total').node;
    expect(renamedFrom(nodes, node, new Map(fields.map((f) => [f.name, f])))).toBe('total');
  });
});

describe('a staged engine edit', () => {
  it('is not sent with the schema', () => {
    let nodes = schema();
    nodes = setAttr(nodes, keyOf(nodes, 'doc_id'), ['__engine', 'pre_trained_field_id'], null);
    expect(JSON.stringify(stripForSave(nodes))).not.toContain('__engine');
  });
});

describe('engineFieldUsers', () => {
  it('maps each extracted field id to the queues whose schema has it, once per queue', () => {
    const content = [
      section('s', [dp('a'), dp('a'), dp('f', { ui_configuration: { type: 'formula' } })]),
    ] as any;
    const m = engineFieldUsers([
      { queue: 'Q1 (1)', content },
      { queue: 'Q2 (2)', content },
    ]);
    expect(m.get('a')).toEqual(['Q1 (1)', 'Q2 (2)']);
    expect(m.has('f')).toBe(false);
  });
});

describe('isHiddenCaptured', () => {
  it('is a hidden datapoint whose source is captured or not set', () => {
    expect(isHiddenCaptured(dp('a', { hidden: true }) as any)).toBe(true);
    expect(
      isHiddenCaptured(dp('a', { hidden: true, ui_configuration: { type: 'captured' } }) as any),
    ).toBe(true);
    expect(
      isHiddenCaptured(dp('a', { hidden: true, ui_configuration: { type: 'formula' } }) as any),
    ).toBe(false);
    expect(isHiddenCaptured(dp('a') as any)).toBe(false);
  });
});
