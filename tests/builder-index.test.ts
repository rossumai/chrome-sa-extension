// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { withKeys, flatten } from '../src/builder/model.js';

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

describe('Mr. Fabry in the rule editor', () => {
  const reply = (text: string) =>
    vi
      .mocked(agentApi.streamMessage)
      .mockImplementation(async (_id: string, content: string, opts: any) => {
        if (content !== '/persona cautious') opts.onEvent({ type: 'text-delta', delta: text });
      });
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
      withKeys([
        {
          category: 'section',
          id: 's',
          label: 'S',
          children: [{ category: 'datapoint', id: 'doc_id', label: 'Doc', type: 'string' }],
        },
      ]),
    );
    store.queues.value = [{ id: 1, name: 'A', url: 'q/1', schema: 's/7' }];
    store.selectedQueueId.value = 1;
    store.ruleEditor.value = null;
  });

  it('fills the editor with the proposal, unsaved, and reuses the chat for a follow-up', async () => {
    openRuleEditor(null, 'doc_id');
    reply('```json\n' + JSON.stringify(proposal) + '\n```');
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
    reply('I am not sure what you mean.');
    await askRuleAssistant('???');
    expect(store.ruleEditor.value!.draft.trigger_condition).toBe('field.doc_id');
    expect(store.assist.value.error).toBe('Mr. Fabry did not return a rule');
    expect(store.assist.value.reply).toContain('not sure');
  });

  it('warns about fields the proposal uses that the schema does not have', async () => {
    openRuleEditor(null, 'doc_id');
    reply(JSON.stringify({ ...proposal, trigger_condition: 'field.ghost > 0' }));
    await askRuleAssistant('x');
    expect(store.assist.value.warnings.join(' ')).toContain('ghost');
  });

  it('Discard puts the rule back as it was opened', async () => {
    openRuleEditor(null, 'doc_id');
    reply(JSON.stringify(proposal));
    await askRuleAssistant('x');
    discardRule();
    expect(store.ruleEditor.value!.draft.trigger_condition).toBe('field.doc_id');
    expect(store.ruleDirty.value).toBe(false);
  });
});

describe('Mr. Fabry on a field', () => {
  const reply = (text: string) =>
    vi
      .mocked(agentApi.streamMessage)
      .mockImplementation(async (_id: string, content: string, opts: any) => {
        if (content !== '/persona cautious') opts.onEvent({ type: 'text-delta', delta: text });
      });

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
        {
          category: 'section',
          id: 's',
          label: 'S',
          children: [
            { category: 'datapoint', id: 'amount', label: 'Amount', type: 'number' },
            {
              category: 'datapoint',
              id: 'check',
              label: 'Check',
              type: 'number',
              ui_configuration: { type: 'formula' },
              formula: '',
            },
          ],
        },
      ]),
    );
  });
  const key = (id: string) => flatten(store.work.value).find((r) => r.node.id === id)!.key;

  it('applies the changes as one undoable schema edit', async () => {
    reply('```json\n{"formula": "field.amount * 2"}\n```');
    await askFieldAssistant(key('check'), 'twice the amount');
    expect(flatten(store.work.value).find((r) => r.node.id === 'check')!.node.formula).toBe(
      'field.amount * 2',
    );
    expect(store.history.value.past.length).toBe(1);
    expect(store.fieldAssist.value.error).toBeNull();
  });

  it('a rejected answer changes nothing and says why', async () => {
    reply('{"formula": "field.check + 1"}');
    await askFieldAssistant(key('check'), 'x');
    expect(store.history.value.past.length).toBe(0);
    expect(store.fieldAssist.value.error).toContain('reads its own field');
  });

  it('keeps one chat per field and starts a new one for another field', async () => {
    reply('{"label": "Twice"}');
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
});
