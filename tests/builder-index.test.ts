// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { withKeys, flatten, setAttr, setDeleted } from '../src/builder/model.js';
import {
  resetBuilderStore,
  section,
  dp,
  keyOf,
  rowOf,
  fabryReply,
  heldFabryReply,
} from './support/builder.js';

vi.mock('../src/builder/api.js', () => ({
  getSchema: vi.fn(),
  validateSchema: vi.fn(),
  patchSchema: vi.fn(),
  getAnnotationContent: vi.fn(),
  listAnnotations: vi.fn(),
  listRules: vi.fn(async () => []),
  listHooks: vi.fn(async () => []),
  patchHookSettings: vi.fn(),
  getHook: vi.fn(),
  getRule: vi.fn(),
  getAnnotation: vi.fn(),
  startAnnotation: vi.fn(async () => ({})),
  validateAnnotation: vi.fn(),
  cancelAnnotation: vi.fn(async () => ({})),
  createRule: vi.fn(),
  patchRule: vi.fn(),
  listWorkspaces: vi.fn(async () => []),
  listQueues: vi.fn(async () => []),
  listSchemas: vi.fn(async () => []),
  createWorkspace: vi.fn(),
  createSchema: vi.fn(),
  createQueue: vi.fn(),
  deleteQueue: vi.fn(),
  deleteSchema: vi.fn(),
  get: vi.fn(),
  listEngineFields: vi.fn(async () => []),
  listPreTrainedFields: vi.fn(async () => []),
  createEngineField: vi.fn(async () => ({})),
  patchEngineField: vi.fn(async () => ({})),
  deleteEngineField: vi.fn(async () => null),
  evaluateRules: vi.fn(),
}));
vi.mock('../src/agent/agentApi.js', () => ({
  createChat: vi.fn(async () => 'chat-9'),
  streamMessage: vi.fn(),
}));
import * as agentApi from '../src/agent/agentApi.js';
import * as api from '../src/builder/api.js';
import {
  openQueue,
  openSchema,
  createWorkspace,
  createQueue,
  deleteQueue,
  deleteSchema,
  createUnlinkedSchema,
  openRuleEditor,
  updateRuleDraft,
  saveRule,
  closeRuleEditor,
  askRuleAssistant,
  discardRule,
  askFieldAssistant,
  openSchemaFabry,
  askSchemaFabry,
  fixWithFabry,
  openHookEditor,
  openEnginePanel,
  toggleEngineDelete,
  scheduleRuleEval,
  updateHookDraft,
  saveHook,
  discardHook,
  askHookAssistant,
  revalidate,
  save,
  pickAnnotation,
  renameSchema,
  undoChange,
  apply,
} from '../src/builder/index.jsx';

beforeEach(() => {
  vi.resetAllMocks();
  resetBuilderStore();
  store.queues.value = [
    { id: 1, name: 'A', schema: 'https://x/api/v1/schemas/11' },
    { id: 2, name: 'B', schema: 'https://x/api/v1/schemas/22' },
  ];
});

describe('openQueue', () => {
  it('ignores a schema response that arrives after a newer queue was opened', async () => {
    let releaseA: (v: any) => void = () => {};
    vi.mocked(api.getSchema).mockImplementation((id: number) =>
      id === 11
        ? new Promise((r) => (releaseA = r))
        : Promise.resolve({ id: 22, content: [section('b_section')] }),
    );
    const a = openQueue(1);
    await openQueue(2);
    releaseA({ id: 11, content: [section('a_section')] });
    await a;
    expect(store.selectedQueueId.value).toBe(2);
    expect(store.schema.value.id).toBe(22);
  });
});

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

