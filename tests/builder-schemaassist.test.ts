import { describe, it, expect } from 'vitest';
import {
  compactSchema,
  parseSchemaReply,
  applyChanges,
  buildSchemaPrompt,
  buildFixPrompt,
  fitSchema,
} from '../src/builder/schemaAssist.js';
import { withKeys, flatten, setDeleted, stripForSave } from '../src/builder/model.js';

function tree() {
  return withKeys([
    {
      category: 'section',
      id: 'basic_section',
      label: 'Basic',
      children: [
        {
          category: 'datapoint',
          id: 'doc_id',
          label: 'Doc ID',
          type: 'string',
          constraints: { required: true },
        },
        {
          category: 'datapoint',
          id: 'check',
          label: 'Check',
          type: 'number',
          ui_configuration: { type: 'formula' },
          formula: 'field.doc_id',
        },
      ],
    },
    {
      category: 'section',
      id: 'items_section',
      label: 'Items',
      children: [
        {
          category: 'multivalue',
          id: 'items',
          label: 'Items',
          children: {
            category: 'tuple',
            id: 'item',
            label: 'Item',
            children: [{ category: 'datapoint', id: 'item_desc', label: 'Desc', type: 'string' }],
          },
        },
      ],
    },
  ]);
}
const ids = (nodes: any[]) => stripForSave(nodes);

describe('compactSchema', () => {
  it('lists sections, fields, tables and columns compactly, without deleted ones', () => {
    let t = tree();
    t = setDeleted(t, flatten(t).find((r) => r.node.id === 'check')!.key, true);
    expect(compactSchema(t)).toEqual([
      {
        section: 'basic_section',
        label: 'Basic',
        fields: [{ id: 'doc_id', label: 'Doc ID', type: 'string', required: true }],
      },
      {
        section: 'items_section',
        label: 'Items',
        fields: [
          {
            table: 'items',
            label: 'Items',
            row: 'item',
            columns: [{ id: 'item_desc', label: 'Desc', type: 'string' }],
          },
        ],
      },
    ]);
  });

  it('keeps source, flags and formula when they are set', () => {
    const c = compactSchema(tree());
    expect(c[0].fields[1]).toEqual({
      id: 'check',
      label: 'Check',
      type: 'number',
      source: 'formula',
      formula: 'field.doc_id',
    });
  });
});

describe('prompts', () => {
  it('the request prompt carries the schema, the change format and the request', () => {
    const p = buildSchemaPrompt({ request: 'Add a VAT section', schema: compactSchema(tree()) });
    expect(p).toContain('Add a VAT section');
    expect(p).toContain('"section":"basic_section"'); // compact JSON, to save prompt budget
    expect(p).toContain('"op"');
    expect(p).toContain('```json');
  });

  it('the fix prompt lists the problems', () => {
    expect(buildFixPrompt(['doc_id: Duplicate ID'], compactSchema(tree()))).toContain(
      'doc_id: Duplicate ID',
    );
  });
});

describe('parseSchemaReply', () => {
  it('reads the summary and the list of changes', () => {
    const r = parseSchemaReply(
      '```json\n{"summary":"Done","changes":[{"op":"delete","id":"check"}]}\n```',
    );
    expect(r).toEqual({ ok: true, summary: 'Done', changes: [{ op: 'delete', id: 'check' }] });
  });

  it('fails without a list of changes', () => {
    expect(parseSchemaReply('no').ok).toBe(false);
    expect(parseSchemaReply('{"summary":"x"}')).toEqual({
      ok: false,
      error: 'Mr. Fabry did not return a list of changes',
    });
  });
});

