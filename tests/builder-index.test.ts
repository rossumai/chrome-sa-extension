// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { withKeys } from '../src/builder/model.js';

vi.mock('../src/builder/api.js', () => ({
  getSchema: vi.fn(),
  validateSchema: vi.fn(),
  patchSchema: vi.fn(),
  getAnnotationContent: vi.fn(),
  listAnnotations: vi.fn(),
  listRules: vi.fn(async () => []),
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
}));
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
  save,
  pickAnnotation,
  renameSchema,
  undoChange,
} from '../src/builder/index.jsx';

const section = (id: string) => [{ category: 'section', id, label: id, children: [] }];

beforeEach(() => {
  vi.mocked(api.getSchema).mockReset();
  store.queues.value = [
    { id: 1, name: 'A', schema: 'https://x/api/v1/schemas/11' },
    { id: 2, name: 'B', schema: 'https://x/api/v1/schemas/22' },
  ];
  store.startDraft('', []);
  store.generalErrors.value = [];
});

describe('openQueue', () => {
  it('ignores a schema response that arrives after a newer queue was opened', async () => {
    let releaseA: (v: any) => void = () => {};
    vi.mocked(api.getSchema).mockImplementation((id: number) =>
      id === 11
        ? new Promise((r) => (releaseA = r))
        : Promise.resolve({ id: 22, content: section('b_section') }),
    );
    const a = openQueue(1);
    await openQueue(2);
    releaseA({ id: 11, content: section('a_section') });
    await a;
    expect(store.selectedQueueId.value).toBe(2);
    expect(store.schema.value.id).toBe(22);
  });
});

describe('save', () => {
  it('shows landed-diff warnings in the banner', async () => {
    const content = section('s');
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

  it('rejects input that is not an annotation id or URL', async () => {
    vi.mocked(api.getAnnotationContent).mockClear();
    await pickAnnotation('hello');
    expect(store.annotationError.value).toBe('Not an annotation ID or URL');
    expect(api.getAnnotationContent).not.toHaveBeenCalled();
  });
});

describe('renameSchema', () => {
  it('stages the name as one undoable edit, and Save updates the schema list', async () => {
    const content = section('s');
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
    vi.mocked(api.getSchema).mockResolvedValue({ id: 33, name: 'Orphan', content: section('s') });
    await openSchema(33);
    expect(api.getSchema).toHaveBeenCalledWith(33);
    expect(store.selectedQueueId.value).toBeNull();
    expect(store.selectedSchemaId.value).toBe(33);
    expect(store.draftName.value).toBe('Orphan');
  });

  it('labels annotations as file name (id) · status', async () => {
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: section('b') });
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
    vi.mocked(api.getSchema).mockResolvedValue({ id: 99, content: section('x') });
    store.workspaces.value = [{ id: 10, url: 'w/10', name: 'AP', organization: 'o/1' }];
  });

  it('creates a workspace in the organization of the existing ones', async () => {
    vi.mocked(api.createWorkspace).mockResolvedValue({ id: 11 });
    await createWorkspace('PO');
    expect(api.createWorkspace).toHaveBeenCalledWith('PO', 'o/1');
  });

  it('a queue with a copied schema creates the schema from the SAVED content first', async () => {
    store.schema.value = { id: 7, name: 'Inv', url: 's/7', content: section('saved') };
    store.startDraft('Inv', withKeys(section('saved')));
    vi.mocked(api.createSchema).mockResolvedValue({ id: 70, url: 's/70' });
    vi.mocked(api.createQueue).mockResolvedValue({ id: 5, schema: 's/70' });
    await createQueue({ name: 'Inv 2', workspaceUrl: 'w/10', mode: 'copy' });
    expect(api.createSchema).toHaveBeenCalledWith('Inv 2', section('saved'));
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

  it('deleting a schema asks first and calls the API', async () => {
    store.schemas.value = [{ id: 8, url: 's/8', name: 'Old' }];
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await deleteSchema(8);
    expect(ask.mock.calls[0][0]).toContain('Old (8)');
    expect(api.deleteSchema).toHaveBeenCalledWith(8);
    ask.mockRestore();
  });

  it('creates a schema with no queue, from the saved open schema or empty, and opens it', async () => {
    store.schema.value = { id: 7, name: 'Inv', url: 's/7', content: section('saved') };
    vi.mocked(api.createSchema).mockResolvedValue({ id: 80, url: 's/80' });
    vi.mocked(api.getSchema).mockResolvedValue({
      id: 80,
      name: 'Spare',
      content: section('saved'),
    });
    await createUnlinkedSchema('Spare', 'copy');
    expect(api.createSchema).toHaveBeenLastCalledWith('Spare', section('saved'));
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
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: section('b') });
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