describe('pickAnnotation', () => {
  it('reads the id out of a pasted Rossum URL and loads its values', async () => {
    vi.mocked(api.getAnnotationContent).mockResolvedValue({
      content: [{ category: 'datapoint', schema_id: 'doc_id', content: { value: 'INV-9' } }],
    });
    await pickAnnotation('https://example.rossum.app/document/4242');
    expect(api.getAnnotationContent).toHaveBeenCalledWith(4242);
    expect(store.annotationId.value).toBe(4242);
    expect(store.values.value!.values.get('doc_id')).toEqual(['INV-9']);
  });

  it('a failed load leaves no content from the previous annotation', async () => {
    store.annotationId.value = 1;
    store.annotationContent.value = [{ category: 'section', schema_id: 'old', children: [] }];
    vi.mocked(api.getAnnotationContent).mockRejectedValue(new Error('gone'));
    await pickAnnotation('2');
    expect(store.annotationId.value).toBe(2);
    expect(store.annotationContent.value).toEqual([]);
    expect(store.annotationError.value).toBe('gone');
  });

  it('rejects input that is not an annotation id or URL', async () => {
    vi.mocked(api.getAnnotationContent).mockClear();
    await pickAnnotation('hello');
    expect(store.annotationError.value).toBe('Not an annotation ID or URL');
    expect(api.getAnnotationContent).not.toHaveBeenCalled();
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

describe('openSchema / annotation labels', () => {
  it('opens a schema no queue uses', async () => {
    vi.mocked(api.getSchema).mockResolvedValue({ id: 33, name: 'Orphan', content: [section('s')] });
    await openSchema(33);
    expect(api.getSchema).toHaveBeenCalledWith(33);
    expect(store.selectedQueueId.value).toBeNull();
    expect(store.selectedSchemaId.value).toBe(33);
    expect(store.draftName.value).toBe('Orphan');
  });

  it('labels annotations as file name (id) · status', async () => {
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: [section('b')] });
    vi.mocked(api.listAnnotations).mockResolvedValue({
      results: [
        { id: 5, status: 'to_review', document: 'd/1' },
        { id: 6, status: 'exported', document: 'd/2' },
      ],
      documents: [{ url: 'd/1', original_file_name: 'invoice.pdf' }],
    });
    await openQueue(2);
    await vi.waitFor(() => expect(store.annotations.value.length).toBe(2));
    expect(store.annotations.value.map((a) => a.label)).toEqual([
      'invoice.pdf (5) · to_review',
      'annotation (6) · exported',
    ]);
  });
});

describe('create and delete', () => {
  beforeEach(() => {
    for (const f of [
      'createWorkspace',
      'createSchema',
      'createQueue',
      'deleteQueue',
      'deleteSchema',
    ] as const) {
      vi.mocked(api[f]).mockReset();
    }
    vi.mocked(api.getSchema).mockResolvedValue({ id: 99, content: [section('x')] });
    store.workspaces.value = [{ id: 10, url: 'w/10', name: 'AP', organization: 'o/1' }];
  });

  it('creates a workspace in the organization of the existing ones', async () => {
    vi.mocked(api.createWorkspace).mockResolvedValue({ id: 11 });
    await createWorkspace('PO');
    expect(api.createWorkspace).toHaveBeenCalledWith('PO', 'o/1');
  });

  it('a queue with a copied schema creates the schema from the SAVED content first', async () => {
    store.schema.value = { id: 7, name: 'Inv', url: 's/7', content: [section('saved')] };
    store.startDraft('Inv', withKeys([section('saved')]));
    vi.mocked(api.createSchema).mockResolvedValue({ id: 70, url: 's/70' });
    vi.mocked(api.createQueue).mockResolvedValue({ id: 5, schema: 's/70' });
    await createQueue({ name: 'Inv 2', workspaceUrl: 'w/10', mode: 'copy' });
    expect(api.createSchema).toHaveBeenCalledWith('Inv 2', [section('saved')]);
    expect(api.createQueue).toHaveBeenCalledWith('Inv 2', 'w/10', 's/70');
  });

  it('a queue sharing a schema creates no schema', async () => {
    vi.mocked(api.createQueue).mockResolvedValue({ id: 5, schema: 's/7' });
    await createQueue({ name: 'Inv 3', workspaceUrl: 'w/10', mode: 'share', schemaUrl: 's/7' });
    expect(api.createSchema).not.toHaveBeenCalled();
    expect(api.createQueue).toHaveBeenCalledWith('Inv 3', 'w/10', 's/7');
  });

  it('a queue with an empty schema gets one empty section', async () => {
    vi.mocked(api.createSchema).mockResolvedValue({ id: 71, url: 's/71' });
    vi.mocked(api.createQueue).mockResolvedValue({ id: 6, schema: 's/71' });
    await createQueue({ name: 'Fresh', workspaceUrl: 'w/10', mode: 'empty' });
    expect(api.createSchema).toHaveBeenCalledWith('Fresh', [
      { category: 'section', id: 'basic_info_section', label: 'Basic information', children: [] },
    ]);
  });

  it('deleting a queue asks first, then deletes and clears it when it was open', async () => {
    store.queues.value = [{ id: 1, name: 'A', schema: 's/7' }];
    store.selectedQueueId.value = 1;
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await deleteQueue(1);
    expect(api.deleteQueue).not.toHaveBeenCalled();
    ask.mockReturnValueOnce(true);
    await deleteQueue(1);
    expect(ask.mock.calls[1][0]).toContain('A (1)');
    expect(api.deleteQueue).toHaveBeenCalledWith(1);
    expect(store.selectedQueueId.value).toBeNull();
    ask.mockRestore();
  });

  it('deleting the open queue closes everything that belonged to it', async () => {
    store.queues.value = [{ id: 1, name: 'A', schema: 's/7' }];
    store.selectedQueueId.value = 1;
    store.rules.value = [{ id: 4, name: 'R', trigger_condition: 'field.a', actions: [] }];
    store.hooks.value = [{ id: 7, name: 'H', settings: {} }];
    store.engineState.value = { kind: 'generic', engine: null, fields: [], error: null };
    store.codeView.value = { hookId: 7, fieldId: 'a' };
    store.validationPanel.value = 'rules';
    store.schemaFabry.value = { ...store.schemaFabry.value, chatId: 'c', turns: [] };
    openRuleEditor(4);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await deleteQueue(1);
    expect(store.ruleEditor.value).toBeNull();
    expect(store.rules.value).toEqual([]);
    expect(store.hooks.value).toEqual([]);
    expect(store.engineState.value).toBeNull();
    expect(store.codeView.value).toBeNull();
    expect(store.validationPanel.value).toBeNull();
    expect(store.schemaFabry.value.chatId).toBeNull();
    vi.mocked(window.confirm).mockRestore();
  });

  it('deleting a schema asks first and calls the API', async () => {
    store.schemas.value = [{ id: 8, url: 's/8', name: 'Old' }];
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await deleteSchema(8);
    expect(ask.mock.calls[0][0]).toContain('Old (8)');
    expect(api.deleteSchema).toHaveBeenCalledWith(8);
    ask.mockRestore();
  });

  it('creates a schema with no queue, from the saved open schema or empty, and opens it', async () => {
    store.schema.value = { id: 7, name: 'Inv', url: 's/7', content: [section('saved')] };
    vi.mocked(api.createSchema).mockResolvedValue({ id: 80, url: 's/80' });
    vi.mocked(api.getSchema).mockResolvedValue({
      id: 80,
      name: 'Spare',
      content: [section('saved')],
    });
    await createUnlinkedSchema('Spare', 'copy');
    expect(api.createSchema).toHaveBeenLastCalledWith('Spare', [section('saved')]);
    expect(store.selectedSchemaId.value).toBe(80);
    expect(store.selectedQueueId.value).toBeNull();
    await createUnlinkedSchema('Blank', 'empty');
    expect(api.createSchema).toHaveBeenLastCalledWith('Blank', [
      { category: 'section', id: 'basic_info_section', label: 'Basic information', children: [] },
    ]);
  });
});

describe('rules', () => {
  it('opening a queue loads its rules and clears the picked rule', async () => {
    store.ruleId.value = 99;
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: [section('b')] });
    vi.mocked(api.listRules).mockResolvedValue([
      { id: 4, name: 'R', trigger_condition: 'True', actions: [] },
    ]);
    await openQueue(2);
    expect(store.ruleId.value).toBeNull();
    await vi.waitFor(() => expect(store.rules.value.map((r) => r.id)).toEqual([4]));
    expect(api.listRules).toHaveBeenCalledWith(2);
  });
});

