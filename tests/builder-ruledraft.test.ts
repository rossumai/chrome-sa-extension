import { describe, it, expect } from 'vitest';
import {
  draftFromRule,
  emptyDraft,
  draftBody,
  newAction,
  withActionType,
  draftErrors,
  sameDraft,
} from '../src/builder/ruleDraft.js';

const rule = {
  id: 4,
  name: 'Total check',
  description: 'd',
  enabled: true,
  trigger_condition: 'field.a > 1',
  actions: [
    {
      id: 'msg',
      enabled: true,
      type: 'show_message',
      event: 'validation',
      payload: { type: 'error', content: 'x', schema_id: 'a' },
    },
  ],
  queues: ['q/1'],
  url: 'r/4',
};

describe('rule drafts', () => {
  it('takes the editable part of a rule and turns it back into a request body', () => {
    const d = draftFromRule(rule);
    expect(d).toEqual({
      name: 'Total check',
      description: 'd',
      enabled: true,
      trigger_condition: 'field.a > 1',
      actions: rule.actions,
    });
    expect(draftBody(d)).toEqual(d);
    expect(draftBody(d, { queueUrl: 'q/9', organization: 'o/1' })).toEqual({
      ...d,
      queues: ['q/9'],
      organization: 'o/1',
    });
  });

  it('a new rule starts empty with one error message action, and needs a name and a condition', () => {
    const d = emptyDraft();
    expect(d.actions).toHaveLength(1);
    expect(d.actions[0]).toMatchObject({
      type: 'show_message',
      event: 'validation',
      enabled: true,
    });
    expect(draftErrors(d)).toEqual(['The rule needs a name', 'The rule needs a condition']);
    expect(draftErrors({ ...d, name: 'x'.repeat(256), trigger_condition: 'True' })).toEqual([
      'The name is longer than 255 characters',
    ]);
  });

  it('newAction picks an id no other action in the rule has', () => {
    const a = newAction([{ id: 'action-1' }, { id: 'action-2' }]);
    expect(a.id).toBe('action-3');
  });

  it('changing an action type resets its payload to that type, keeping the anchor field', () => {
    const a = {
      id: 'x',
      enabled: true,
      type: 'show_message',
      event: 'validation',
      payload: { type: 'error', content: 'c', schema_id: 'f' },
    };
    expect(withActionType(a, 'add_automation_blocker').payload).toEqual({
      content: 'c',
      schema_id: 'f',
    });
    expect(withActionType(a, 'show_hide_field').payload).toEqual({ schema_ids: ['f'] });
    expect(withActionType(a, 'send_email').payload).toEqual({});
  });

  it('sameDraft compares content, not identity', () => {
    expect(sameDraft(draftFromRule(rule), draftFromRule({ ...rule }))).toBe(true);
    expect(sameDraft(draftFromRule(rule), { ...draftFromRule(rule), enabled: false })).toBe(false);
  });
});
