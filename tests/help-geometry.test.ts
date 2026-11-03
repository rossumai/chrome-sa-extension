import { describe, it, expect } from 'vitest';
import {
  fitZoom,
  calloutBox,
  defaultRect,
  clampRect,
  moveRect,
  resizeRect,
  matchSections,
  type Rect,
  type WinRect,
  type Searchable,
} from '../src/help/geometry.js';

describe('fitZoom', () => {
  it('returns 1 when stage width is large enough', () => {
    expect(fitZoom(744)).toBe(1);
    expect(fitZoom(2000)).toBe(1);
  });

  it('calculates zoom ratio when stage is narrower than natural width', () => {
    expect(fitZoom(480)).toBeCloseTo(448 / 712, 10);
  });

  it('returns 0.1 as minimum when stage width is very small', () => {
    expect(fitZoom(0)).toBe(0.1);
  });

  it('uses custom natural width when provided', () => {
    const result = fitZoom(744, 800);
    expect(result).toBeCloseTo((744 - 32) / 800, 10);
  });
});

describe('calloutBox', () => {
  it('returns target box relative to stage, grown by padding', () => {
    const target: Rect = { left: 110, top: 220, width: 50, height: 20 };
    const stage: Rect = { left: 100, top: 200, width: 400, height: 300 };
    const result = calloutBox(target, stage, 3);
    expect(result).toEqual({ left: 7, top: 17, width: 56, height: 26 });
  });

  it('uses default padding of 3 when not specified', () => {
    const target: Rect = { left: 110, top: 220, width: 50, height: 20 };
    const stage: Rect = { left: 100, top: 200, width: 400, height: 300 };
    const result = calloutBox(target, stage);
    expect(result).toEqual({ left: 7, top: 17, width: 56, height: 26 });
  });
});

describe('window rect', () => {
  const VW = 1440;
  const VH = 900;
  const r: WinRect = { x: 500, y: 100, w: 480, h: 500 };

  it('opens docked right, a bit below the top bar', () => {
    expect(defaultRect(VW, VH)).toEqual({ x: 948, y: 48, w: 480, h: 840 });
  });

  it('pulls a stored rect back inside the viewport margin', () => {
    expect(clampRect({ x: 2000, y: -50, w: 480, h: 840 }, VW, VH)).toEqual({
      x: 948,
      y: 12,
      w: 480,
      h: 840,
    });
  });

  it('falls back to the default for junk', () => {
    expect(clampRect('x', VW, VH)).toEqual(defaultRect(VW, VH));
    expect(clampRect(null, VW, VH)).toEqual(defaultRect(VW, VH));
    expect(clampRect({ x: 0, y: 0, w: NaN, h: 1 }, VW, VH)).toEqual(defaultRect(VW, VH));
    expect(clampRect({ x: 0, y: 0, w: 400 }, VW, VH)).toEqual(defaultRect(VW, VH));
  });

  it('caps the size at the viewport minus both margins', () => {
    expect(clampRect({ x: 100, y: 100, w: 5000, h: 5000 }, VW, VH)).toEqual({
      x: 12,
      y: 12,
      w: 1416,
      h: 876,
    });
  });

  it('lets the minimum win in a viewport smaller than it', () => {
    expect(clampRect({ x: 50, y: 50, w: 480, h: 840 }, 300, 200)).toEqual({
      x: 12,
      y: 12,
      w: 360,
      h: 320,
    });
    expect(defaultRect(300, 200)).toEqual({ x: 12, y: 12, w: 360, h: 320 });
  });

  it('a west edge keeps the east edge fixed', () => {
    expect(resizeRect(r, 'w', -100, 0, VW, VH)).toEqual({ x: 400, y: 100, w: 580, h: 500 });
  });

  it('a north-west corner stops at the minimum with the opposite corner fixed', () => {
    expect(resizeRect(r, 'nw', 500, 500, VW, VH)).toEqual({ x: 620, y: 280, w: 360, h: 320 });
  });

  it('a west edge dragged off screen stops at the margin, east edge still fixed', () => {
    expect(resizeRect(r, 'w', -1000, 0, VW, VH)).toEqual({ x: 12, y: 100, w: 968, h: 500 });
  });

  it('east and south edges grow from the fixed top-left, up to the margin', () => {
    expect(resizeRect(r, 'se', 40, 30, VW, VH)).toEqual({ x: 500, y: 100, w: 520, h: 530 });
    expect(resizeRect(r, 'e', 5000, 0, VW, VH)).toEqual({ x: 500, y: 100, w: 928, h: 500 });
    expect(resizeRect(r, 's', 0, -5000, VW, VH)).toEqual({ x: 500, y: 100, w: 480, h: 320 });
  });

  it('a corner moves only its own two edges', () => {
    expect(resizeRect(r, 'ne', 20, -20, VW, VH)).toEqual({ x: 500, y: 80, w: 500, h: 520 });
    expect(resizeRect(r, 'sw', 20, 20, VW, VH)).toEqual({ x: 520, y: 100, w: 460, h: 520 });
  });

  it('a move keeps the size and stops at the margins', () => {
    expect(moveRect(r, -100, 50, VW, VH)).toEqual({ x: 400, y: 150, w: 480, h: 500 });
    expect(moveRect(r, 5000, 0, VW, VH)).toEqual({ x: VW - 480 - 12, y: 100, w: 480, h: 500 });
    expect(moveRect(r, 0, -5000, VW, VH)).toEqual({ x: 500, y: 12, w: 480, h: 500 });
  });
});

describe('matchSections', () => {
  const sections: Searchable[] = [
    { id: 'a', title: 'Step 1', keywords: 'token owner' },
    { id: 'b', title: 'Deploy', keywords: 'resume' },
  ];

  it('matches case-insensitive substring in title or keywords', () => {
    const result = matchSections(sections, 'TOKEN');
    expect(result).toEqual([sections[0]]);
  });

  it('returns all sections for empty query', () => {
    const result = matchSections(sections, '  ');
    expect(result).toEqual(sections);
  });

  it('returns empty array for no match', () => {
    const result = matchSections(sections, 'zzz');
    expect(result).toEqual([]);
  });

  it('matches in title', () => {
    const result = matchSections(sections, 'deploy');
    expect(result).toEqual([sections[1]]);
  });

  it('matches in keywords', () => {
    const result = matchSections(sections, 'resume');
    expect(result).toEqual([sections[1]]);
  });

  it('trims whitespace from query before matching', () => {
    const result = matchSections(sections, '  step  ');
    expect(result).toEqual([sections[0]]);
  });
});
