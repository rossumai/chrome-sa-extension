import { describe, it, expect } from 'vitest';
import {
  overheadColor,
  overheadTextColor,
  indexOverhead,
  footprint,
  scaleArea,
  treemapItems,
  squarify,
  buildTreemap,
  TOP_N,
  SCALE_MODES,
} from '../src/mdh/overviewCharts.js';

const MiB = 1024 * 1024;

describe('overheadColor', () => {
  it('maps the scale endpoints and midpoint to the legend colors (blue→teal→yellow)', () => {
    expect(overheadColor(0)).toBe('#4270db'); // data-heavy (blue)
    expect(overheadColor(0.5)).toBe('#19b89a'); // teal
    expect(overheadColor(1)).toBe('#f5c518'); // index-heavy (yellow)
  });
  it('clamps out-of-range and non-finite ratios', () => {
    expect(overheadColor(-3)).toBe('#4270db');
    expect(overheadColor(5)).toBe('#f5c518');
    expect(overheadColor(NaN)).toBe('#4270db');
    expect(overheadColor(undefined)).toBe('#4270db');
  });
});

describe('overheadTextColor', () => {
  it('uses white text on the dark blue end and dark text on the light yellow end', () => {
    expect(overheadTextColor(0)).toBe('#ffffff'); // over blue
    expect(overheadTextColor(1)).toBe('#10223a'); // over yellow
  });
});

describe('indexOverhead', () => {
  it('returns totalIndexSize / storageSize', () => {
    expect(indexOverhead({ storageSize: 100, totalIndexSize: 50 })).toBe(0.5);
  });
  it('guards zero/absent storage and absent index size', () => {
    expect(indexOverhead({ storageSize: 0, totalIndexSize: 50 })).toBe(0);
    expect(indexOverhead({ storageSize: 100 })).toBe(0);
    expect(indexOverhead({})).toBe(0);
  });
});

describe('footprint', () => {
  it('adds index bytes to document storage, as MongoDB totalSize does', () => {
    expect(footprint({ storageSize: 10, totalIndexSize: 4 })).toBe(14);
  });
  it('treats an absent side as zero', () => {
    expect(footprint({ storageSize: 10 })).toBe(10);
    expect(footprint({ totalIndexSize: 4 })).toBe(4);
    expect(footprint(null)).toBe(0);
  });
});

describe('scaleArea', () => {
  it('linear is identity, zero/negative collapse to 0', () => {
    expect(scaleArea(1000, 'linear')).toBe(1000);
    expect(scaleArea(0, 'linear')).toBe(0);
    expect(scaleArea(-5, 'linear')).toBe(0);
  });
  it('sqrt and log are monotonic and compress spread', () => {
    expect(scaleArea(100, 'sqrt')).toBe(10);
    // log keeps order but shrinks a 1000x gap to a small factor
    const lo = scaleArea(1024, 'log');
    const hi = scaleArea(1024 * 1000, 'log');
    expect(hi).toBeGreaterThan(lo);
    expect(hi / lo).toBeLessThan(3); // strongly compressed vs linear's 1000x
  });
  it('preserves ordering across all modes', () => {
    for (const m of SCALE_MODES) {
      expect(scaleArea(2 * MiB, m)).toBeGreaterThan(scaleArea(1 * MiB, m));
    }
  });
});

describe('treemapItems', () => {
  const rows = [
    { name: 'a', storageSize: 50 * MiB, totalIndexSize: 5 * MiB },
    { name: 'b', storageSize: 30 * MiB, totalIndexSize: 3 * MiB },
    { name: 'c', storageSize: 10 * MiB, totalIndexSize: 1 * MiB },
    { name: 'd', storageSize: 4 * MiB, totalIndexSize: 2 * MiB },
    { name: 'err', error: 'boom' },
    { name: 'empty', storageSize: 0 },
    { name: 'nostat' },
  ];

  it('excludes errored, zero-storage and unloaded rows', () => {
    const items = treemapItems(rows, 10);
    expect(items.map((i) => i.name)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('folds the tail into a single "Other (k)" item', () => {
    const items = treemapItems(rows, 2);
    expect(items.map((i) => i.name)).toEqual(['a', 'b', 'Other (2)']);
    const other = items[2];
    expect(other.isOther).toBe(true);
    expect(other.memberCount).toBe(2);
    expect(other.storageSize).toBe(14 * MiB); // c + d
    expect(other.totalIndexSize).toBe(3 * MiB);
    expect(other.footprint).toBe(17 * MiB);
    expect(other.overhead).toBeCloseTo((3 * MiB) / (14 * MiB), 6);
    expect(other.members).toEqual([
      { name: 'c', footprint: 11 * MiB },
      { name: 'd', footprint: 6 * MiB },
    ]);
  });

  it('ranks by footprint, so a small collection with large indexes moves up', () => {
    const items = treemapItems(
      [
        { name: 'data', storageSize: 10 * MiB, totalIndexSize: 0 },
        { name: 'indexed', storageSize: 4 * MiB, totalIndexSize: 20 * MiB },
      ],
      10,
    );
    expect(items.map((i) => i.name)).toEqual(['indexed', 'data']);
  });

  it('sorts by storage descending and adds no Other when the tail is empty', () => {
    const items = treemapItems(rows, 10);
    expect(items.some((i) => i.isOther)).toBe(false);
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].footprint).toBeGreaterThanOrEqual(items[i].footprint);
    }
  });
});

