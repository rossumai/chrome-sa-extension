import { describe, it, expect } from 'vitest';
import { placeMessages, firedRuleIds, revalidateStart } from '../src/builder/validation.js';

const ids = new Map<number, { schemaId: string; row: number }>([
  [101, { schemaId: 'doc_id', row: 0 }],
  [202, { schemaId: 'item_desc', row: 1 }],
]);

describe('placeMessages', () => {
  it('puts each message on its field and row; the rest are document-level', () => {
    const r = placeMessages(
      [
        { id: 101, type: 'error', content: 'Missing', detail: { rule_id: 4 } },
        { id: 202, type: 'warning', content: 'Odd' },
        { id: 999, type: 'info', content: 'Unknown datapoint' },
        { type: 'error', content: 'Whole document' },
      ],
      ids,
    );
    expect(r.byField.get('doc_id')!.get(0)).toEqual([
      { type: 'error', content: 'Missing', ruleId: 4 },
    ]);
    expect(r.byField.get('item_desc')!.get(1)).toEqual([
      { type: 'warning', content: 'Odd', ruleId: null },
    ]);
    expect(r.general.map((m) => m.content)).toEqual(['Unknown datapoint', 'Whole document']);
  });
});

describe('placeMessages with string ids', () => {
  it('places a message whose datapoint id comes as a string', () => {
    const r = placeMessages([{ id: '101', type: 'error', content: 'Missing' }], ids);
    expect(r.byField.get('doc_id')!.get(0)![0].content).toBe('Missing');
    expect(r.general).toEqual([]);
  });
});

describe('firedRuleIds', () => {
  it('accepts ids, rule URLs and rule objects', () => {
    expect([
      ...firedRuleIds([
        4,
        'https://x/api/v1/rules/5',
        { id: 6 },
        { url: 'https://x/api/v1/rules/7' },
        'junk',
      ]),
    ]).toEqual([4, 5, 6, 7]);
    expect(firedRuleIds(undefined).size).toBe(0);
  });
});

describe('revalidateStart', () => {
  it('starts a document in to_review, keeps one in review, refuses the rest', () => {
    expect(revalidateStart('to_review')).toEqual({ ok: true, start: true });
    expect(revalidateStart('reviewing')).toEqual({ ok: true, start: false });
    expect(revalidateStart('exported')).toEqual({
      ok: false,
      error: 'Only a document in review can be revalidated (this one is exported).',
    });
    expect(revalidateStart('')).toMatchObject({ ok: false });
  });
});
