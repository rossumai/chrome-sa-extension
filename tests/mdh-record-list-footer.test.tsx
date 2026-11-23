// @vitest-environment jsdom
//
// The record-list footer was decluttered to show ONLY "Showing X–Y": the total
// count ("of N in collection (unfiltered)") and the query timing ("· Nms") now
// live in the Aggregate Pipeline Debug, so they were removed here — along with the
// >1s slow-query tint (record-count-slow), which moved to the debug timings.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.chrome = {
  storage: { local: { get: (k: any, cb: any) => cb && cb({}), set() {}, remove() {} } },
} as any;

vi.mock('../src/mdh/api.js');
vi.mock('../src/mdh/components/RecordCard.jsx', () => ({
  default: () => <div class="record-card-stub" />,
}));
vi.mock('../src/mdh/components/StagesView.jsx', () => ({
  default: () => <div class="stages-view-stub" />,
}));

import RecordList from '../src/mdh/components/RecordList.jsx';
import {
  skip,
  limit,
  selectedCollection,
  selectionMode,
  selectedIds,
  selectionPipelineDirty,
  resultsView,
  inspectTarget,
  queryRun,
} from '../src/mdh/store.js';
import seg from '../src/ui/Segmented.module.css';
import pg from '../src/ui/Pagination.module.css';
import recordListCss from '../src/mdh/components/RecordList.module.css';
import jv from '../src/mdh/components/jsonValues.module.css';

const pagination = { hasPrev: () => false, hasNext: () => false, page: () => 1 };

function renderList(props = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <RecordList
      records={[{ _id: '1' }, { _id: '2' }]}
      pipelineText="[]"
      filterState={{}}
      sortState={{}}
      lastQueryMs={0}
      totalCount={null}
      pagination={pagination}
      onSort={() => {}}
      onFilter={() => {}}
      onPageChange={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onRefresh={() => {}}
      downloadState={null}
      onCancelDownload={() => {}}
      onEnterSelectionMode={() => {}}
      onExitSelectionMode={() => {}}
      onBulkDelete={() => {}}
      onBulkUpdate={() => {}}
      onSelectPage={() => {}}
      onClearSelection={() => {}}
      onViewSelected={() => {}}
      {...props}
    />,
    root,
  );
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  skip.value = 0;
  limit.value = 50;
  selectedCollection.value = null;
  selectionMode.value = false;
  selectedIds.value = new Map();
  selectionPipelineDirty.value = false;
  resultsView.value = 'list';
  inspectTarget.value = null;
  queryRun.value = { phase: 'idle' };
});

