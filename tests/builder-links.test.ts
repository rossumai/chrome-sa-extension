import { describe, it, expect } from 'vitest';
import { queueGroups, orphanSchemas } from '../src/builder/links.js';

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

describe('queueGroups with empty workspaces', () => {
  it('keeps an empty workspace unless a filter is set', () => {
    const more = [...ws, { id: 3, url: 'w/3', name: 'New' }];
    expect(queueGroups(more, qs, '').map((g) => g.ws.name)).toEqual(['AP', 'PO', 'New']);
    expect(queueGroups(more, qs, 'orders').map((g) => g.ws.name)).toEqual(['PO']);
  });
});

describe('orphanSchemas', () => {
  it('lists the schemas no queue uses, filtered by name', () => {
    expect(orphanSchemas(schemas, qs, '').map((x) => x.id)).toEqual([103]);
    expect(orphanSchemas(schemas, qs, 'nope')).toEqual([]);
  });
});
