import { describe, it, expect } from 'vitest';
import {
  ruleFieldRefs,
  ruleRoles,
  rulesByField,
  fieldActionMarks,
  globalActionMarks,
} from '../src/builder/rules.js';

const rule = {
  id: 1,
  name: 'Total must match',
  trigger_condition:
    'not is_empty(field.amount_total) and field.amount_total != sum(field.item_amount.all_values)\n# field.commented_out still counts',
  actions: [
    { type: 'show_message', payload: { type: 'error', schema_id: 'amount_total' } },
    { type: 'show_hide_field', payload: { schema_id: 'note', schema_ids: ['note', 'note_2'] } },
    { type: 'send_email', payload: { to: 'x@example.com' } },
  ],
};

describe('ruleFieldRefs', () => {
  it('reads field.<id> from the condition and schema_id(s) from the actions', () => {
    const r = ruleFieldRefs(rule);
    expect([...r.condition].sort()).toEqual(['amount_total', 'commented_out', 'item_amount']);
    expect([...r.actions].sort()).toEqual(['amount_total', 'note', 'note_2']);
  });

  it('ignores names that only end in "field", and tolerates a rule with nothing', () => {
    const r = ruleFieldRefs({ trigger_condition: 'myfield.x or subfield.y', actions: null });
    expect(r.condition.size).toBe(0);
    expect(ruleFieldRefs({}).actions.size).toBe(0);
  });
});

describe('ruleRoles', () => {
  it('marks each field condition, action or both', () => {
    const roles = ruleRoles(ruleFieldRefs(rule));
    expect(roles.get('amount_total')).toBe('both');
    expect(roles.get('item_amount')).toBe('condition');
    expect(roles.get('note')).toBe('action');
  });
});

describe('rulesByField', () => {
  it('lists, per field, the rules that use it with their role', () => {
    const other = { id: 2, name: 'Other', trigger_condition: 'field.note', actions: [] };
    const map = rulesByField([rule, other]);
    expect(map.get('amount_total')!.map((x) => [x.rule.id, x.role])).toEqual([[1, 'both']]);
    expect(map.get('note')!.map((x) => [x.rule.id, x.role])).toEqual([
      [1, 'action'],
      [2, 'condition'],
    ]);
    expect(map.has('nothing')).toBe(false);
  });
});

describe('action marks', () => {
  const r = {
    actions: [
      {
        type: 'show_message',
        event: 'validation',
        payload: { type: 'info', content: 'Hi', schema_id: 'a' },
      },
      {
        type: 'show_message',
        event: 'validation',
        payload: { content: 'No type', schema_id: 'a' },
      },
      {
        type: 'show_hide_field',
        event: 'validation',
        payload: { schema_id: 'b', schema_ids: ['b', 'c'] },
      },
      {
        type: 'add_automation_blocker',
        event: 'validation',
        payload: { content: 'Stop', schema_id: 'c' },
      },
      { type: 'add_automation_blocker', event: 'validation', payload: { content: 'Global stop' } },
      {
        type: 'show_message',
        event: 'validation',
        payload: { type: 'warning', content: 'Global' },
      },
      { type: 'send_email', event: 'annotation_exported', payload: { to: 'x@example.com' } },
    ],
  };

  it('marks each anchored field by kind; a message with no type counts as an error', () => {
    const m = fieldActionMarks(r);
    expect(m.get('a')!.map((x) => [x.kind, x.text])).toEqual([
      ['info', 'Hi'],
      ['error', 'No type'],
    ]);
    expect(m.get('b')!.map((x) => x.kind)).toEqual(['show_hide']);
    expect(m.get('c')!.map((x) => x.kind)).toEqual(['show_hide', 'blocker']);
  });

  it('collects the actions with no field anchor as global ones', () => {
    expect(globalActionMarks(r).map((x) => [x.kind, x.text])).toEqual([
      ['blocker', 'Global stop'],
      ['warning', 'Global'],
      ['send_email', 'annotation_exported'],
    ]);
  });
});
