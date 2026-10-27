import { describe, it, expect, vi } from 'vitest';
import {
  saveSchema,
  mapValidateErrors,
  landedDiff,
  errorsByRow,
  type SaveDeps,
} from '../src/builder/save.js';
import { withKeys, setAttr, setDeleted, stripForSave } from '../src/builder/model.js';
import { section, dp, keyOf } from './support/builder.js';
import { rateLimitError } from '../src/net/rateLimit.js';

function fixture(): any[] {
  return [
    section('a_section', [dp('x', { label: 'X' })], { label: 'A' }),
    section('b_section', [dp('y', { label: 'Y' }), dp('z', { label: 'Z' })], { label: 'B' }),
  ];
}

function deps(over: Partial<SaveDeps> = {}) {
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
      section(
        's',
        [
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
        { label: 'S' },
      ),
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
    expect(d.validateSchema).not.toHaveBeenCalled();
    expect(d.patchSchema).not.toHaveBeenCalled();
    const forced = await saveSchema({ schemaId: 7, baseModifiedAt: 't0', work, force: true }, d);
    expect(forced.ok).toBe(true);
  });

  it('runs beforeWrite after the stale check, and stops when it fails', async () => {
    const work = withKeys(fixture());
    const failed = { ok: false as const, stage: 'engine' as const, errors: [] };
    const beforeWrite = vi.fn(async () => failed);
    const stale = deps({ getSchema: vi.fn(async () => ({ id: 7, modified_at: 't1' })) });
    const args = { schemaId: 7, baseModifiedAt: 't0', work, force: false, beforeWrite };
    expect(await saveSchema(args, stale)).toMatchObject({ stage: 'stale' });
    expect(beforeWrite).not.toHaveBeenCalled();
    const d = deps();
    expect(await saveSchema(args, d)).toBe(failed);
    expect(d.getSchema).toHaveBeenCalledTimes(1);
    expect(d.validateSchema).not.toHaveBeenCalled();
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

  it('lets a 429 on the PATCH propagate', async () => {
    const err = rateLimitError({}, 'slow');
    const d = deps({ patchSchema: vi.fn(async () => Promise.reject(err)) });
    await expect(
      saveSchema({ schemaId: 7, baseModifiedAt: 't0', work: withKeys(fixture()), force: false }, d),
    ).rejects.toBe(err);
  });

  it('reports any other PATCH failure as the patch stage', async () => {
    const d = deps({ patchSchema: vi.fn(async () => Promise.reject(new Error('conflict'))) });
    const r = await saveSchema(
      { schemaId: 7, baseModifiedAt: 't0', work: withKeys(fixture()), force: false },
      d,
    );
    expect(r).toEqual({ ok: false, stage: 'patch', errors: [{ key: null, message: 'conflict' }] });
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

  it('sends a staged rename with the content, and omits the name when unchanged', async () => {
    const work = withKeys(fixture());
    const d = deps();
    await saveSchema(
      { schemaId: 7, baseModifiedAt: 't0', work, force: false, name: 'Renamed', baseName: 'Old' },
      d,
    );
    expect(d.patchSchema).toHaveBeenCalledWith(7, stripForSave(work), 'Renamed');
    const d2 = deps();
    await saveSchema(
      { schemaId: 7, baseModifiedAt: 't0', work, force: false, name: 'Old', baseName: 'Old' },
      d2,
    );
    expect(d2.patchSchema).toHaveBeenCalledWith(7, stripForSave(work));
  });

  it('refuses an empty schema name', async () => {
    const d = deps();
    const r = await saveSchema(
      {
        schemaId: 7,
        baseModifiedAt: 't0',
        work: withKeys(fixture()),
        force: false,
        name: '  ',
        baseName: 'Old',
      },
      d,
    );
    expect(r).toEqual({
      ok: false,
      stage: 'local',
      errors: [{ key: null, message: 'Schema name is empty' }],
    });
  });
});

describe('errorsByRow', () => {
  it('groups messages per row and keeps the rest general', () => {
    const r = errorsByRow([
      { key: 'k1', message: 'a' },
      { key: null, message: 'b' },
      { key: 'k1', message: 'c' },
    ]);
    expect(r.byRow).toEqual(new Map([['k1', ['a', 'c']]]));
    expect(r.general).toEqual(['b']);
  });
});
