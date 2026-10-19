import { describe, it, expect } from 'vitest';
import { withKeys, flatten } from '../src/builder/model.js';
import { visibleKeys } from '../src/builder/fieldFilter.js';

const tree = withKeys([
  {
    category: 'section',
    id: 'basic_section',
    label: 'Basic',
    children: [
      { category: 'datapoint', id: 'document_id', label: 'Invoice number' },
      { category: 'datapoint', id: 'date_issue', label: 'Issue date' },
    ],
  },
  {
    category: 'section',
    id: 'items_section',
    label: 'Line items',
    children: [
      {
        category: 'multivalue',
        id: 'line_items',
        label: 'Items',
        children: {
          category: 'tuple',
          id: 'line_item',
          label: 'Item',
          children: [
            { category: 'datapoint', id: 'item_amount', label: 'Amount' },
            { category: 'datapoint', id: 'item_code', label: 'Code' },
          ],
        },
      },
    ],
  },
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