describe('rule editor', () => {
  beforeEach(() => {
    vi.mocked(api.createRule).mockReset();
    vi.mocked(api.patchRule).mockReset();
    store.ruleEditor.value = null;
    store.queues.value = [{ id: 1, name: 'A', url: 'q/1', schema: 's/7' }];
    store.selectedQueueId.value = 1;
    store.workspaces.value = [{ id: 10, url: 'w/10', name: 'AP', organization: 'o/1' }];
    store.rules.value = [
      { id: 4, name: 'R', enabled: true, trigger_condition: 'field.a', actions: [] },
    ];
  });

  it('a new rule is created on the open queue, then reopens as the saved rule', async () => {
    openRuleEditor(null);
    updateRuleDraft({ name: 'New', trigger_condition: 'field.x > 0' });
    vi.mocked(api.createRule).mockResolvedValue({
      id: 9,
      name: 'New',
      trigger_condition: 'field.x > 0',
      actions: [],
    });
    vi.mocked(api.listRules).mockResolvedValue([{ id: 9, name: 'New' }]);
    await saveRule();
    const body = vi.mocked(api.createRule).mock.calls[0][0];
    expect(body).toMatchObject({
      name: 'New',
      trigger_condition: 'field.x > 0',
      queues: ['q/1'],
      organization: 'o/1',
    });
    expect(store.ruleEditor.value!.ruleId).toBe(9);
    expect(store.ruleDirty.value).toBe(false);
    expect(store.ruleId.value).toBe(9);
  });

  it('an existing rule is patched', async () => {
    openRuleEditor(4);
    updateRuleDraft({ trigger_condition: 'field.a > 2' });
    vi.mocked(api.patchRule).mockResolvedValue({
      id: 4,
      name: 'R',
      trigger_condition: 'field.a > 2',
      actions: [],
    });
    await saveRule();
    expect(api.patchRule).toHaveBeenCalledWith(4, {
      name: 'R',
      description: '',
      enabled: true,
      trigger_condition: 'field.a > 2',
      actions: [],
    });
  });

  it('refuses to patch a rule someone changed after it was opened', async () => {
    store.rules.value = [{ ...store.rules.value[0], modified_at: 't0' }];
    openRuleEditor(4);
    updateRuleDraft({ trigger_condition: 'field.a > 2' });
    vi.mocked(api.getRule).mockResolvedValue({ id: 4, modified_at: 't1' });
    await saveRule();
    expect(api.getRule).toHaveBeenCalledWith(4);
    expect(api.patchRule).not.toHaveBeenCalled();
    expect(store.ruleErrors.value[0]).toContain('Someone changed this rule');
    expect(store.ruleDirty.value).toBe(true);
  });

  it('refuses to save a rule without a name, and asks before closing with unsaved edits', async () => {
    openRuleEditor(null);
    await saveRule();
    expect(api.createRule).not.toHaveBeenCalled();
    expect(store.ruleErrors.value).toContain('The rule needs a name');
    updateRuleDraft({ name: 'x' });
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    closeRuleEditor();
    expect(store.ruleEditor.value).not.toBeNull();
    ask.mockReturnValue(true);
    closeRuleEditor();
    expect(store.ruleEditor.value).toBeNull();
    ask.mockRestore();
  });
});

