// @vitest-environment jsdom
// The results area's notices (spec 2026-11-23-mdh-loading-states §3.4).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { h, render } from 'preact';
import QueryNotice from '../src/mdh/components/QueryNotice.jsx';
import * as cache from '../src/mdh/cache.js';
import type { QueryRun } from '../src/mdh/queryStatus.js';

const stages = [{ $match: { 'order.number': 'PO-1' } }, { $limit: 5 }];

function mount(props: any) {
  const root = document.createElement('div');
  render(
    <QueryNotice
      collection="po_lines"
      totalCount={52400000}
      stages={stages}
      elapsedS={14}
      onOpenIndexes={() => {}}
      onRunAgain={() => {}}
      onRunOnSample={() => {}}
      {...props}
    />,
    root,
  );
  return root;
}
const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label);
const running = (cancel = vi.fn()): QueryRun => ({ phase: 'running', startedAt: 0, cancel });

beforeEach(() => cache.invalidateAll());

describe('QueryNotice — slow', () => {
  it('names the unindexed field when the indexes are known', () => {
    cache.set('po_lines', 'indexes', [{ name: '_id_', key: { _id: 1 } }]);
    const cancel = vi.fn();
    const onOpenIndexes = vi.fn();
    const root = mount({ kind: 'slow', run: running(cancel), onOpenIndexes });
    const text = root.textContent!;
    expect(text).toContain('This query is taking a while — 14 s');
    expect(text).toContain('po_lines has 52,400,000 records');
    expect(text).toContain('order.number has no index');
    expect(text).toContain('Data Storage stops a request after 30 s.');
    expect(text).toContain('Add an index on order.number in Indexes');
    button(root, 'Open Indexes')!.click();
    expect(onOpenIndexes).toHaveBeenCalledTimes(1);
    button(root, 'Cancel query')!.click();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('claims no cause when the indexes are not cached', () => {
    const root = mount({ kind: 'slow', run: running() });
    expect(root.textContent).not.toContain('has no index');
    expect(root.textContent).toContain('Data Storage stops a request after 30 s.');
  });

  it('omits the size when the total is unknown', () => {
    const root = mount({ kind: 'slow', run: running(), totalCount: null });
    expect(root.textContent).not.toContain('records');
  });
});

describe('QueryNotice — failed', () => {
  it('a timeout is a result with a way forward', () => {
    cache.set('po_lines', 'indexes', [{ key: { _id: 1 } }]);
    const onRunAgain = vi.fn();
    const onRunOnSample = vi.fn();
    const root = mount({
      kind: 'failed',
      run: {
        phase: 'failed',
        message: 'Request timed out after 30s',
        timedOut: true,
        afterMs: 30000,
      },
      onRunAgain,
      onRunOnSample,
    });
    const text = root.textContent!;
    expect(text).toContain('The query did not finish within 30 s');
    expect(text).toContain('Data Storage stops every request after 30 s.');
    expect(text).toContain('Add an index on order.number, then run again');
    expect(text).toContain('Try it on a sample');
    button(root, 'Run on a sample')!.click();
    button(root, 'Run again')!.click();
    expect(onRunOnSample).toHaveBeenCalledTimes(1);
    expect(onRunAgain).toHaveBeenCalledTimes(1);
  });

  it('any other failure shows the API message', () => {
    const onRunAgain = vi.fn();
    const root = mount({
      kind: 'failed',
      run: { phase: 'failed', message: 'unknown operator $matc', timedOut: false, afterMs: 50 },
      onRunAgain,
    });
    expect(root.textContent).toContain('The query failed');
    expect(root.textContent).toContain('unknown operator $matc');
    expect(button(root, 'Run on a sample')).toBeUndefined();
    button(root, 'Run again')!.click();
    expect(onRunAgain).toHaveBeenCalledTimes(1);
  });
});

describe('QueryNotice — stale', () => {
  it('says the records below are the previous run', () => {
    const root = mount({ kind: 'stale', run: running() });
    expect(root.textContent).toContain('Showing the previous run');
  });
});
