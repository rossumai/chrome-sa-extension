// @vitest-environment jsdom
// Pipeline Debug while counts are pending, and after the query is cancelled or
// fails (spec 2026-11-23-mdh-loading-states §3.5).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../src/mdh/api.js');

import * as api from '../src/mdh/api.js';
import PipelineDebug from '../src/mdh/components/PipelineDebug.jsx';
import { selectedCollection, queryRun } from '../src/mdh/store.js';

const isStageCount = (pl: any[]) => JSON.stringify(pl[pl.length - 1]) === '{"$count":"n"}';

let signals: AbortSignal[] = [];
let root: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  signals = [];
  selectedCollection.value = 'col';
  queryRun.value = { phase: 'idle' };
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  // Stage 1 answers; stage 2 and the input count never do.
  vi.mocked(api.aggregate).mockImplementation((_c: any, pl: any, opts: any) => {
    signals.push(opts.signal);
    if (isStageCount(pl) && pl.length === 2) return Promise.resolve({ result: [{ n: 7 }] });
    return new Promise(() => {});
  });
});

async function mount() {
  await act(() => {
    render(
      <PipelineDebug
        entries={[
          { disabled: false, stage: { $match: { a: 1 } } },
          { disabled: false, stage: { $limit: 5 } },
        ]}
      />,
      root,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const pendingCells = () => root.querySelectorAll('[data-pending]');

describe('PipelineDebug loading', () => {
  it('pending counts shimmer instead of an ellipsis', async () => {
    await mount();
    expect(root.textContent).toContain('7 docs');
    expect(pendingCells().length).toBe(2); // input + stage 2
    expect(root.textContent).not.toContain('…');
  });

  it('a cancelled query stops the debug: requests abort, unanswered counts read —', async () => {
    await mount();
    await act(() => {
      queryRun.value = { phase: 'cancelled', afterMs: 1000 };
    });
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(pendingCells().length).toBe(0);
    expect(root.textContent).toContain('—');
    expect(root.textContent).toContain('7 docs'); // finished counts stay
  });

  it('a failed query stops it too', async () => {
    await mount();
    await act(() => {
      queryRun.value = { phase: 'failed', message: 'x', timedOut: true, afterMs: 30000 };
    });
    expect(pendingCells().length).toBe(0);
  });
});
