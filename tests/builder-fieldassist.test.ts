import { describe, it, expect } from 'vitest';
import { buildFieldPrompt, parseFieldReply } from '../src/builder/fieldAssist.js';

const fields = [
  { id: 'amount_total', label: 'Total', type: 'number', table: null },
  { id: 'item_amount', label: 'Amount', type: 'number', table: 'items' },
  { id: 'total_check', label: 'Check', type: 'number', table: null },
];
const field = {
  category: 'datapoint',
  id: 'total_check',
  label: 'Check',
  type: 'number',
  ui_configuration: { type: 'formula' },
  formula: '',
};
const ids = new Set(fields.map((f) => f.id));

describe('buildFieldPrompt', () => {
  it('carries the field, the request, the schema and the formula rules', () => {
    const p = buildFieldPrompt({ request: 'Sum of line amounts', field, fields, table: null });
    expect(p).toContain('Sum of line amounts');
    expect(p).toContain('"id": "total_check"');
    expect(p).toContain('- item_amount: Amount (number, column of table items)');
    expect(p).toContain('2000');
    expect(p).toContain('last expression');
    expect(p).toContain('```json');
  });

  it('says when the field is a table column (evaluated per row)', () => {
    const p = buildFieldPrompt({
      request: 'x',
      field: { ...field, id: 'item_x' },
      fields,
      table: 'items',
    });
    expect(p).toContain('column of table items');
    expect(p).toContain('once per row');
  });
});

describe('parseFieldReply', () => {
  const opts = { selfId: 'total_check', schemaIds: ids };

  it('returns only the changes, never category or children', () => {
    const r = parseFieldReply(
      '```json\n' +
        JSON.stringify({
          formula: 'sum(field.item_amount.all_values)',
          category: 'section',
          children: [],
        }) +
        '\n```',
      opts,
    );
    expect(r).toEqual({
      ok: true,
      patch: { formula: 'sum(field.item_amount.all_values)' },
      warnings: [],
    });
  });

  it('rejects a formula that reads its own field, or is longer than 2000 characters', () => {
    expect(parseFieldReply(JSON.stringify({ formula: 'field.total_check + 1' }), opts)).toEqual({
      ok: false,
      error: 'The formula reads its own field (total_check)',
    });
    const long = parseFieldReply(JSON.stringify({ formula: 'x' + ' '.repeat(2000) }), opts);
    expect(long.ok).toBe(false);
  });

  it('warns about a renamed id and about fields the schema does not have', () => {
    const r = parseFieldReply(
      JSON.stringify({ id: 'checked_total', formula: 'field.ghost' }),
      opts,
    );
    expect(r.ok && r.warnings).toEqual([
      'This renames the field to checked_total',
      'Not in this schema: ghost',
    ]);
  });

  it('fails on a reply with nothing to change', () => {
    expect(parseFieldReply('Nothing to do.', opts)).toEqual({
      ok: false,
      error: 'Mr. Fabry did not return any field changes',
    });
    expect(parseFieldReply('```json\n{}\n```', opts)).toEqual({
      ok: false,
      error: 'Mr. Fabry did not return any field changes',
    });
  });
});
