import { useState, useEffect } from 'preact/hooks';
import { loading } from '../store.js';

// A query that answers within this many ms never shows as loading, so typing
// (which auto-runs the pipeline) does not flash the spinner or the empty state.
const SHOW_DELAY = 300;

// True once the store's `loading` has stayed on for SHOW_DELAY, false the
// moment it goes off. Shared by the overlay spinner and the record list's
// empty state, so the two always agree.
export function useDelayedLoading(): boolean {
  const isLoading = loading.value;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => setVisible(true), SHOW_DELAY);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [isLoading]);
  return isLoading && visible;
}
