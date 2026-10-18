import { describe, it, expect, vi } from 'vitest';
import { saveSchema, mapValidateErrors, landedDiff } from '../src/builder/save.js';
import { withKeys, flatten, setAttr, setDeleted, stripForSave } from '../src/builder/model.js';

function fixture(): any[] {
  return [
    {
      category: 'section',
      id: 'a_section',
      label: 'A',
      children: [{ category: 'datapoint', id: 'x', label: 'X', type: 'string' }],
    },
    {
      category: 'section',
      id: 'b_section',
      label: 'B',
      children: [
        { category: 'datapoint', id: 'y', label: 'Y', type: 'string' },
        { category: 'datapoint', id: 'z', label: 'Z', type: 'string' },
      ],
    },
  ];
}
const keyOf = (nodes: any[], id: string) => flatten(nodes).find((r) => r.node.id === id)!.key;

function deps(over: Record<string, any> = {}) {
  return {
    getSchema: vi.fn(async () => ({ id: 7, modified_at: 't0', content: fixture() })),
    validateSchema: vi.fn(async () => ({})),
    patchSchema: vi.fn(async () => ({ id: 7 })),
    ...over,
  };
}

describe('mapValidateErrors', () => {
  it('maps a positional error to the right node', () => {
    const work = withKeys(fixture());
    const errs = mapValidateErrors(
      { content: [{}, { children: { '1': { label: ['bad'] } } }] },
      work,
    );
    expect(errs).toEqual([{ key: keyOf(work, 'z'), message: 'label: bad' }]);
  });

  it('skips soft-deleted nodes when aligning positions', () => {
    const work = setDeleted(withKeys(fixture()), 'k1', true);
    const errs = mapValidateErrors({ content: [{ children: { '1': { label: ['bad'] } } }] }, work);
    expect(errs).toEqual([{ key: keyOf(work, 'z'), message: 'label: bad' }]);
  });

  it('walks into a multivalue object child and nested attributes', () => {
    const work = withKeys([
      {
        category: 'section',
        id: 's',
        label: 'S',
        children: [
          {
            category: 'multivalue',
            id: 'm',
            children: {
              category: 'tuple',
              id: 't',
              children: [{ category: 'datapoint', id: 'c' }],
            },
          },
        ],
      },
    ]);
    const tree = {
      content: [
        {
          children: {
            '0': { children: { children: { '0': { constraints: { required: ['nope'] } } } } },
          },
        },
      ],
    };
    expect(mapValidateErrors(tree, work)).toEqual([
      { key: keyOf(work, 'c'), message: 'constraints.required: nope' },
    ]);
  });

  it('returns a key-less error for a shape it cannot place', () => {
    expect(mapValidateErrors({ non_field_errors: ['broken'] }, withKeys(fixture()))).toEqual([
      { key: null, message: 'non_field_errors: broken' },
    ]);
  });
});

describe('landedDiff', () => {
  it('ignores defaults the API injects but reports a dropped key', () => {
    const sent = [{ category: 'section', id: 's', children: [{ id: 'x', labell: 'typo' }] }];
    const got = [
      {
        category: 'section',
        id: 's',
        icon: null,
        children: [{ id: 'x', rir_field_names: [], default_value: null }],
      },
    ];
    expect(landedDiff(sent, got)).toEqual(['[0].children[0].labell']);
  });
});

describe('saveSchema', () => {
  it('stops on a local error before calling validate', async () => {
    const t = withKeys(fixture());
    const work = setAttr(t, keyOf(t, 'z'), ['id'], 'x');
    const d = deps();
    const r = await saveSchema({ schemaId: 7, baseModifiedAt: 't0', work, force: false }, d);
    expect(r).toMatchObject({ ok: false, stage: 'local' });
    expect(d.validateSchema).not.toHaveBeenCalled();
  });

  it('stops on validate errors without patching', async () => {
    const work = withKeys(fixture());
    const d = deps({
      validateSchema: vi.fn(async () => ({
        content: [{}, { children: { '1': { label: ['bad'] } } }],
      })),
    });
    const r = await saveSchema({ schemaId: 7, baseModifiedAt: 't0', work, force: false }, d);
    expect(r).toEqual({
      ok: false,
      stage: 'validate',
      errors: [{ key: keyOf(work, 'z'), message: 'label: bad' }],
    });
    expect(d.patchSchema).not.toHaveBeenCalled();
  });

  it('reports a stale schema unless forced', async () => {
    const work = withKeys(fixture());
    const d = deps({
      getSchema: vi.fn(async () => ({ id: 7, modified_at: 't1', content: fixture() })),
    });
    const r = await saveSchema({ schemaId: 7, baseModifiedAt: 't0', work, force: false }, d);
    expect(r).toMatchObject({ ok: false, stage: 'stale' });
    const forced = await saveSchema({ schemaId: 7, baseModifiedAt: 't0', work, force: true }, d);
    expect(forced.ok).toBe(true);
  });

  it('patches the stripped content and returns the re-fetched schema', async () => {
    const t = withKeys(fixture());
    const work = setAttr(t, keyOf(t, 'x'), ['label'], 'X2');
    const landed = { id: 7, modified_at: 't2', content: stripForSave(work) };
    const getSchema = vi
      .fn()
      .mockResolvedValueOnce({ id: 7, modified_at: 't0', content: fixture() })
      .mockResolvedValueOnce(landed);
    const d = deps({ getSchema });
    const r = await saveSchema({ schemaId: 7, baseModifiedAt: 't0', work, force: false }, d);
    expect(d.patchSchema).toHaveBeenCalledWith(7, stripForSave(work));
    expect(r).toEqual({ ok: true, schema: landed, warnings: [] });
  });

  it('lets a 429 propagate', async () => {
    const err = Object.assign(new Error('slow'), { status: 429 });
    const d = deps({ validateSchema: vi.fn(async () => Promise.reject(err)) });
    await expect(
      saveSchema({ schemaId: 7, baseModifiedAt: 't0', work: withKeys(fixture()), force: false }, d),
    ).rejects.toBe(err);
  });

  it('a failed re-fetch after a successful PATCH still reports success', async () => {
    const getSchema = vi
      .fn()
      .mockResolvedValueOnce({ id: 7, modified_at: 't0', content: fixture() })
      .mockRejectedValueOnce(new Error('network'));
    const patched = { id: 7, modified_at: 't2', content: fixture() };
    const d = deps({ getSchema, patchSchema: vi.fn(async () => patched) });
    const r = await saveSchema(
      { schemaId: 7, baseModifiedAt: 't0', work: withKeys(fixture()), force: false },
      d,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.schema).toBe(patched);
      expect(r.warnings[0]).toContain('could not be re-read');
    }
  });
});
