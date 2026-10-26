import { describe, it, expect } from 'vitest';
import { fitColumns, WIDTHS, LABEL_MIN } from '../src/builder/components/columnFit.js';

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe('fitColumns', () => {
  const cols = ['grip', 'id', 'label', 'source', 'type', 'flags', 'rules', 'matching', 'actions'];

  it('gives Label the space left on a small screen', () => {
    const w = fitColumns(cols, 1000);
    expect(sum(w)).toBe(1000);
    expect(w.id).toBe(WIDTHS.id);
  });

  it('keeps Label at its minimum when space runs out (the grid then scrolls)', () => {
    expect(fitColumns(cols, 500).label).toBe(LABEL_MIN);
  });

  it('on a big screen caps Label and ID and leaves the rest blank', () => {
    const w = fitColumns(cols, 2400);
    expect(w.label).toBe(420);
    expect(w.id).toBe(320);
    expect(sum(w)).toBeLessThan(2400);
  });

  it('gives what Label and ID do not take to the Value column', () => {
    const w = fitColumns([...cols, 'value'], 2400);
    expect(sum(w)).toBe(2400);
    expect(w.value).toBeGreaterThan(WIDTHS.value);
  });

  it('without a Label column, widens ID', () => {
    expect(fitColumns(['id', 'mdh'], 360)).toEqual({ id: 250, mdh: 110 });
  });
});
