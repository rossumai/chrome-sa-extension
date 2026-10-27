// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { withKeys, setAttr, setDeleted } from '../src/builder/model.js';
import { resetBuilderGlue, section, dp, keyOf } from './support/builder.js';
import * as api from '../src/builder/api.js';
import {
  openQueue,
  openEnginePanel,
  toggleEngineDelete,
  save,
  renameSchema,
  undoChange,
  apply,
} from '../src/builder/index.jsx';

vi.mock('../src/builder/api.js');
vi.mock('../src/agent/agentApi.js');

beforeEach(resetBuilderGlue);

describe('save', () => {
  it('shows landed-diff warnings in the banner', async () => {
    const content = [section('s')];
    store.schema.value = { id: 7, modified_at: 't0', content };
    store.startDraft('Invoices', withKeys(content));
    vi.mocked(api.getSchema)
      .mockResolvedValueOnce({ id: 7, modified_at: 't0', content })
      .mockResolvedValueOnce({
        id: 7,
        modified_at: 't1',
        content: [{ ...content[0], label: 'X' }],
      });
    vi.mocked(api.validateSchema).mockResolvedValue({});
    vi.mocked(api.patchSchema).mockResolvedValue({});
    await save();
    expect(store.generalErrors.value.join(' ')).toContain('[0].label');
  });
});

describe('save renumbers row keys', () => {
  it('keeps the selected field and forgets the rows Mr. Fabry touched', async () => {
    const content = [section('s', [dp('a'), dp('b')])];
    const saved = [section('s', [dp('b')])];
    store.schema.value = { id: 7, modified_at: 't0', content };
    store.startDraft('S', withKeys(content));
    apply(setDeleted(store.work.value, keyOf(store.work.value, 'a'), true));
    store.selectedKey.value = keyOf(store.work.value, 'b');
    store.fabryTouched.value = new Set([keyOf(store.work.value, 'b')]);
    vi.mocked(api.getSchema)
      .mockResolvedValueOnce({ id: 7, modified_at: 't0', content })
      .mockResolvedValueOnce({ id: 7, modified_at: 't1', content: saved });
    vi.mocked(api.validateSchema).mockResolvedValue({});
    vi.mocked(api.patchSchema).mockResolvedValue({});
    await save();
    expect(store.selectedKey.value).toBe(keyOf(store.work.value, 'b'));
    expect(store.fabryTouched.value.size).toBe(0);
  });
});

