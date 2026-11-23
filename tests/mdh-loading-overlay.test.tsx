// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import LoadingOverlay from '../src/mdh/components/LoadingOverlay.jsx';
import styles from '../src/mdh/components/LoadingOverlay.module.css';
import { loading } from '../src/mdh/store.js';

let root: HTMLElement;
beforeEach(async () => {
  vi.useFakeTimers();
  loading.value = false;
  root = document.createElement('div');
  await act(() => {
    render(<LoadingOverlay />, root);
  });
});
afterEach(() => {
  loading.value = false;
  vi.useRealTimers();
});

const visible = () => root.querySelector('.' + styles.loadingOverlayVisible) !== null;

describe('LoadingOverlay', () => {
  it('stays hidden for a load that ends within 300 ms', async () => {
    await act(() => {
      loading.value = true;
    });
    await act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(visible()).toBe(false);
  });

  it('shows the plain spinner for a longer load, with no Cancel', async () => {
    await act(() => {
      loading.value = true;
    });
    await act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(visible()).toBe(true);
    expect(root.querySelector('button')).toBeNull();
  });
});