describe('Mr. Fabry in the rule editor', () => {
  const proposal = {
    name: 'Doc id required',
    trigger_condition: 'is_empty(field.doc_id)',
    actions: [
      { type: 'show_message', payload: { type: 'error', content: 'Missing', schema_id: 'doc_id' } },
    ],
  };

  beforeEach(() => {
    vi.mocked(agentApi.createChat).mockClear();
    vi.mocked(agentApi.streamMessage).mockReset();
    store.startDraft(
      'S',
      withKeys([section('s', [dp('doc_id', { label: 'Doc' })], { label: 'S' })]),
    );
    store.queues.value = [{ id: 1, name: 'A', url: 'q/1', schema: 's/7' }];
    store.selectedQueueId.value = 1;
    store.ruleEditor.value = null;
  });

  it('fills the editor with the proposal, unsaved, and reuses the chat for a follow-up', async () => {
    openRuleEditor(null, 'doc_id');
    fabryReply('```json\n' + JSON.stringify(proposal) + '\n```');
    const rev = store.assistRev.value;
    await askRuleAssistant('Error when the document id is missing');
    const prompt = vi.mocked(agentApi.streamMessage).mock.calls[1][1];
    expect(prompt).toContain('Error when the document id is missing');
    expect(prompt).toContain('The rule starts from the field doc_id.');
    expect(store.ruleEditor.value!.draft.trigger_condition).toBe('is_empty(field.doc_id)');
    expect(store.ruleDirty.value).toBe(true);
    expect(store.assistRev.value).toBe(rev + 1);
    await askRuleAssistant('make it a warning');
    expect(agentApi.createChat).toHaveBeenCalledTimes(1);
  });

  it('a reply without a rule leaves the draft and shows the error', async () => {
    openRuleEditor(null, 'doc_id');
    fabryReply('I am not sure what you mean.');
    await askRuleAssistant('???');
    expect(store.ruleEditor.value!.draft.trigger_condition).toBe('field.doc_id');
    expect(store.assist.value.error).toBe('Mr. Fabry did not return a rule');
    expect(store.assist.value.reply).toContain('not sure');
  });

  it('warns about fields the proposal uses that the schema does not have', async () => {
    openRuleEditor(null, 'doc_id');
    fabryReply(JSON.stringify({ ...proposal, trigger_condition: 'field.ghost > 0' }));
    await askRuleAssistant('x');
    expect(store.assist.value.warnings.join(' ')).toContain('ghost');
  });

  it('Discard puts the rule back as it was opened', async () => {
    openRuleEditor(null, 'doc_id');
    fabryReply(JSON.stringify(proposal));
    await askRuleAssistant('x');
    discardRule();
    expect(store.ruleEditor.value!.draft.trigger_condition).toBe('field.doc_id');
    expect(store.ruleDirty.value).toBe(false);
  });

  it('drops a late reply once another rule is open', async () => {
    store.rules.value = [
      { id: 4, name: 'R4', trigger_condition: 'field.doc_id', actions: [] },
      { id: 5, name: 'R5', trigger_condition: 'True', actions: [] },
    ];
    openRuleEditor(4);
    const release = heldFabryReply(JSON.stringify(proposal));
    const asked = askRuleAssistant('x');
    openRuleEditor(5);
    release();
    await asked;
    expect(store.ruleEditor.value!.draft.trigger_condition).toBe('True');
    expect(store.ruleDirty.value).toBe(false);
  });
});