describe('applyChanges', () => {
  it('sets attributes, never category or children, and renames', () => {
    const r = applyChanges(tree(), [
      {
        op: 'set',
        id: 'doc_id',
        attrs: { label: 'Document ID', category: 'section', children: [] },
      },
      { op: 'set', id: 'check', attrs: { id: 'total_check' } },
    ]);
    const out = ids(r.nodes);
    expect(out[0].children[0]).toMatchObject({ category: 'datapoint', label: 'Document ID' });
    expect(out[0].children[1].id).toBe('total_check');
    expect(r.applied).toBe(2);
    expect(r.skipped).toEqual([]);
  });

  it('adds a field after a sibling, a table to a section, a column to a table row, and a section', () => {
    const r = applyChanges(tree(), [
      {
        op: 'add',
        kind: 'field',
        parent: 'basic_section',
        after: 'doc_id',
        field: { id: 'po', label: 'PO', type: 'string', constraints: { required: true } },
      },
      { op: 'add', kind: 'table', parent: 'items_section', field: { id: 'taxes', label: 'Taxes' } },
      {
        op: 'add',
        kind: 'field',
        parent: 'item',
        field: { id: 'item_qty', label: 'Qty', type: 'number' },
      },
      { op: 'add_section', id: 'vat_section', label: 'VAT', after: 'basic_section' },
    ]);
    const out = ids(r.nodes);
    expect(out.map((s: any) => s.id)).toEqual(['basic_section', 'vat_section', 'items_section']);
    expect(out[0].children.map((c: any) => c.id)).toEqual(['doc_id', 'po', 'check']);
    expect(out[0].children[1].constraints).toEqual({ required: true });
    expect(out[2].children[1]).toMatchObject({ category: 'multivalue', id: 'taxes' });
    expect(out[2].children[0].children.children.map((c: any) => c.id)).toEqual([
      'item_desc',
      'item_qty',
    ]);
    expect(r.applied).toBe(4);
  });

  it('deletes (struck through until Save) and moves', () => {
    const r = applyChanges(tree(), [
      { op: 'delete', id: 'check' },
      { op: 'move', id: 'doc_id', parent: 'items_section' },
    ]);
    expect(flatten(r.nodes).find((x) => x.node.id === 'check')!.deleted).toBe(true);
    expect(ids(r.nodes)[1].children.map((c: any) => c.id)).toEqual(['items', 'doc_id']);
  });

  it('skips what it cannot apply, with a reason, and applies the rest', () => {
    const r = applyChanges(tree(), [
      { op: 'set', id: 'ghost', attrs: { label: 'x' } },
      {
        op: 'add',
        kind: 'field',
        parent: 'basic_section',
        field: { id: 'doc_id', label: 'Again' },
      },
      { op: 'add', kind: 'field', parent: 'nowhere', field: { id: 'z', label: 'Z' } },
      { op: 'explode', id: 'doc_id' },
      { op: 'set', id: 'doc_id', attrs: { label: 'Kept' } },
    ]);
    expect(r.applied).toBe(1);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'No field with ID ghost',
      'The ID doc_id is already used',
      'No section or table row with ID nowhere',
      'Unknown change "explode"',
    ]);
    expect(ids(r.nodes)[0].children[0].label).toBe('Kept');
  });
});

describe('fitSchema (the agent rejects prompts over 50000 characters)', () => {
  const big = (formulaChars: number, fields = 300) => [
    {
      section: 's',
      label: 'S',
      fields: Array.from({ length: fields }, (_, i) => ({
        id: `field_${i}`,
        label: `Field ${i}`,
        type: 'string',
        source: 'formula',
        formula: 'x'.repeat(formulaChars),
      })),
    },
  ];
  const build = (schema: any[]) => buildSchemaPrompt({ request: 'r', schema });

  it('keeps everything when it fits', () => {
    const r = fitSchema(big(10, 10), build);
    expect(r.ok && r.prompt).toBe(build(big(10, 10)));
  });

  it('drops formula bodies, saying how long they were, when the full view is too long', () => {
    const r = fitSchema(big(400), build);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prompt.length).toBeLessThanOrEqual(48000);
      expect(r.prompt).toContain('(formula of 400 characters, not shown)');
      expect(r.note).toContain('formulas');
    }
  });

  it('gives up with a clear message when even that is too long', () => {
    const r = fitSchema(big(0, 5000), build);
    expect(r).toEqual({ ok: false, error: expect.stringContaining('too large') });
  });
});
