import { describe, it, expect } from 'vitest';
import { TRACK, namesFor, allTasks } from '../src/training/track.js';
import { evaluateTask, buildOf, taskOk, matchesOnVat, type Ctx } from '../src/training/checks.js';

const names = namesFor('barge-17');
const t = (id: string) => allTasks(TRACK).find((x) => x.task.id === id)!.task;
const states = (as: ReturnType<typeof evaluateTask>) => as!.map((a) => a.state);

const queue = { id: 31927, schemaPath: '/api/v1/schemas/5' };
const vatConfig = {
  source: {
    dataset: 'af_vendor_master_barge_17',
    queries: [{ find: { vat_id: '{vendor_vat_id}' } }, { find: { name: '{sender_name}' } }],
  },
  mapping: { target_schema_id: 'vendor_match', dataset_key: 'id' },
};

describe('kickoff', () => {
  it('passes the queue task only when a queue of exactly that name was found', () => {
    expect(states(evaluateTask(t('kickoff.queue'), { names, queue }))).toEqual(['ok']);
    const no = evaluateTask(t('kickoff.queue'), { names, queue: null })!;
    expect(no[0].state).toBe('no');
    expect(no[0].fix).toContain('AF · AP Invoices · barge-17');
  });
});

describe('fields', () => {
  const schema = (fields: Array<{ id: string; type?: string; rir?: string[] }>) => ({
    id: 5,
    fields: fields.map((f) => ({ id: f.id, type: f.type ?? 'string', rir: f.rir ?? [] })),
  });

  it('says, per field, exactly what to do — renamed, not yet renamed, or added anew', () => {
    const ctx: Ctx = {
      names,
      queue,
      schema: schema([
        { id: 'po_number', rir: ['order_id'] }, // renamed in place: done
        { id: 'sender_vat_id', rir: ['sender_vat_id'] }, // not renamed yet
      ]),
    };
    const as = evaluateTask(t('fields.extract'), ctx)!;
    expect(as.map((a) => a.label)).toEqual([
      'The Order Number field (`order_id`) has the ID `po_number`',
      'The Vendor VAT Number field (`sender_vat_id`) has the ID `vendor_vat_id`',
    ]);
    expect(states(as)).toEqual(['ok', 'no']);
    expect(as[1].fix).toBe(
      'Open the Vendor VAT Number field (ID `sender_vat_id`) and change its ID to `vendor_vat_id`.',
    );
  });

  it('spots a new field added beside the template’s, which the AI would not fill', () => {
    const ctx: Ctx = {
      names,
      queue,
      schema: schema([{ id: 'order_id', rir: ['order_id'] }, { id: 'po_number' }]),
    };
    expect(evaluateTask(t('fields.extract'), ctx)![0].fix).toBe(
      'Your `po_number` is a new field, so the AI does not fill it. Delete it, then change the ID of the existing Order Number field (`order_id`) to `po_number`.',
    );
  });

  it('asks for the field back when the template’s one is gone', () => {
    const ctx: Ctx = { names, queue, schema: schema([]) };
    expect(evaluateTask(t('fields.extract'), ctx)![0].fix).toBe(
      'Add a field with the ID `po_number`, and choose Order Number (`order_id`) as the AI value it reads.',
    );
  });

  it('wants vendor_match to be an enum, and says what type it is instead', () => {
    const ctx: Ctx = { names, queue, schema: schema([{ id: 'vendor_match', type: 'string' }]) };
    const as = evaluateTask(t('fields.match'), ctx)!;
    expect(states(as)).toEqual(['ok', 'no']);
    expect(as[1].fix).toContain('`string`');
  });

  it('is pending, not failing, while the queue does not exist', () => {
    expect(states(evaluateTask(t('fields.match'), { names, queue: null }))).toEqual(['pending']);
  });
});

describe('vendors', () => {
  it('counts the records only once the dataset exists', () => {
    expect(
      states(
        evaluateTask(t('vendors.records'), { names, dataset: { exists: false, records: null } }),
      ),
    ).toEqual(['pending']);
    const few = evaluateTask(t('vendors.records'), {
      names,
      dataset: { exists: true, records: 12 },
    })!;
    expect(few[0].state).toBe('no');
    expect(few[0].fix).toContain('12');
    expect(
      states(evaluateTask(t('vendors.records'), { names, dataset: { exists: true, records: 40 } })),
    ).toEqual(['ok']);
  });
});

