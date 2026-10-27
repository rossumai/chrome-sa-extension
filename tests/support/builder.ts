// Shared fixtures for the Builder tests.
import { vi } from 'vitest';
import { Signal } from '@preact/signals';
import * as store from '../../src/builder/store.js';
import * as agentApi from '../../src/agent/agentApi.js';
import { flatten } from '../../src/builder/model.js';

// Every writable store signal with its initial value. A computed's prototype is not
// Signal.prototype, so the filter skips them (they cannot be assigned).
const initial = Object.values(store)
  .filter((s): s is Signal => s instanceof Signal && Object.getPrototypeOf(s) === Signal.prototype)
  .map((s) => [s, s.peek()] as const);

/** Put every store signal back to its initial value, so no test inherits another's state. */
export function resetBuilderStore() {
  for (const [s, v] of initial) s.value = structuredClone(v);
}

/** The flattened row of the node with this schema id. */
export const rowOf = (nodes: any[], id: string) => flatten(nodes).find((r) => r.node.id === id)!;
export const keyOf = (nodes: any[], id: string) => rowOf(nodes, id).key;

// Schema nodes: the label defaults to the id, a datapoint's type to string.
export const section = (id: string, children: any[] = [], extra: any = {}) => ({
  category: 'section',
  id,
  label: id,
  children,
  ...extra,
});
export const dp = (id: string, extra: any = {}) => ({
  category: 'datapoint',
  id,
  label: id,
  type: 'string',
  ...extra,
});

/** Mr. Fabry answers every message with `text`; the persona preamble gets no answer. Needs
 *  `vi.mock('../src/agent/agentApi.js')` in the test file. */
export const fabryReply = (text: string) =>
  vi
    .mocked(agentApi.streamMessage)
    .mockImplementation(async (_id: string, content: string, opts: any) => {
      if (content !== '/persona cautious') opts.onEvent({ type: 'text-delta', delta: text });
    });
