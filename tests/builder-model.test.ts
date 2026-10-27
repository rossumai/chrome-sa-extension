import { describe, it, expect } from 'vitest';
import {
  withKeys,
  stripForSave,
  flatten,
  findByKey,
  setAttr,
  addField,
  addSection,
  setDeleted,
  move,
  dropTarget,
  newDatapoint,
  newSection,
  newList,
  newTable,
  freshKeys,
  mergeAttrs,
  movedKeys,
  nextKey,
  localErrors,
  rowStatus,
  changeSummary,
} from '../src/builder/model.js';
import { section, dp, keyOf } from './support/builder.js';

function fixture(): any[] {
  return [
    section(
      'basic_info_section',
      [
        dp('document_id', { label: 'Invoice number' }),
        dp('amount_check', {
          label: 'Total check',
          type: 'number',
          ui_configuration: { type: 'formula', edit: 'disabled' },
          formula: 'field.amount_total',
        }),
        dp('gl_hint', {
          label: 'GL hint',
          ui_configuration: { type: 'reasoning' },
          prompt: 'Guess the GL account',
          context: ['field.document_id'],
        }),
      ],
      { label: 'Basic information' },
    ),
    section(
      'line_items_section',
      [
        {
          category: 'multivalue',
          id: 'line_items',
          label: 'Line items',
          children: {
            category: 'tuple',
            id: 'line_item',
            label: 'Line item',
            children: [
              dp('item_description', { label: 'Description' }),
              dp('item_amount', { label: 'Amount', type: 'number' }),
            ],
          },
        },
      ],
      { label: 'Line items' },
    ),
  ];
}

describe('withKeys / stripForSave', () => {
  it('round-trips a schema with an object-shaped multivalue child', () => {
    const src = fixture();
    expect(stripForSave(withKeys(src))).toEqual(src);
  });

  it('assigns a unique __key to every node without mutating the input', () => {
    const src = fixture();
    const keyed = withKeys(src);
    const keys = flatten(keyed).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect((src[0] as any).__key).toBeUndefined();
  });
});

describe('flatten', () => {
  it('returns kinds and depths in document order', () => {
    const rows = flatten(withKeys(fixture()));
    expect(rows.map((r) => [r.kind, r.depth])).toEqual([
      ['section', 0],
      ['datapoint', 1],
      ['datapoint', 1],
      ['datapoint', 1],
      ['section', 0],
      ['multivalue', 1],
      ['tuple', 2],
      ['datapoint', 3],
      ['datapoint', 3],
    ]);
  });
});

describe('setAttr', () => {
  it('creates intermediate objects and leaves the original tree unchanged', () => {
    const t = withKeys(fixture());
    const k = keyOf(t, 'document_id');
    const next = setAttr(t, k, ['constraints', 'required'], true);
    expect(findByKey(next, k)!.constraints).toEqual({ required: true });
    expect(findByKey(t, k)!.constraints).toBeUndefined();
  });

  it('deletes the attribute when the value is undefined', () => {
    const t = withKeys(fixture());
    const k = keyOf(t, 'amount_check');
    expect('formula' in findByKey(setAttr(t, k, ['formula'], undefined), k)!).toBe(false);
  });

  it('edits a column inside a table', () => {
    const t = withKeys(fixture());
    const k = keyOf(t, 'item_amount');
    const next = setAttr(t, k, ['label'], 'Line total');
    expect(stripForSave(next)[1].children[0].children.children[1].label).toBe('Line total');
  });
});

describe('stripForSave cleanup', () => {
  it('keeps formula and prompt on a field whose source is not set', () => {
    const src = [
      section('s', [{ category: 'datapoint', id: 'f', formula: 'x', prompt: 'p', context: [] }]),
    ];
    expect(stripForSave(withKeys(src))).toEqual(src);
  });

  it('drops formula when the source is no longer formula', () => {
    const t = withKeys(fixture());
    const k = keyOf(t, 'amount_check');
    const out = stripForSave(setAttr(t, k, ['ui_configuration', 'type'], 'data'));
    expect('formula' in out[0].children[1]).toBe(false);
  });

  it('drops prompt and context when the source is no longer reasoning', () => {
    const t = withKeys(fixture());
    const k = keyOf(t, 'gl_hint');
    const out = stripForSave(setAttr(t, k, ['ui_configuration', 'type'], 'manual'));
    expect('prompt' in out[0].children[2]).toBe(false);
    expect('context' in out[0].children[2]).toBe(false);
  });
});