describe('custom engine', () => {
  const ENGINE = 'https://x/api/v1/engines/5';
  const content = () => [section('s', [dp('doc_id', { label: 'Doc' }), dp('po', { label: 'PO' })])];
  const calls: string[] = [];
  beforeEach(async () => {
    calls.length = 0;
    store.queues.value = [
      {
        id: 3,
        name: 'C',
        schema: 'https://x/api/v1/schemas/33',
        engine: ENGINE,
        generic_engine: null,
      },
    ];
    vi.mocked(api.get).mockResolvedValue({ id: 5, url: ENGINE, name: 'Invoices engine' });
    vi.mocked(api.listEngineFields).mockImplementation(async () => {
      calls.push('list');
      return [{ id: 1, name: 'doc_id', type: 'string', pre_trained_field_id: 'document_id' }];
    });
    vi.mocked(api.listPreTrainedFields).mockResolvedValue([
      { name: 'document_id', type: 'string' },
    ]);
    vi.mocked(api.createEngineField).mockImplementation(async (b: any) => {
      calls.push(`create ${b.name}`);
      return {};
    });
    vi.mocked(api.validateSchema).mockImplementation(async () => {
      calls.push('validate');
      return {};
    });
    vi.mocked(api.patchSchema).mockImplementation(async () => {
      calls.push('patch schema');
      return {};
    });
    vi.mocked(api.getSchema).mockImplementation(async () => {
      calls.push('get schema');
      return { id: 33, name: 'Invoices', modified_at: 't0', content: content() };
    });
    await openQueue(3);
    await new Promise((r) => setTimeout(r));
    calls.length = 0;
  });

  it('loads the engine and its fields with the queue', () => {
    expect(store.engineState.value).toMatchObject({ kind: 'custom', engine: { id: 5 } });
    expect(store.engineState.value!.fields.map((f) => f.name)).toEqual(['doc_id']);
    expect(store.engineCatalog.value.map((c) => c.name)).toEqual(['document_id']);
  });

  it('a field without an engine field makes the schema dirty; Save creates it first', async () => {
    expect(store.engineChanges.value).toBe(1);
    expect(store.dirty.value).toBe(true);
    await save();
    expect(calls).toEqual([
      'get schema',
      'create po',
      'list',
      'validate',
      'patch schema',
      'get schema',
    ]);
  });

  it('a stale schema stops before any engine write; Save anyway goes on in order', async () => {
    vi.mocked(api.getSchema).mockImplementation(async () => {
      calls.push('get schema');
      return { id: 33, name: 'Invoices', modified_at: 't1', content: content() };
    });
    const r = await save();
    expect(r).toMatchObject({ ok: false, stage: 'stale' });
    expect(calls).toEqual(['get schema']);
    calls.length = 0;
    await save(true);
    expect(calls).toEqual([
      'get schema',
      'create po',
      'list',
      'validate',
      'patch schema',
      'get schema',
    ]);
  });

  it('stops before any call when the API would reject the schema', async () => {
    const key = keyOf(store.work.value, 'doc_id');
    apply(setAttr(store.work.value, key, ['rir_field_names'], ['document_id']));
    const r = await save();
    expect(r).toMatchObject({ ok: false, stage: 'local' });
    expect(calls).toEqual([]);
    expect(store.rowErrors.value.get(key)?.[0]).toContain('must be empty');
  });

  it('an empty schema name stops before any engine field is written', async () => {
    renameSchema('');
    const r = await save();
    expect(r).toMatchObject({ ok: false, stage: 'local' });
    expect(calls).toEqual([]);
  });

  it('the engine panel reads the other queues on the engine, skipping a shared schema', async () => {
    store.queues.value = [
      ...store.queues.value,
      { id: 4, name: 'Shared', schema: 'https://x/api/v1/schemas/33', engine: ENGINE },
      { id: 6, name: 'Credit notes', schema: 'https://x/api/v1/schemas/66', engine: ENGINE },
      { id: 7, name: 'Other engine', schema: 'https://x/api/v1/schemas/77', engine: 'e/9' },
    ];
    vi.mocked(api.getSchema).mockClear();
    vi.mocked(api.getSchema).mockResolvedValueOnce({
      id: 66,
      content: [
        section('s', [dp('old_po'), dp('calc', { ui_configuration: { type: 'formula' } })]),
      ],
    });
    openEnginePanel();
    await new Promise((r) => setTimeout(r));
    expect(api.getSchema).toHaveBeenCalledTimes(1);
    expect(api.getSchema).toHaveBeenCalledWith(66);
    const byName = store.engineUsers.value!.byName!;
    expect(byName.get('old_po')).toEqual(['Credit notes (6)']);
    expect(byName.has('calc')).toBe(false); // a formula does not use an engine field
  });

  it('Save deletes a marked engine field after the schema', async () => {
    vi.mocked(api.listEngineFields).mockImplementation(async () => {
      calls.push('list');
      return [
        { id: 1, name: 'doc_id', type: 'string', pre_trained_field_id: 'document_id' },
        { id: 9, name: 'gone', type: 'string', pre_trained_field_id: null },
      ];
    });
    vi.mocked(api.deleteEngineField).mockImplementation(async (id: number) => {
      calls.push(`delete ${id}`);
      return null;
    });
    store.engineState.value = {
      ...store.engineState.value!,
      fields: await api.listEngineFields(5),
    };
    store.engineUsers.value = { byName: new Map(), error: null };
    toggleEngineDelete(9);
    calls.length = 0;
    await save();
    expect(calls).toEqual([
      'get schema',
      'create po',
      'list',
      'validate',
      'patch schema',
      'get schema',
      'delete 9',
      'list',
    ]);
    expect(store.engineDeletes.value.size).toBe(0);
  });

  it('a failed delete after the schema landed is shown, and its mark kept', async () => {
    const fields = [
      { id: 1, name: 'doc_id', type: 'string', pre_trained_field_id: 'document_id' },
      { id: 9, name: 'gone', type: 'string', pre_trained_field_id: null },
    ];
    vi.mocked(api.listEngineFields).mockResolvedValue(fields);
    vi.mocked(api.deleteEngineField).mockRejectedValueOnce(new Error('still used'));
    store.engineState.value = { ...store.engineState.value!, fields };
    store.engineUsers.value = { byName: new Map(), error: null };
    toggleEngineDelete(9);
    const r = await save();
    expect(r).toMatchObject({ ok: true });
    expect([...store.engineDeletes.value]).toEqual([9]);
    expect(store.generalErrors.value).toContain('Engine fields: still used');
  });

  it('a failed schema PATCH deletes nothing and keeps the delete marks', async () => {
    store.engineState.value = {
      ...store.engineState.value!,
      fields: [
        ...store.engineState.value!.fields,
        { id: 9, name: 'gone', type: 'string', pre_trained_field_id: null },
      ],
    };
    store.engineUsers.value = { byName: new Map(), error: null };
    toggleEngineDelete(9);
    vi.mocked(api.patchSchema).mockRejectedValueOnce(
      Object.assign(new Error('conflict'), { status: 409 }),
    );
    const r = await save();
    expect(r).toMatchObject({ ok: false, stage: 'patch' });
    expect(api.deleteEngineField).not.toHaveBeenCalled();
    expect([...store.engineDeletes.value]).toEqual([9]);
  });

  it('a failed engine-field write stops before the schema save', async () => {
    vi.mocked(api.createEngineField).mockRejectedValueOnce(new Error('type is invalid'));
    const r = await save();
    expect(r).toMatchObject({ ok: false, stage: 'engine' });
    expect(calls).not.toContain('validate');
    expect(store.generalErrors.value.join(' ')).toContain('Engine fields: type is invalid');
  });
});

describe('renameSchema', () => {
  it('stages the name as one undoable edit, and Save updates the schema list', async () => {
    const content = [section('s')];
    store.schema.value = { id: 7, name: 'Invoices', modified_at: 't0', content };
    store.schemas.value = [{ id: 7, url: 'https://x/api/v1/schemas/7', name: 'Invoices' }];
    store.startDraft('Invoices', withKeys(content));
    renameSchema('Invoices v2');
    expect(store.draftName.value).toBe('Invoices v2');
    expect(store.dirty.value).toBe(true);
    undoChange();
    expect(store.draftName.value).toBe('Invoices');
    expect(store.dirty.value).toBe(false);
    renameSchema('Invoices v2');
    vi.mocked(api.getSchema)
      .mockResolvedValueOnce({ id: 7, name: 'Invoices', modified_at: 't0', content })
      .mockResolvedValueOnce({ id: 7, name: 'Invoices v2', modified_at: 't1', content });
    vi.mocked(api.validateSchema).mockResolvedValue({});
    vi.mocked(api.patchSchema).mockResolvedValue({});
    await save();
    expect(api.patchSchema).toHaveBeenLastCalledWith(7, content, 'Invoices v2');
    expect(store.schemas.value[0].name).toBe('Invoices v2');
    expect(store.dirty.value).toBe(false);
  });
});
