import { describe, it, expect, vi } from 'vitest';
import { buildRulePrompt, parseRuleReply } from '../src/builder/ruleAssist.js';
import { withKeys } from '../src/builder/model.js';
import { runAssist, schemaFieldList } from '../src/builder/assist.js';

const schema = withKeys([
  {
    category: 'section',
    id: 'basic_section',
    label: 'Basic',
    children: [
      { category: 'datapoint', id: 'doc_id', label: 'Doc ID', type: 'string' },
      {
        category: 'multivalue',
        id: 'items',
        label: 'Items',
        children: {
          category: 'tuple',
          id: 'item',
          children: [{ category: 'datapoint', id: 'item_amount', label: 'Amount', type: 'number' }],
        },
      },
    ],
  },
]);

describe('schemaFieldList', () => {
  it('lists datapoints and tables, naming the table a column belongs to', () => {
    expect(schemaFieldList(schema)).toEqual([
      { id: 'doc_id', label: 'Doc ID', type: 'string', table: null },
      { id: 'items', label: 'Items', type: 'table', table: null },
      { id: 'item_amount', label: 'Amount', type: 'number', table: 'items' },
    ]);
  });
});

describe('buildRulePrompt', () => {
  it('carries the request, the fields, the start field and the JSON contract', () => {
    const p = buildRulePrompt({
      request: 'Warn when the total is zero',
      fields: schemaFieldList(schema),
      startField: 'doc_id',
    });
    expect(p).toContain('Warn when the total is zero');
    expect(p).toContain('- doc_id: Doc ID (string)');
    expect(p).toContain('- item_amount: Amount (number, column of table items)');
    expect(p).toContain('doc_id');
    expect(p).toContain('trigger_condition');
    expect(p).toContain('```json');
    expect(p).not.toContain('Current rule');
  });

  it('includes the current rule when one is being changed', () => {
    const p = buildRulePrompt({
      request: 'make it a warning',
      fields: [],
      current: {
        name: 'R',
        description: '',
        enabled: true,
        trigger_condition: 'field.a',
        actions: [],
      },
    });
    expect(p).toContain('Current rule');
    expect(p).toContain('"trigger_condition": "field.a"');
  });
});

describe('parseRuleReply', () => {
  const rule = {
    name: 'Zero total',
    trigger_condition: 'field.doc_id == ""',
    actions: [
      {
        id: 'a',
        type: 'show_message',
        event: 'validation',
        payload: { type: 'warning', content: 'x', schema_id: 'ghost' },
      },
    ],
  };
  const ids = new Set(['doc_id', 'items', 'item_amount']);

  it('reads the json block, fills defaults, and lists fields the schema does not have', () => {
    const r = parseRuleReply(
      'Here you go:\n```json\n' + JSON.stringify(rule) + '\n```\nDone.',
      ids,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft).toMatchObject({ name: 'Zero total', description: '', enabled: true });
      expect(r.unknownFields).toEqual(['ghost']);
    }
  });

  it('also accepts a bare JSON object in prose', () => {
    expect(parseRuleReply('Rule: ' + JSON.stringify(rule), ids).ok).toBe(true);
  });

  it('rejects no JSON, broken JSON, and a rule missing its condition', () => {
    expect(parseRuleReply('Sorry, I cannot.', ids)).toEqual({
      ok: false,
      error: 'Mr. Fabry did not return a rule',
    });
    expect(parseRuleReply('```json\n{ nope \n```', ids).ok).toBe(false);
    const r = parseRuleReply('```json\n{"name":"x","actions":[]}\n```', ids);
    expect(r).toEqual({ ok: false, error: 'The rule needs a condition' });
  });
});

describe('runAssist', () => {
  function fakeAgent(reply: string) {
    return {
      createChat: vi.fn(async () => 'chat-1'),
      streamMessage: vi.fn(async (_id: string, _content: string, opts: any) => {
        opts.onEvent({ type: 'text-delta', delta: reply });
      }),
    };
  }

  it('opens a cautious read-only chat the first time and reuses it after', async () => {
    const agent = fakeAgent('ok');
    const first = await runAssist({ agentApi: agent, chatId: null, content: 'P1' });
    expect(first).toEqual({ chatId: 'chat-1', text: 'ok' });
    expect(agent.streamMessage.mock.calls.map((c) => c[1])).toEqual(['/persona cautious', 'P1']);
    expect(agent.streamMessage.mock.calls.every((c) => !c[2]?.mcpMode)).toBe(true);
    await runAssist({ agentApi: agent, chatId: 'chat-1', content: 'P2' });
    expect(agent.createChat).toHaveBeenCalledTimes(1);
  });
});
