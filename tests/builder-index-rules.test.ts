// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { resetBuilderGlue, section, ruleEditorState } from './support/builder.js';
import { draftFromRule } from '../src/builder/ruleDraft.js';
import * as api from '../src/builder/api.js';
import {
  openQueue,
  openRuleEditor,
  updateRuleDraft,
  saveRule,
  closeRuleEditor,
  scheduleRuleEval,
} from '../src/builder/index.jsx';

vi.mock('../src/builder/api.js');
vi.mock('../src/agent/agentApi.js');

beforeEach(resetBuilderGlue);

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
    store.rightPanel.value = null;
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

describe('rule evaluation on the picked annotation', () => {
  it('sends the unsaved draft with the annotation content, debounced, and keeps the result', async () => {
    vi.useFakeTimers();
    try {
      store.domain.value = 'https://x';
      store.queues.value = [{ id: 3, name: 'C', url: 'https://x/api/v1/queues/3' }];
      store.selectedQueueId.value = 3;
      store.annotationId.value = 55;
      store.annotationContent.value = [{ category: 'section', schema_id: 's', children: [] }];
      const draft = draftFromRule({ name: 'R', trigger_condition: 'field.a > 1' });
      store.rightPanel.value = {
        kind: 'rule',
        editor: ruleEditorState({
          ruleId: 40,
          base: draftFromRule({ name: 'R', trigger_condition: 'x' }),
          draft,
        }),
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
        schema_rules: [{ ...draft, queues: ['https://x/api/v1/queues/3'] }],
      });
      expect(store.ruleEval.value).toEqual({
        values: [false, true],
        errors: [],
        busy: false,
        error: null,
      });
    } finally {
      vi.useRealTimers();
      store.rightPanel.value = null;
    }
  });
});
