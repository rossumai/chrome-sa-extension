import { describe, it, expect } from 'vitest';
import { queueGroups, schemaItems } from '../src/builder/links.js';

const ws = [
  { id: 1, url: 'w/1', name: 'AP' },
  { id: 2, url: 'w/2', name: 'PO' },
];
const qs = [
  { id: 10, name: 'Invoices EU', workspace: 'w/1', schema: 's/100' },
  { id: 11, name: 'Invoices US', workspace: 'w/1', schema: 's/100' },
  { id: 12, name: 'Credit notes', workspace: 'w/1', schema: 's/101' },
  { id: 20, name: 'Orders', workspace: 'w/2', schema: 's/102' },
];
const schemas = [
  { id: 103, url: 's/103', name: 'Unused' },
  { id: 102, url: 's/102', name: 'PO schema' },
  { id: 101, url: 's/101', name: 'CN schema' },
  { id: 100, url: 's/100', name: 'Invoice schema' },
];

describe('queueGroups', () => {
  it('groups queues under their workspace and filters by name', () => {
    expect(queueGroups(ws, qs, '').map((g) => [g.ws.name, g.qs.map((q) => q.id)])).toEqual([
      ['AP', [10, 11, 12]],
      ['PO', [20]],
    ]);
    expect(queueGroups(ws, qs, 'invoices').map((g) => g.qs.map((q) => q.id))).toEqual([[10, 11]]);
  });
});

describe('schemaItems', () => {
  it('orders schemas by their first visible queue and puts the rest last', () => {
    const items = schemaItems(schemas, queueGroups(ws, qs, ''));
    expect(items.map((s) => [s.id, s.queueIds])).toEqual([
      [100, [10, 11]],
      [101, [12]],
      [102, [20]],
      [103, []],
    ]);
  });

  it('lists only visible queues as links when the queue list is filtered', () => {
    const items = schemaItems(schemas, queueGroups(ws, qs, 'orders'));
    expect(items[0]).toMatchObject({ id: 102, queueIds: [20] });
    expect(items.slice(1).every((s) => s.queueIds.length === 0)).toBe(true);
  });
});
