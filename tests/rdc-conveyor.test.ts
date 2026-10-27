import { describe, it, expect } from 'vitest';
import { beltStops, stillPositions } from '../src/rdc/conveyor.js';

describe('conveyor geometry', () => {
  it('stops before the arrowhead', () => {
    expect(beltStops(800)).toEqual({ x0: 6, x1: 730 });
  });
  it('never stops before it starts', () => {
    expect(beltStops(40).x1).toBeGreaterThanOrEqual(6);
  });
  it('places three still icons, increasing', () => {
    const xs = stillPositions(800);
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });
});