describe('Mr. Fabry on a field', () => {
  beforeEach(() => {
    vi.mocked(agentApi.createChat).mockClear();
    vi.mocked(agentApi.streamMessage).mockReset();
    store.ruleEditor.value = null;
    store.fieldAssist.value = {
      forKey: null,
      chatId: null,
      busy: false,
      error: null,
      reply: null,
      warnings: [],
    };
    store.startDraft(
      'S',
      withKeys([
        section(
          's',
          [
            dp('amount', { label: 'Amount', type: 'number' }),
            dp('check', {
              label: 'Check',
              type: 'number',
              ui_configuration: { type: 'formula' },
              formula: '',
            }),
          ],
          { label: 'S' },
        ),
      ]),
    );
  });
  const key = (id: string) => keyOf(store.work.value, id);

  it('applies the changes as one undoable schema edit', async () => {
    fabryReply('```json\n{"formula": "field.amount * 2"}\n```');
    await askFieldAssistant(key('check'), 'twice the amount');
    expect(rowOf(store.work.value, 'check').node.formula).toBe('field.amount * 2');
    expect(store.history.value.past.length).toBe(1);
    expect(store.fieldAssist.value.error).toBeNull();
  });

  it('a rejected answer changes nothing and says why', async () => {
    fabryReply('{"formula": "field.check + 1"}');
    await askFieldAssistant(key('check'), 'x');
    expect(store.history.value.past.length).toBe(0);
    expect(store.fieldAssist.value.error).toContain('reads its own field');
  });

  it('keeps one chat per field and starts a new one for another field', async () => {
    fabryReply('{"label": "Twice"}');
    await askFieldAssistant(key('check'), 'a');
    await askFieldAssistant(key('check'), 'b');
    expect(agentApi.createChat).toHaveBeenCalledTimes(1);
    await askFieldAssistant(key('amount'), 'c');
    expect(agentApi.createChat).toHaveBeenCalledTimes(2);
  });

  it('opening a schema forgets the field chat (keys are reused across schemas)', async () => {
    store.fieldAssist.value = {
      forKey: 'k2',
      chatId: 'old',
      busy: false,
      error: null,
      reply: null,
      warnings: [],
    };
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: [] });
    store.queues.value = [{ id: 2, name: 'B', schema: 'https://x/api/v1/schemas/22' }];
    await openQueue(2);
    expect(store.fieldAssist.value.chatId).toBeNull();
  });

  it('drops a late reply once another schema is open', async () => {
    const release = heldFabryReply('{"label": "Twice"}');
    const asked = askFieldAssistant(key('check'), 'x');
    vi.mocked(api.getSchema).mockResolvedValue({
      id: 22,
      content: [section('b', [dp('other'), dp('check2')])],
    });
    await openQueue(2);
    release();
    await asked;
    expect(store.history.value.past.length).toBe(0);
    expect(store.fieldAssist.value.busy).toBe(false);
  });
});

