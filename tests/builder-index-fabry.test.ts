// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { withKeys, flatten } from '../src/builder/model.js';
import {
  resetBuilderGlue,
  section,
  dp,
  keyOf,
  rowOf,
  fabryReply,
  heldFabryReply,
} from './support/builder.js';
import * as agentApi from '../src/agent/agentApi.js';
import * as api from '../src/builder/api.js';
import {
  openQueue,
  openRuleEditor,
  askRuleAssistant,
  discardRule,
  askFieldAssistant,
  openSchemaFabry,
  askSchemaFabry,
  fixWithFabry,
  undoChange,
} from '../src/builder/index.jsx';

vi.mock('../src/builder/api.js');
vi.mock('../src/agent/agentApi.js');

beforeEach(resetBuilderGlue);

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
    store.rightPanel.value = null;
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
    store.rightPanel.value = null;
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
    store.rightPanel.value = null;
    store.schema.value = { id: 7, name: 'S', modified_at: 't0', content: content() };
    store.startDraft('S', withKeys(content()));
    store.schemaFabry.value = {
      chatId: null,
      busy: false,
      error: null,
      turns: [],
      problems: [],
    };
  });

  it('applies the changes as one edit, validates the result, and reports what it skipped', async () => {
    openSchemaFabry();
    expect(store.rightPanel.value).toEqual({ kind: 'fabry' });
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
    store.rightPanel.value = { kind: 'fabry' };
    store.schemaFabry.value = {
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