describe('matching', () => {
  const hooks = (configurations: any[]) => [
    { id: 48211, name: 'MDH', queueIds: [31927], configurations },
  ];

  it('passes VAT matching when the FIRST query reads vendor_vat_id into vat_id', () => {
    const as = evaluateTask(t('matching.vat'), { names, queue, hooks: hooks([vatConfig]) })!;
    expect(states(as)).toEqual(['ok', 'ok']);
  });

  it('names the field the first query reads when it is not the VAT number', () => {
    const byName = {
      ...vatConfig,
      source: { ...vatConfig.source, queries: [...vatConfig.source.queries].reverse() },
    };
    const as = evaluateTask(t('matching.vat'), { names, queue, hooks: hooks([byName]) })!;
    expect(as[1].state).toBe('no');
    expect(as[1].fix).toContain('{sender_name}');
  });

  it('ignores configurations reading another dataset', () => {
    const other = {
      ...vatConfig,
      source: { ...vatConfig.source, dataset: 'af_vendor_master_other_99' },
    };
    const as = evaluateTask(t('matching.vat'), { names, queue, hooks: hooks([other]) })!;
    expect(states(as)).toEqual(['no', 'pending']);
  });

  it('checks the mapping target and the dataset key', () => {
    const wrong = { ...vatConfig, mapping: { target_schema_id: 'sender_match' } };
    const as = evaluateTask(t('matching.map'), { names, queue, hooks: hooks([wrong]) })!;
    expect(states(as)).toEqual(['no', 'no']);
    expect(as[0].fix).toContain('sender_match');
  });

  it('recognises VAT queries written as aggregations too', () => {
    expect(matchesOnVat({ aggregate: [{ $match: { vat_id: '{vendor_vat_id}' } }] })).toBe(true);
    expect(matchesOnVat({ find: { name: '{vendor_vat_id}' } })).toBe(false);
  });
});

describe('rules', () => {
  const rule = (over: Partial<NonNullable<Ctx['rule']>> = {}) => ({
    id: 9031,
    queueIds: [31927],
    condition: 'is_empty(field.po_number)',
    actions: [{ type: 'show_message', enabled: true, payload: { type: 'error', content: 'x' } }],
    ...over,
  });

  it('passes a rule on the queue whose condition reads po_number and shows an error', () => {
    expect(states(evaluateTask(t('rules.create'), { names, queue, rule: rule() }))).toEqual([
      'ok',
      'ok',
    ]);
    expect(states(evaluateTask(t('rules.block'), { names, queue, rule: rule() }))).toEqual([
      'ok',
      'ok',
    ]);
  });

  it('fails a warning, which does not block, and a disabled error action', () => {
    const warning = rule({
      actions: [{ type: 'show_message', enabled: true, payload: { type: 'warning' } }],
    });
    const as = evaluateTask(t('rules.block'), { names, queue, rule: warning })!;
    expect(as[1].state).toBe('no');
    expect(as[1].fix).toContain('`warning`');
    const disabled = rule({
      actions: [{ type: 'show_message', enabled: false, payload: { type: 'error' } }],
    });
    expect(evaluateTask(t('rules.block'), { names, queue, rule: disabled })![1].state).toBe('no');
  });

  it('fails a rule that is not on the trainee’s queue', () => {
    const as = evaluateTask(t('rules.create'), { names, queue, rule: rule({ queueIds: [1] }) })!;
    expect(states(as)).toEqual(['ok', 'no']);
  });
});

describe('go live', () => {
  it('needs an invoice in the queue, then one confirmed with a vendor', () => {
    const empty = { names, queue, annotations: { count: 0, confirmedId: null } };
    expect(states(evaluateTask(t('golive.upload'), empty))).toEqual(['no']);
    const done = { names, queue, annotations: { count: 2, confirmedId: 77 } };
    expect(states(evaluateTask(t('golive.upload'), done))).toEqual(['ok']);
    expect(states(evaluateTask(t('golive.confirm'), done))).toEqual(['ok']);
  });
});

describe('taskOk / buildOf', () => {
  it('passes only a non-empty all-ok list', () => {
    expect(taskOk([])).toBe(false);
    expect(taskOk(null)).toBe(false);
    expect(taskOk([{ id: 'a', label: '', state: 'ok' }])).toBe(true);
  });

  it('returns only the parts the run loaded', () => {
    expect(buildOf({ names, queue })).toEqual({ queueId: 31927 });
    expect(
      buildOf({
        names,
        hooks: [{ id: 48211, name: '', queueIds: [31927], configurations: [vatConfig] }],
      }),
    ).toEqual({ hookId: 48211, matchesOn: 'vat' });
  });
});
