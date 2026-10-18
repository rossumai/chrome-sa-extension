// src/builder/history.ts
// A linear undo/redo stack over immutable states. A push after an undo drops the
// redo tail, as in every editor.

export type History<T> = { past: T[]; present: T; future: T[] };

export function initHistory<T>(v: T): History<T> {
  return { past: [], present: v, future: [] };
}

export function push<T>(h: History<T>, v: T): History<T> {
  return { past: [...h.past, h.present], present: v, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export function canUndo(h: History<unknown>): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History<unknown>): boolean {
  return h.future.length > 0;
}
