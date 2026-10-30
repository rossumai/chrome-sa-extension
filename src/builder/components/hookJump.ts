// Picking a hook configuration — from the filter bar or the field panel — narrows the grid to
// it and jumps the hook editor to its "{" with a flash. The editor registers its handle here.
import { hookConfigIndex, hookEditor } from '../store.js';
import { openHookEditor } from '../index.jsx';
import { configRange } from '../jsonRanges.js';
import type { CodeEditorHandle } from './CodeEditor.jsx';

export const hookEditorRef: { current: CodeEditorHandle | null } = { current: null };

export function pickHookConfig(index: number | null) {
  hookConfigIndex.value = index;
  if (index == null) return;
  const h = hookEditorRef.current;
  const r = h && configRange(h.getText(), index);
  if (h && r) h.reveal(r.from, r.to);
}

// A configuration to jump to once the hook editor has mounted (see revealPendingConfig).
let pending: number | null = null;

/** Open a hook at one configuration: the grid narrows now, the editor jumps once it exists. */
export function openHookAtConfig(hookId: number, index: number) {
  openHookEditor(hookId);
  if (hookEditor.value?.hookId !== hookId) return; // kept an unsaved rule or hook open
  hookConfigIndex.value = index;
  pending = index;
}

/** Called by the hook editor after its code editor mounted. */
export function revealPendingConfig() {
  if (pending == null) return;
  const i = pending;
  pending = null;
  pickHookConfig(i);
}