describe('add / delete / move', () => {
  it('adds a field to a section and a column to a tuple', () => {
    let t = withKeys(fixture());
    t = addField(t, keyOf(t, 'basic_info_section'), newDatapoint(nextKey(t), 'po', 'PO', 'string'));
    t = addField(t, keyOf(t, 'line_item'), newDatapoint(nextKey(t), 'qty', 'Qty', 'number'));
    const out = stripForSave(t);
    expect(out[0].children.map((c: any) => c.id)).toEqual([
      'document_id',
      'amount_check',
      'gl_hint',
      'po',
    ]);
    expect(out[1].children[0].children.children.map((c: any) => c.id)).toEqual([
      'item_description',
      'item_amount',
      'qty',
    ]);
  });

  it('newDatapoint gives enums an empty options list', () => {
    expect(newDatapoint('k', 'x', 'X', 'enum').options).toEqual([]);
    expect(newDatapoint('k', 'x', 'X', 'string').ui_configuration).toEqual({
      type: 'manual',
      edit: 'enabled',
    });
  });

  it('adds a section at the end', () => {
    const t = withKeys(fixture());
    const out = stripForSave(addSection(t, newSection(nextKey(t), 'extra_section', 'Extra')));
    expect(out[2]).toEqual({
      category: 'section',
      id: 'extra_section',
      label: 'Extra',
      children: [],
    });
  });

  it('soft-deleting a section marks every descendant deleted and drops it on save', () => {
    const t = withKeys(fixture());
    const next = setDeleted(t, keyOf(t, 'line_items_section'), true);
    const rows = flatten(next).filter((r) => r.deleted);
    expect(rows.map((r) => r.node.id)).toEqual([
      'line_items_section',
      'line_items',
      'line_item',
      'item_description',
      'item_amount',
    ]);
    expect(stripForSave(next).map((s: any) => s.id)).toEqual(['basic_info_section']);
    expect(
      flatten(setDeleted(next, keyOf(t, 'line_items_section'), false)).some((r) => r.deleted),
    ).toBe(false);
  });

  it('moves a field to another section and a section to the top', () => {
    let t = withKeys(fixture());
    t = move(t, keyOf(t, 'document_id'), keyOf(t, 'line_items_section'), 0);
    t = move(t, keyOf(t, 'line_items_section'), null, 0);
    const out = stripForSave(t);
    expect(out.map((s: any) => s.id)).toEqual(['line_items_section', 'basic_info_section']);
    expect(out[0].children[0].id).toBe('document_id');
  });
});

describe('localErrors', () => {
  it('reports a table column renamed to a header field id', () => {
    const t = withKeys(fixture());
    const next = setAttr(t, keyOf(t, 'item_amount'), ['id'], 'document_id');
    const errs = localErrors(next);
    expect(errs).toHaveLength(2);
    expect(errs[0].message).toContain('document_id');
  });

  it('ignores a duplicate that is soft-deleted', () => {
    const t = withKeys(fixture());
    let next = setAttr(t, keyOf(t, 'item_amount'), ['id'], 'document_id');
    next = setDeleted(next, keyOf(t, 'line_items_section'), true);
    expect(localErrors(next)).toEqual([]);
  });

  it('reports an empty id and an empty schema', () => {
    const t = withKeys(fixture());
    expect(localErrors(setAttr(t, keyOf(t, 'document_id'), ['id'], ''))[0].key).toBe(
      keyOf(t, 'document_id'),
    );
    let empty = setDeleted(t, keyOf(t, 'basic_info_section'), true);
    empty = setDeleted(empty, keyOf(t, 'line_items_section'), true);
    expect(localErrors(empty)).toEqual([{ key: null, message: 'The schema would be empty' }]);
  });
});