describe('Mr. Fabry on the whole schema', () => {
  const content = () => [section('s', [dp('doc_id', { label: 'Doc' })], { label: 'S' })];

  beforeEach(() => {
    vi.mocked(agentApi.createChat).mockClear();
    vi.mocked(agentApi.streamMessage).mockReset();
    vi.mocked(api.validateSchema).mockReset();
    store.ruleEditor.value = null;
    store.schema.value = { id: 7, name: 'S', modified_at: 't0', content: content() };
    store.startDraft('S', withKeys(content()));
    store.schemaFabry.value = {
      open: false,
      chatId: null,
      busy: false,
      error: null,
      turns: [],
      problems: [],
    };
  });

  it('applies the changes as one edit, validates the result, and reports what it skipped', async () => {
    openSchemaFabry();
    expect(store.schemaFabry.value.open).toBe(true);
    fabryReply(
      JSON.stringify({
        summary: 'Added a PO field',
        changes: [
          {
            op: 'add',
            kind: 'field',
            parent: 's',
            field: { id: 'po', label: 'PO', type: 'string' },
          },
          { op: 'delete', id: 'ghost' },
        ],
      }),
    );
    vi.mocked(api.validateSchema).mockResolvedValue({});
    await askSchemaFabry('Add a PO number');
    expect(store.history.value.past.length).toBe(1);
    expect(flatten(store.work.value).map((r) => r.node.id)).toEqual(['s', 'doc_id', 'po']);
    const sent = vi.mocked(api.validateSchema).mock.calls[0];
    expect(sent[0]).toBe(7);
    expect(sent[1][0].children.map((c: any) => c.id)).toEqual(['doc_id', 'po']);
    const turn = store.schemaFabry.value.turns.at(-1)!;
    expect(turn).toMatchObject({ role: 'fabry', text: 'Added a PO field', applied: 1 });
    expect(store.schemaFabry.value.problems).toEqual(['Skipped: No field with ID ghost']);
    expect([...store.fabryChangedKeys.value!].length).toBe(1);
  });

  it('puts validate errors on their rows and offers them to Mr. Fabry to fix', async () => {
    openSchemaFabry();
    fabryReply(
      JSON.stringify({
        summary: 'x',
        changes: [{ op: 'set', id: 'doc_id', attrs: { label: 'D' } }],
      }),
    );
    vi.mocked(api.validateSchema).mockResolvedValue({
      content: [{ children: { '0': { label: ['bad'] } } }],
    });
    await askSchemaFabry('rename');
    const k = keyOf(store.work.value, 'doc_id');
    expect(store.rowErrors.value.get(k)).toEqual(['label: bad']);
    expect(store.schemaFabry.value.problems).toEqual(['doc_id: label: bad']);
    fabryReply(JSON.stringify({ summary: 'fixed', changes: [] }));
    vi.mocked(api.validateSchema).mockResolvedValue({});
    await fixWithFabry();
    const fixPrompt = vi.mocked(agentApi.streamMessage).mock.calls.at(-1)![1];
    expect(fixPrompt).toContain('doc_id: label: bad');
    expect(agentApi.createChat).toHaveBeenCalledTimes(1);
    expect(store.schemaFabry.value.problems).toEqual([]);
  });

  it('opening the schema panel closes the rule editor', () => {
    store.rules.value = [{ id: 4, name: 'R', trigger_condition: 'field.a', actions: [] }];
    openRuleEditor(4);
    openSchemaFabry();
    expect(store.ruleEditor.value).toBeNull();
  });

  it("'only changes' covers every answer, and drops a change once it is undone", async () => {
    openSchemaFabry();
    vi.mocked(api.validateSchema).mockResolvedValue({});
    fabryReply(
      JSON.stringify({
        summary: 'a',
        changes: [{ op: 'add', kind: 'field', parent: 's', field: { id: 'po', label: 'PO' } }],
      }),
    );
    await askSchemaFabry('one');
    fabryReply(
      JSON.stringify({
        summary: 'b',
        changes: [{ op: 'set', id: 'doc_id', attrs: { label: 'D' } }],
      }),
    );
    await askSchemaFabry('two');
    const ids = () =>
      [...store.fabryChangedKeys.value]
        .map((k) => flatten(store.work.value).find((r) => r.key === k)!.node.id)
        .sort();
    expect(ids()).toEqual(['doc_id', 'po']);
    undoChange();
    expect(ids()).toEqual(['po']);
  });

  it('opening another schema starts a new conversation', async () => {
    store.schemaFabry.value = {
      open: true,
      chatId: 'c',
      busy: false,
      error: null,
      turns: [{ role: 'you', text: 'x' }],
      problems: ['p'],
    };
    store.fabryTouched.value = new Set(['k1']);
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: [] });
    store.queues.value = [{ id: 2, name: 'B', schema: 'https://x/api/v1/schemas/22' }];
    await openQueue(2);
    expect(store.schemaFabry.value).toMatchObject({ chatId: null, turns: [], problems: [] });
    expect(store.fabryTouched.value.size).toBe(0);
  });

  it('drops a late reply once another schema is open', async () => {
    openSchemaFabry();
    const release = heldFabryReply(
      JSON.stringify({
        summary: 'a',
        changes: [{ op: 'add', kind: 'field', parent: 's', field: { id: 'po', label: 'PO' } }],
      }),
    );
    const asked = askSchemaFabry('one');
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: [section('s')] });
    await openQueue(2);
    release();
    await asked;
    expect(store.history.value.past.length).toBe(0);
    expect(store.schemaFabry.value).toMatchObject({ busy: false, turns: [] });
  });
});

