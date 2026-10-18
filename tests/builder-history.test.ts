import { describe, it, expect } from 'vitest';
import { initHistory, push, undo, redo, canUndo, canRedo } from '../src/builder/history.js';

describe('history', () => {
  it('steps back and forward through pushed states', () => {
    let h = push(push(initHistory('a'), 'b'), 'c');
    h = undo(h);
    expect(h.present).toBe('b');
    h = undo(h);
    expect(h.present).toBe('a');
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe('b');
    expect(canRedo(h)).toBe(true);
  });

  it('a push after undo drops the redo tail', () => {
    const h = push(undo(push(initHistory('a'), 'b')), 'x');
    expect(h.present).toBe('x');
    expect(h.future).toEqual([]);
    expect(h.past).toEqual(['a']);
  });

  it('undo and redo at the ends return the same object', () => {
    const h = initHistory('a');
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});