describe('rowStatus / changeSummary', () => {
  it('marks new, edited and deleted rows', () => {
    const base = withKeys(fixture());
    let work = addField(
      base,
      keyOf(base, 'basic_info_section'),
      newDatapoint(nextKey(base), 'po', 'PO', 'string'),
    );
    const newKey = keyOf(work, 'po');
    work = setAttr(work, keyOf(base, 'document_id'), ['label'], 'Doc no.');
    work = setDeleted(work, keyOf(base, 'item_amount'), true);
    const s = rowStatus(base, work);
    expect(s.get(newKey)).toBe('new');
    expect(s.get(keyOf(base, 'document_id'))).toBe('edited');
    expect(s.get(keyOf(base, 'item_amount'))).toBe('deleted');
    expect(s.get(keyOf(base, 'basic_info_section'))).toBeUndefined();
    expect(changeSummary(base, work)).toEqual({ added: 1, edited: 1, deleted: 1, moved: 0 });
  });

  it('counts a moved field as moved, not edited', () => {
    const base = withKeys(fixture());
    const work = move(base, keyOf(base, 'document_id'), keyOf(base, 'line_items_section'), 1);
    expect(changeSummary(base, work)).toEqual({ added: 0, edited: 0, deleted: 0, moved: 1 });
    expect(rowStatus(base, work).get(keyOf(base, 'document_id'))).toBeUndefined();
  });

  it('reports no changes for an untouched tree', () => {
    const base = withKeys(fixture());
    expect(changeSummary(base, base)).toEqual({ added: 0, edited: 0, deleted: 0, moved: 0 });
  });
});

describe('dropTarget', () => {
  it('places a field dropped on a header field next to it', () => {
    const t = withKeys(fixture());
    expect(dropTarget(t, keyOf(t, 'gl_hint'), keyOf(t, 'document_id'))).toEqual({
      parent: keyOf(t, 'basic_info_section'),
      index: 0,
    });
  });

  it('refuses a drop onto a deleted row', () => {
    const t = setDeleted(
      withKeys(fixture()),
      keyOf(withKeys(fixture()), 'line_items_section'),
      true,
    );
    expect(dropTarget(t, keyOf(t, 'document_id'), keyOf(t, 'line_items_section'))).toBeNull();
    expect(dropTarget(t, keyOf(t, 'document_id'), keyOf(t, 'line_items'))).toBeNull();
  });
});

describe('newList / newTable', () => {
  it('builds a list (multivalue of one datapoint) and a table (multivalue of a tuple)', () => {
    const t = withKeys(fixture());
    const [a, b] = freshKeys(t, 2);
    const list = newList([a, b], 'po_numbers', 'PO numbers');
    const [c, d, e] = freshKeys(t, 3);
    const table = newTable([c, d, e], 'items', 'Items');
    let next = addField(t, keyOf(t, 'basic_info_section'), list);
    next = addField(next, keyOf(t, 'basic_info_section'), table);
    const out = stripForSave(next)[0].children;
    expect(out[3]).toMatchObject({
      category: 'multivalue',
      id: 'po_numbers',
      children: { category: 'datapoint', id: 'po_numbers_value', type: 'string' },
    });
    expect(out[4]).toMatchObject({
      category: 'multivalue',
      id: 'items',
      children: {
        category: 'tuple',
        id: 'items_row',
        children: [{ category: 'datapoint', id: 'items_column', type: 'string' }],
      },
    });
    expect(Array.isArray(out[3].children)).toBe(false);
  });

  it('freshKeys returns keys unused in the tree and unique among themselves', () => {
    const t = withKeys(fixture());
    const ks = freshKeys(t, 3);
    const used = new Set(flatten(t).map((r) => r.key));
    expect(new Set(ks).size).toBe(3);
    expect(ks.some((k) => used.has(k))).toBe(false);
  });
});

describe('mergeAttrs', () => {
  it('deep-merges objects, replaces arrays, deletes on null, and keeps the key', () => {
    const t = withKeys([
      section('s', [
        {
          category: 'datapoint',
          id: 'x',
          constraints: { required: false, length: { max: 5 } },
          rir_field_names: ['a'],
          default_value: '1',
        },
      ]),
    ]);
    const k = flatten(t)[1].key;
    const next = mergeAttrs(t, k, {
      constraints: { required: true },
      rir_field_names: ['b'],
      default_value: null,
    });
    const n = findByKey(next, k)!;
    expect(n.constraints).toEqual({ required: true, length: { max: 5 } });
    expect(n.rir_field_names).toEqual(['b']);
    expect('default_value' in n).toBe(false);
    expect(n.__key).toBe(k);
  });
});

describe('movedKeys', () => {
  it('names the rows that moved (the same rule changeSummary counts by)', () => {
    const base = withKeys(fixture());
    const work = move(base, keyOf(base, 'document_id'), keyOf(base, 'line_items_section'), 1);
    expect([...movedKeys(base, work)]).toEqual([keyOf(base, 'document_id')]);
    expect(movedKeys(base, base).size).toBe(0);
  });
});