describe('hook mode (MDH)', () => {
  const hook = {
    id: 7,
    name: 'Vendor matching',
    settings: {
      configurations: [
        {
          source: { dataset: 'v', queries: [{ find: { vat: '{doc_id}' } }] },
          mapping: { dataset_key: 'id', target_schema_id: 'vendor' },
        },
      ],
    },
  };

  beforeEach(() => {
    vi.mocked(api.patchHookSettings).mockReset();
    vi.mocked(agentApi.streamMessage).mockReset();
    store.ruleEditor.value = null;
    store.hookEditor.value = null;
    store.hooks.value = [hook];
    store.startDraft(
      'S',
      withKeys([
        section(
          's',
          [dp('doc_id', { label: 'Doc' }), dp('vendor', { label: 'Vendor', type: 'enum' })],
          { label: 'S' },
        ),
      ]),
    );
  });

  it('opening a queue loads its hooks', async () => {
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: [] });
    vi.mocked(api.listHooks).mockResolvedValue([hook]);
    store.queues.value = [{ id: 2, name: 'B', schema: 'https://x/api/v1/schemas/22' }];
    await openQueue(2);
    await vi.waitFor(() => expect(store.hooks.value.map((h) => h.id)).toEqual([7]));
    expect(api.listHooks).toHaveBeenCalledWith(2);
  });

  it('opens the hook settings as JSON, locks the schema, filters to its fields', () => {
    store.rules.value = [{ id: 4, name: 'R', trigger_condition: 'field.a', actions: [] }];
    openRuleEditor(4);
    openHookEditor(7);
    expect(store.ruleEditor.value).toBeNull();
    expect(JSON.parse(store.hookEditor.value!.draft)).toEqual(hook.settings);
    expect(store.schemaLocked.value).toBe(true);
    expect([...store.hookFilterIds.value!].sort()).toEqual(['doc_id', 'vendor']);
  });

  it('refuses to save JSON that does not parse, then saves the settings', async () => {
    openHookEditor(7);
    updateHookDraft('{ broken');
    await saveHook();
    expect(api.patchHookSettings).not.toHaveBeenCalled();
    expect(store.hookErrors.value[0]).toContain('not valid JSON');
    const next = { configurations: [] };
    updateHookDraft(JSON.stringify(next));
    vi.mocked(api.patchHookSettings).mockResolvedValue({ ...hook, settings: next });
    await saveHook();
    expect(api.patchHookSettings).toHaveBeenCalledWith(7, next);
    expect(store.hooks.value[0].settings).toEqual(next);
    expect(store.hookDirty.value).toBe(false);
  });

  it('refuses to patch a hook someone changed after it was opened', async () => {
    store.hooks.value = [{ ...hook, modified_at: 't0' }];
    openHookEditor(7);
    updateHookDraft('{"configurations": []}');
    vi.mocked(api.getHook).mockResolvedValue({ id: 7, modified_at: 't1' });
    await saveHook();
    expect(api.getHook).toHaveBeenCalledWith(7);
    expect(api.patchHookSettings).not.toHaveBeenCalled();
    expect(store.hookErrors.value[0]).toContain('Someone changed this hook');
    expect(store.hookDirty.value).toBe(true);
  });

  it('a saved hook keeps its new modified_at, so the next save is not stale', async () => {
    store.hooks.value = [{ ...hook, modified_at: 't0' }];
    openHookEditor(7);
    updateHookDraft('{"configurations": []}');
    vi.mocked(api.getHook).mockResolvedValueOnce({ id: 7, modified_at: 't0' });
    vi.mocked(api.patchHookSettings).mockResolvedValue({
      id: 7,
      modified_at: 't1',
      settings: { configurations: [] },
    });
    await saveHook();
    expect(store.hooks.value[0].modified_at).toBe('t1');
  });

  it('Mr. Fabry fills the editor with new settings; Discard brings back the saved ones', async () => {
    openHookEditor(7);
    const proposed = {
      configurations: [
        {
          source: { queries: [{ find: { x: '{ghost}' } }] },
          mapping: { target_schema_id: 'vendor' },
        },
      ],
    };
    fabryReply('```json\n' + JSON.stringify(proposed) + '\n```');
    await askHookAssistant('match on ghost instead');
    expect(JSON.parse(store.hookEditor.value!.draft)).toEqual(proposed);
    expect(store.hookAssist.value.warnings.join(' ')).toContain('ghost');
    discardHook();
    expect(JSON.parse(store.hookEditor.value!.draft)).toEqual(hook.settings);
  });

  it('drops a late Mr. Fabry reply once another hook is open', async () => {
    store.hooks.value = [hook, { ...hook, id: 8, name: 'Other' }];
    openHookEditor(7);
    const release = heldFabryReply(JSON.stringify({ configurations: [] }));
    const asked = askHookAssistant('x');
    openHookEditor(8);
    release();
    await asked;
    expect(store.hookEditor.value!.hookId).toBe(8);
    expect(JSON.parse(store.hookEditor.value!.draft)).toEqual(hook.settings);
    expect(store.hookAssist.value.busy).toBe(false);
  });
});