describe('squarify', () => {
  it('lays out one rect per positive item and conserves total area', () => {
    const items = [
      { name: 'a', value: 50 },
      { name: 'b', value: 30 },
      { name: 'c', value: 15 },
      { name: 'd', value: 5 },
    ];
    const W = 400;
    const H = 300;
    const rects = squarify(items, W, H);
    expect(rects).toHaveLength(4);
    const area = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(area).toBeCloseTo(W * H, 2);
    for (const r of rects) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(W + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(H + 1e-6);
    }
  });
  it('areas are proportional to value', () => {
    const items = [
      { name: 'big', value: 75 },
      { name: 'small', value: 25 },
    ];
    const rects = squarify(items, 200, 200);
    const byName = Object.fromEntries(rects.map((r) => [r.name, r.w * r.h]));
    expect(byName.big / byName.small).toBeCloseTo(3, 1);
  });
  it('returns [] for empty input or zero size', () => {
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify([{ value: 10 }], 0, 100)).toEqual([]);
    expect(squarify([{ value: 0 }], 100, 100)).toEqual([]);
  });
});

describe('buildTreemap', () => {
  const rows = [
    { name: 'a', storageSize: 40 * MiB, totalIndexSize: 0 },
    { name: 'b', storageSize: 20 * MiB, totalIndexSize: 40 * MiB }, // 200% overhead → red
  ];
  it('colors data tiles and leaves Other uncolored', () => {
    const tiles = buildTreemap(
      [
        ...rows,
        { name: 'c', storageSize: 1 * MiB, totalIndexSize: 0 },
        { name: 'd', storageSize: 0.5 * MiB, totalIndexSize: 0 },
      ],
      { width: 300, height: 200, topN: 2, mode: 'linear' },
    );
    const other = tiles.find((t) => t.isOther);
    expect(other.color).toBeNull();
    const b = tiles.find((t) => t.name === 'b');
    expect(b.color).toBe('#f5c518'); // 200% overhead clamps to the yellow end
    expect(b.textColor).toBe('#10223a'); // dark text over yellow
    const a = tiles.find((t) => t.name === 'a');
    expect(a.color).toBe('#4270db'); // zero overhead → blue
    expect(a.textColor).toBe('#ffffff'); // white text over blue
  });
});

describe('buildTreemap area', () => {
  const area = (t: any) => t.w * t.h;
  it('sizes tiles by footprint (data + indexes) in linear mode', () => {
    const tiles = buildTreemap(
      [
        { name: 'a', storageSize: 10 * MiB, totalIndexSize: 30 * MiB }, // 40 MiB
        { name: 'b', storageSize: 20 * MiB, totalIndexSize: 0 }, // 20 MiB
      ],
      { width: 300, height: 200, mode: 'linear' },
    );
    const by = Object.fromEntries(tiles.map((t) => [t.name, area(t)]));
    expect(by.a / by.b).toBeCloseTo(2, 6);
  });
  it('scales Other member by member, so it matches the members as separate tiles', () => {
    const rows = [
      { name: 'a', storageSize: 100 * MiB, totalIndexSize: 0 },
      { name: 'b', storageSize: 1 * MiB, totalIndexSize: 0 },
      { name: 'c', storageSize: 1 * MiB, totalIndexSize: 0 },
    ];
    for (const mode of ['sqrt', 'log']) {
      const folded = buildTreemap(rows, { width: 300, height: 200, topN: 1, mode });
      const open = buildTreemap(rows, { width: 300, height: 200, topN: 10, mode });
      const other = folded.find((t) => t.isOther);
      const members = open.filter((t) => t.name !== 'a').reduce((s, t) => s + area(t), 0);
      expect(area(other)).toBeCloseTo(members, 6);
    }
  });
});

describe('buildTreemap Other placement', () => {
  it('puts Other in the bottom-right corner in every mode, even when it outweighs named tiles', () => {
    const rows = [{ name: 'a', storageSize: 100 * MiB, totalIndexSize: 0 }];
    // 20 small collections: summed they are bigger than 'b' and 'c' in every mode.
    rows.push({ name: 'b', storageSize: 8 * MiB, totalIndexSize: 0 });
    rows.push({ name: 'c', storageSize: 6 * MiB, totalIndexSize: 0 });
    for (let i = 0; i < 20; i++)
      rows.push({ name: `t${i}`, storageSize: 1 * MiB, totalIndexSize: 0 });
    for (const mode of SCALE_MODES) {
      for (const [W, H] of [
        [300, 200],
        [200, 300],
      ]) {
        const tiles = buildTreemap(rows, { width: W, height: H, topN: 3, mode });
        const other = tiles[tiles.length - 1];
        expect(other.isOther).toBe(true);
        expect(other.x + other.w).toBeCloseTo(W, 6);
        expect(other.y + other.h).toBeCloseTo(H, 6);
      }
    }
  });
});

describe('module constants', () => {
  it('exposes a sane TOP_N and the three scale modes', () => {
    expect(TOP_N).toBeGreaterThan(0);
    expect(SCALE_MODES).toEqual(['linear', 'sqrt', 'log']);
  });
});
