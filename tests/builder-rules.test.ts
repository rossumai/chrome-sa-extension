import { describe, it, expect } from 'vitest';
import { ruleFieldRefs, ruleRoles } from '../src/builder/rules.js';

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