describe('revalidate', () => {
  const content = (v: string) => ({
    content: [
      {
        category: 'section',
        schema_id: 's',
        children: [{ category: 'datapoint', id: 101, schema_id: 'doc_id', content: { value: v } }],
      },
    ],
  });
  beforeEach(() => {
    for (const f of [
      'getAnnotation',
      'startAnnotation',
      'validateAnnotation',
      'cancelAnnotation',
      'getAnnotationContent',
    ] as const) {
      vi.mocked(api[f]).mockReset();
    }
    vi.mocked(api.startAnnotation).mockResolvedValue({});
    vi.mocked(api.cancelAnnotation).mockResolvedValue({});
    store.annotationId.value = 5;
    store.validation.value = null;
    store.revalidateError.value = null;
  });

  it('starts a document in review, validates, refreshes the values, and hands it back', async () => {
    vi.mocked(api.getAnnotation).mockResolvedValue({ id: 5, status: 'to_review' });
    vi.mocked(api.validateAnnotation).mockResolvedValue({
      messages: [{ id: 101, type: 'error', content: 'Missing' }],
      matched_trigger_rules: [4],
    });
    vi.mocked(api.getAnnotationContent).mockResolvedValue(content('NEW'));
    store.validationPanel.value = null;
    await revalidate();
    expect(store.validationPanel.value).toBe('rules'); // results open in the right panel
    expect(api.startAnnotation).toHaveBeenCalledWith(5);
    expect(api.cancelAnnotation).toHaveBeenCalledWith(5);
    expect(store.values.value!.values.get('doc_id')).toEqual(['NEW']);
    expect(store.validation.value!.placed.byField.get('doc_id')!.get(0)![0].content).toBe(
      'Missing',
    );
    expect([...store.validation.value!.fired]).toEqual([4]);
  });

  it('leaves a document you already review as it is', async () => {
    vi.mocked(api.getAnnotation).mockResolvedValue({ id: 5, status: 'reviewing' });
    vi.mocked(api.validateAnnotation).mockResolvedValue({ messages: [] });
    vi.mocked(api.getAnnotationContent).mockResolvedValue(content('x'));
    await revalidate();
    expect(api.startAnnotation).not.toHaveBeenCalled();
    expect(api.cancelAnnotation).not.toHaveBeenCalled();
  });

  it('refuses a document that is not in review', async () => {
    vi.mocked(api.getAnnotation).mockResolvedValue({ id: 5, status: 'exported' });
    await revalidate();
    expect(api.startAnnotation).not.toHaveBeenCalled();
    expect(store.revalidateError.value).toContain('exported');
  });

  it('still hands the document back when validation fails', async () => {
    vi.mocked(api.getAnnotation).mockResolvedValue({ id: 5, status: 'to_review' });
    vi.mocked(api.validateAnnotation).mockRejectedValue(new Error('boom'));
    await revalidate();
    expect(api.cancelAnnotation).toHaveBeenCalledWith(5);
    expect(store.revalidateError.value).toBe('boom');
  });
});

describe('rule evaluation on the picked annotation', () => {
  it('sends the unsaved draft with the annotation content, debounced, and keeps the result', async () => {
    vi.useFakeTimers();
    try {
      store.queues.value = [{ id: 3, name: 'C', url: 'https://x/api/v1/queues/3' }];
      store.selectedQueueId.value = 3;
      store.annotationId.value = 55;
      store.annotationContent.value = [{ category: 'section', schema_id: 's', children: [] }];
      store.ruleEditor.value = {
        ruleId: 40,
        base: { name: 'R', description: '', enabled: true, trigger_condition: 'x', actions: [] },
        draft: {
          name: 'R',
          description: '',
          enabled: true,
          trigger_condition: 'field.a > 1',
          actions: [],
        },
        fromField: null,
      };
      vi.mocked(api.evaluateRules).mockResolvedValue({
        condition_values: [[false, true]],
        messages: [],
        actions: [],
      });
      scheduleRuleEval();
      scheduleRuleEval(); // a second change within the delay sends one request
      expect(store.ruleEval.value!.busy).toBe(true);
      await vi.advanceTimersByTimeAsync(500);
      expect(api.evaluateRules).toHaveBeenCalledTimes(1);
      expect(api.evaluateRules).toHaveBeenCalledWith({
        queue: 'https://x/api/v1/queues/3',
        annotation: 'https://x/api/v1/annotations/55',
        annotation_content: store.annotationContent.value,
        schema_rules: [
          {
            name: 'R',
            description: '',
            enabled: true,
            trigger_condition: 'field.a > 1',
            actions: [],
            queues: ['https://x/api/v1/queues/3'],
          },
        ],
      });
      expect(store.ruleEval.value).toEqual({
        values: [false, true],
        errors: [],
        busy: false,
        error: null,
      });
    } finally {
      vi.useRealTimers();
      store.ruleEditor.value = null;
    }
  });
});
