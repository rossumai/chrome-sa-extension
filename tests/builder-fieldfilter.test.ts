import { describe, it, expect } from 'vitest';
import { withKeys, flatten } from '../src/builder/model.js';
import { visibleKeys } from '../src/builder/fieldFilter.js';
import { section, dp } from './support/builder.js';

const tree = withKeys([
  section(
    'basic_section',
    [dp('document_id', { label: 'Invoice number' }), dp('date_issue', { label: 'Issue date' })],
    { label: 'Basic' },
  ),
  section(
    'items_section',
    [
      {
        category: 'multivalue',
        id: 'line_items',
        label: 'Items',
        children: {
          category: 'tuple',
          id: 'line_item',
          label: 'Item',
          children: [dp('item_amount', { label: 'Amount' }), dp('item_code', { label: 'Code' })],
        },
      },
    ],
    { label: 'Line items' },
  ),
]);
const ids = (keys: Set<string> | null) =>
  keys === null
    ? null
    : flatten(tree)
        .filter((r) => keys.has(r.key))
        .map((r) => r.node.id);

describe('visibleKeys', () => {
  it('is null for an empty query (show everything)', () => {
    expect(visibleKeys(tree, '  ')).toBeNull();
  });

  it('matches id or label case-insensitively and keeps the ancestors', () => {
    expect(ids(visibleKeys(tree, 'ISSUE'))).toEqual(['basic_section', 'date_issue']);
    expect(ids(visibleKeys(tree, 'amount'))).toEqual([
      'items_section',
      'line_items',
      'line_item',
      'item_amount',
    ]);
  });

  it('a matching container shows everything inside it', () => {
    expect(ids(visibleKeys(tree, 'line items'))).toEqual([
      'items_section',
      'line_items',
      'line_item',
      'item_amount',
      'item_code',
    ]);
  });

  it('returns an empty set when nothing matches', () => {
    expect(visibleKeys(tree, 'zzz')!.size).toBe(0);
  });
});

describe('visibleKeys with a rule', () => {
  it("shows only the rule's fields with their parents, and narrows further by text", () => {
    expect(ids(visibleKeys(tree, '', new Set(['item_amount', 'document_id'])))).toEqual([
      'basic_section',
      'document_id',
      'items_section',
      'line_items',
      'line_item',
      'item_amount',
    ]);
    expect(ids(visibleKeys(tree, 'amount', new Set(['item_amount', 'document_id'])))).toEqual([
      'items_section',
      'line_items',
      'line_item',
      'item_amount',
    ]);
    expect(visibleKeys(tree, '', null)).toBeNull();
  });
});

describe('visibleKeys in rule mode (union)', () => {
  it("shows the rule's fields plus whatever the text matches", () => {
    expect(ids(visibleKeys(tree, '', new Set(['document_id']), 'or'))).toEqual([
      'basic_section',
      'document_id',
    ]);
    expect(ids(visibleKeys(tree, 'code', new Set(['document_id']), 'or'))).toEqual([
      'basic_section',
      'document_id',
      'items_section',
      'line_items',
      'line_item',
      'item_code',
    ]);
  });
});
