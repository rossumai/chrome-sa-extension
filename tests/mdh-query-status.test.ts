import { describe, it, expect } from 'vitest';
import {
  queryView,
  chipFor,
  slowCause,
  prependSample,
  SHOW_AFTER_MS,
  SLOW_AFTER_MS,
  SAMPLE_SIZE,
  type QueryRun,
} from '../src/mdh/queryStatus.js';
import { applyMutationToText } from '../src/mdh/pipelineComments.js';

const cancel = () => {};
const running = (startedAt = 0): QueryRun => ({ phase: 'running', startedAt, cancel });

describe('queryView', () => {
  it('pending: running under the delay with no records renders nothing', () => {
    expect(queryView(running(), SHOW_AFTER_MS - 1, false).mode).toBe('pending');
  });
  it('records: a fast re-run keeps showing the records', () => {
    expect(queryView(running(), SHOW_AFTER_MS - 1, true).mode).toBe('records');
  });
  it('skeleton: running past the delay with no records', () => {
    expect(queryView(running(), SHOW_AFTER_MS, false).mode).toBe('skeleton');
  });
  it('stale: running past the delay over the previous answer', () => {
    expect(queryView(running(), SHOW_AFTER_MS, true).mode).toBe('stale');
  });
  it('slow from 10 s, with elapsed seconds', () => {
    const v = queryView(running(), SLOW_AFTER_MS + 400, true);
    expect(v.slow).toBe(true);
    expect(v.elapsedS).toBe(10);
    expect(queryView(running(), SLOW_AFTER_MS - 1, true).slow).toBe(false);
  });
  it('cancelled and failed', () => {
    expect(queryView({ phase: 'cancelled', afterMs: 14_000 }, 0, false).mode).toBe('cancelled');
    expect(
      queryView({ phase: 'failed', message: 'x', timedOut: true, afterMs: 30_000 }, 0, false).mode,
    ).toBe('failed');
  });
  it('done: records or empty', () => {
    expect(queryView({ phase: 'done', count: 1, ms: 5 }, 0, true).mode).toBe('records');
    expect(queryView({ phase: 'done', count: 0, ms: 5 }, 0, false).mode).toBe('empty');
    expect(queryView({ phase: 'idle' }, 0, false).mode).toBe('empty');
  });
});

describe('chipFor', () => {
  it('done shows the answer size and time', () => {
    expect(chipFor({ phase: 'done', count: 1, ms: 208 }, 0)).toEqual({
      tone: 'idle',
      text: '1 doc · 208 ms',
      cancellable: false,
    });
    expect(chipFor({ phase: 'done', count: 2, ms: 5 }, 0)!.text).toBe('2 docs · 5 ms');
  });
  it('nothing while idle or under the delay', () => {
    expect(chipFor({ phase: 'idle' }, 0)).toBeNull();
    expect(chipFor(running(), SHOW_AFTER_MS - 1)).toBeNull();
  });
  it('under a second it says only Running…', () => {
    expect(chipFor(running(), 500)!.text).toBe('Running…');
  });
  it('running, then slow, both cancellable', () => {
    expect(chipFor(running(), 2_000)).toEqual({
      tone: 'run',
      text: 'Running · 2 s',
      cancellable: true,
    });
    expect(chipFor(running(), 14_200)).toEqual({
      tone: 'slow',
      text: 'Slow · 14 s',
      cancellable: true,
    });
  });
  it('outcomes', () => {
    expect(chipFor({ phase: 'cancelled', afterMs: 14_900 }, 0)!.text).toBe('Cancelled after 14 s');
    expect(
      chipFor({ phase: 'failed', message: 'x', timedOut: true, afterMs: 30_000 }, 0),
    ).toMatchObject({ tone: 'failed', text: 'Timed out · 30 s' });
    expect(chipFor({ phase: 'failed', message: 'x', timedOut: false, afterMs: 1 }, 0)!.text).toBe(
      'Query failed',
    );
  });
});

describe('slowCause', () => {
  const m = { $match: { 'order.number': 'PO-1', 'order.system': 'Acme ERP' } };
  it('names the first field of a leading $match that no index covers', () => {
    expect(slowCause([m, { $limit: 5 }], [{ key: { _id: 1 } }])).toEqual({ field: 'order.number' });
  });
  it('a compound index helps only through its first key', () => {
    expect(slowCause([m], [{ key: { other: 1, 'order.number': 1 } }])).toEqual({
      field: 'order.number',
    });
  });
  it('no claim when any matched field is indexed', () => {
    expect(slowCause([m], [{ key: { 'order.system': 1, x: 1 } }])).toBeNull();
  });
  it('wildcards cover', () => {
    expect(slowCause([m], [{ key: { '$**': 1 } }])).toBeNull();
    expect(slowCause([m], [{ key: { 'order.$**': 1 } }])).toBeNull();
    expect(slowCause([m], [{ key: { 'other.$**': 1 } }])).toEqual({ field: 'order.number' });
  });
  it('no claim without evidence', () => {
    expect(slowCause([m], null)).toBeNull();
    expect(slowCause([{ $sort: { a: 1 } }, m], [])).toBeNull();
    expect(slowCause([{ $match: { $expr: { $eq: ['$a', 1] } } }], [])).toBeNull();
    expect(slowCause([], [])).toBeNull();
  });
});

describe('prependSample', () => {
  it('puts a $sample first, in place', () => {
    const p: any[] = [{ $limit: 5 }];
    prependSample(p);
    expect(p).toEqual([{ $sample: { size: SAMPLE_SIZE } }, { $limit: 5 }]);
    expect(SAMPLE_SIZE).toBe(10000);
  });
  it('leaves a pipeline that already samples first alone', () => {
    const p = [{ $sample: { size: 5 } }, { $limit: 5 }];
    prependSample(p);
    expect(p).toEqual([{ $sample: { size: 5 } }, { $limit: 5 }]);
  });
  it('works as the editor mutator: the user text and comments survive', () => {
    const text = '[\n  // keep me\n  { "$match": { "a": 1 } },\n  { "$limit": 5 }\n]';
    const next = applyMutationToText(text, prependSample)!;
    expect(next).toContain('// keep me');
    expect(next.indexOf('$sample')).toBeLessThan(next.indexOf('$match'));
    expect(next).toContain('10000');
  });
});
