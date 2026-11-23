// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import QueryStatus from '../src/mdh/components/QueryStatus.jsx';
import styles from '../src/mdh/components/QueryStatus.module.css';
import { queryRun } from '../src/mdh/store.js';
import { modalContent } from '../src/ui/Modal.jsx';

let root: HTMLElement;

beforeEach(async () => {
  vi.useFakeTimers();
  queryRun.value = { phase: 'idle' };
  root = document.createElement('div');
  document.body.appendChild(root);
  await act(() => {
    render(<QueryStatus />, root);
  });
});
afterEach(async () => {
  await act(() => {
    render(null, root);
  });
  root.remove();
  modalContent.value = null;
  vi.useRealTimers();
});

async function start(cancel = vi.fn()) {
  await act(() => {
    queryRun.value = { phase: 'running', startedAt: Date.now(), cancel };
  });
  return cancel;
}
async function advance(ms: number) {
  await act(() => {
    vi.advanceTimersByTime(ms);
  });
}
const cancelBtn = () =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');

describe('QueryStatus', () => {
  it('shows nothing for a query that answers within 300 ms', async () => {
    await start();
    await advance(250);
    expect(root.textContent).toBe('');
  });

  it('running: elapsed seconds and Cancel', async () => {
    const cancel = await start();
    await advance(1000);
    expect(root.textContent).toContain('Running · 1 s');
    await act(() => {
      cancelBtn()!.click();
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('turns amber at 10 s', async () => {
    await start();
    await advance(10_000);
    expect(root.textContent).toContain('Slow · 10 s');
    expect(root.querySelector('.' + styles.toneSlow)).not.toBeNull();
  });

  it('Esc cancels', async () => {
    const cancel = await start();
    await advance(600); // the chip re-reads the clock every 250 ms
    expect(cancelBtn()).toBeDefined();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('Esc with a modal open belongs to the modal', async () => {
    const cancel = await start();
    await advance(600);
    expect(cancelBtn()).toBeDefined();
    modalContent.value = { title: 'x', render: () => null };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancel).not.toHaveBeenCalled();
  });

  it('shows the outcome once the query answered, without Cancel', async () => {
    await act(() => {
      queryRun.value = { phase: 'done', count: 3, ms: 42 };
    });
    expect(root.textContent).toBe('3 docs · 42 ms');
    expect(cancelBtn()).toBeUndefined();
  });
});
