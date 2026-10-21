// Picking a hook configuration — from the filter bar — narrows the grid to it and jumps the
// hook editor to its "{" with a flash. The editor registers its handle here.
import { hookConfigIndex } from '../store.js';
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