describe('RecordList view switch', () => {
  it('renders a 3-way segmented switch and switches to Table in one click', async () => {
    const root = renderList();
    expect(root.querySelector('.view-toggle')).toBeNull();
    const group = root.querySelector('.' + seg.root);
    expect(group).not.toBeNull();
    const tableOpt = [...group!.querySelectorAll('.' + seg.opt)].find(
      (b) => b.textContent.trim() === 'Table',
    );
    expect(tableOpt).toBeTruthy();
    // One click switches — no dropdown to open first.
    await act(() => {
      tableOpt!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(root.querySelector(`table.${jv.recordTable}`)).not.toBeNull();
  });

  it('offers exactly List / Table / Stages (no JSON)', () => {
    const root = renderList();
    const labels = [...root.querySelectorAll('.' + seg.opt)].map((b) => b.textContent.trim());
    expect(labels).toEqual(['List', 'Table', 'Stages']);
  });

  it('marks the active view and falls back to List for the legacy "json" value', async () => {
    globalThis.chrome.storage.local.get = ((keys: any, cb: any) =>
      cb({ mdhResultsView: 'json' }) as any as any) as any;
    const root = renderList();
    await act(() => {});
    const active = root.querySelector('.' + seg.opt + '.' + seg.on);
    expect(active).toBeTruthy();
    expect(active!.textContent.trim()).toBe('List');
    expect(root.querySelector(`table.${jv.recordTable}`)).toBeNull();
    globalThis.chrome.storage.local.get = ((k: any, cb: any) =>
      cb && (cb({}) as any as any)) as any;
  });
});

describe('RecordList — stages view', () => {
  it('renders StagesView (not records) and hides pagination when view=stages', () => {
    resultsView.value = 'stages';
    const root = renderList({
      entries: [{ disabled: false, stage: { $match: {} } }],
      onToggleStage() {},
    });
    expect(root.querySelector('.stages-view-stub')).not.toBeNull();
    expect(root.querySelector(`.${recordListCss.recordList}`)).toBeNull();
    expect(root.querySelector('.' + pg.root)).toBeNull();
  });

  it('switches to the Stages view in one click via the segmented switch', async () => {
    const root = renderList();
    const stagesOpt = [...root.querySelectorAll('.' + seg.opt)].find(
      (b) => b.textContent.trim() === 'Stages',
    );
    expect(stagesOpt).toBeTruthy();
    await act(() => {
      stagesOpt!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(resultsView.value).toBe('stages');
    expect(root.querySelector('.stages-view-stub')).not.toBeNull();
  });

  it('shows record-action buttons present-but-disabled in stages view, with an explanatory tooltip; View stays enabled', () => {
    resultsView.value = 'stages';
    const root = renderList({
      entries: [{ disabled: false, stage: { $match: {} } }],
      onToggleStage() {},
    });
    // Select + Expand All are still rendered, inside a greyed/inert group (not removed).
    const selectBtn = [...root.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Select',
    );
    expect(selectBtn).toBeTruthy();
    expect(selectBtn!.closest(`.${recordListCss.toolbarGroupDisabled}`)).not.toBeNull();
    const expandBtn = [...root.querySelectorAll('button')].find((b) =>
      /Expand All|Collapse All/.test(b.textContent),
    );
    expect(expandBtn).toBeTruthy();
    expect(expandBtn!.closest(`.${recordListCss.toolbarGroupDisabled}`)).not.toBeNull();
    // Every disabled group carries a tooltip (title) explaining why it's disabled.
    const disabledGroups = [...root.querySelectorAll(`.${recordListCss.toolbarGroupDisabled}`)];
    expect(disabledGroups.length).toBeGreaterThanOrEqual(2); // Select/Expand group + Download/Bulk/Insert group
    for (const g of disabledGroups) {
      expect((g.getAttribute('title') || '').toLowerCase()).toContain('stages view');
    }
    // The View switch stays enabled (not inside a disabled group).
    const stagesOpt = [...root.querySelectorAll('.' + seg.opt)].find(
      (b) => b.textContent.trim() === 'Stages',
    );
    expect(stagesOpt).toBeTruthy();
    expect(stagesOpt!.closest(`.${recordListCss.toolbarGroupDisabled}`)).toBeNull();
  });
});

describe('RecordList pagination controls', () => {
  function pageButtons(root: HTMLElement) {
    return [...root.querySelectorAll('.' + pg.controls + ' button')] as HTMLButtonElement[];
  }

  it('asks the pagination hook using the pipeline page size', () => {
    const sizes: any[] = [];
    const root = renderList({
      pagination: {
        hasPrev: () => true,
        hasNext: (_n: number, _f: boolean, size: number) => {
          sizes.push(size);
          return true;
        },
        page: (size: number) => {
          sizes.push(size);
          return 2;
        },
      },
      pageWindow: { skipIndex: 1, limitIndex: 2, skip: 10, limit: 10 },
    });
    const [prev, next] = pageButtons(root);
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    expect(sizes).not.toHaveLength(0);
    expect(sizes.every((s) => s === 10)).toBe(true);
  });

  it('disables Prev/Next, with a reason, when the pipeline has no pagination window', () => {
    const root = renderList({
      pagination: { hasPrev: () => true, hasNext: () => true, page: () => 2 },
      pageWindow: null,
    });
    const [prev, next] = pageButtons(root);
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    expect(prev.title).toMatch(/\$skip[\s\S]*\$limit/);
    expect(next.title).toBe(prev.title);
  });
});

describe('RecordList footer', () => {
  it('shows only "Showing X–Y" — no total count, no timing', () => {
    const root = renderList({ totalCount: 162, lastQueryMs: 277 });
    const count = root.querySelector('.record-count')!;
    expect(count).not.toBeNull();
    expect(count.textContent).toBe('Showing 1–2');
    expect(count.textContent).not.toContain('in collection');
    expect(count.textContent).not.toContain('162');
    expect(count.textContent).not.toContain('ms');
  });

  it('still shows "No records" when there are no records', () => {
    const root = renderList({ records: [], totalCount: 162, lastQueryMs: 277 });
    expect(root.querySelector('.record-count')!.textContent).toBe('No records');
  });
});

// Spec 2026-11-23-mdh-loading-states §3.2: the results area's modes.
describe('RecordList while a query runs', () => {
  const MATCH = '[{"$match":{"a":1}}]';
  async function mountRunning(records: any[], elapsedMs: number, props = {}) {
    vi.useFakeTimers();
    queryRun.value = { phase: 'running', startedAt: Date.now(), cancel: () => {} };
    let root!: HTMLElement;
    await act(() => {
      root = renderList({ records, pipelineText: MATCH, ...props });
    });
    await act(() => {
      vi.advanceTimersByTime(elapsedMs);
    });
    return root;
  }
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pending: nothing, and never "0 records match", before 300 ms', async () => {
    const root = await mountRunning([], 0);
    expect(root.textContent).not.toContain('0 records match');
    expect(root.querySelectorAll('[data-skeleton]').length).toBe(0);
  });

  it('skeleton: placeholder rows once the query takes a while', async () => {
    const root = await mountRunning([], 600);
    expect(root.querySelectorAll('[data-skeleton]').length).toBe(10);
    expect(root.textContent).not.toContain('0 records match');
  });

  it('stale: the previous answer stays, faded and marked', async () => {
    const root = await mountRunning([{ _id: '1' }], 600);
    expect(root.querySelector('[data-stale]')).not.toBeNull();
    expect(root.querySelectorAll('.record-card-stub').length).toBe(1);
    expect(root.textContent).toContain('Showing the previous run');
    expect(root.textContent).toContain('previous run');
  });

  it('slow: the explanation replaces the stale note at 10 s', async () => {
    const onOpenIndexes = vi.fn();
    const root = await mountRunning([{ _id: '1' }], 10_000, { onOpenIndexes });
    expect(root.textContent).toContain('This query is taking a while');
    expect(root.textContent).not.toContain('Showing the previous run');
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Open Indexes')!;
    btn.click();
    expect(onOpenIndexes).toHaveBeenCalledTimes(1);
  });

  it('the toolbar carries the status chip', async () => {
    const root = await mountRunning([], 1_000);
    expect(root.textContent).toContain('Running · 1 s');
  });
});

describe('RecordList after the query', () => {
  it('cancelled: says so, how long it ran, and offers to run it again', async () => {
    queryRun.value = { phase: 'cancelled', afterMs: 14_200 };
    const onRunAgain = vi.fn();
    const root = renderList({ records: [], pipelineText: '[{"$match":{"a":1}}]', onRunAgain });
    expect(root.textContent).toContain('Query cancelled after 14 s');
    expect(root.textContent).toContain('Data Storage may still finish the work on its side');
    expect(root.textContent).not.toContain('0 records match');
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Run again')!;
    await act(() => {
      btn.click();
    });
    expect(onRunAgain).toHaveBeenCalledTimes(1);
  });

  it('timed out: the notice, not an empty state', () => {
    queryRun.value = { phase: 'failed', message: 'x', timedOut: true, afterMs: 30_000 };
    const onRunOnSample = vi.fn();
    const root = renderList({ records: [], pipelineText: '[{"$match":{"a":1}}]', onRunOnSample });
    expect(root.textContent).toContain('The query did not finish within 30 s');
    expect(root.textContent).not.toContain('0 records match');
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Run on a sample')!.click();
    expect(onRunOnSample).toHaveBeenCalledTimes(1);
  });

  it('done with nothing: 0 records match', () => {
    queryRun.value = { phase: 'done', count: 0, ms: 4 };
    const root = renderList({ records: [], pipelineText: '[{"$match":{"a":1}}]' });
    expect(root.textContent).toContain('0 records match');
  });
});
