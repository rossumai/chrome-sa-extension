// Shared fixtures for the Builder tests.
import { Signal } from '@preact/signals';
import * as store from '../../src/builder/store.js';

// Every writable store signal with its initial value. A computed's prototype is not
// Signal.prototype, so the filter skips them (they cannot be assigned).
const initial = Object.values(store)
  .filter((s): s is Signal => s instanceof Signal && Object.getPrototypeOf(s) === Signal.prototype)
  .map((s) => [s, s.peek()] as const);

/** Put every store signal back to its initial value, so no test inherits another's state. */
export function resetBuilderStore() {
  for (const [s, v] of initial) s.value = structuredClone(v);
}
