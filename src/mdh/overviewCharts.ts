// Pure layout/scale math for the Overview "Storage map" treemap. No DOM, no
// Preact — everything here is a pure function so it can be unit-tested directly
// (see tests/mdh-overview-charts.test.ts).
//
// Inputs are the same per-collection `rows` the OverviewPanel already builds:
//   { name, count, size, storageSize, avgObjSize, nindexes, totalIndexSize, error? }
// Treemap area encodes the on-disk footprint (storageSize + totalIndexSize —
// MongoDB's `storageSize` excludes indexes, and its `totalSize` is exactly this
// sum); tile color encodes index overhead (totalIndexSize / storageSize).

export const TOP_N = 14;
export const SCALE_MODES = ['linear', 'sqrt', 'log'];

// Color scale stops for index overhead: data-heavy (blue) → teal → index-heavy
// (yellow). Kept in sync with the legend gradient in console.css (.oc-legend-bar).
const SCALE_STOPS: [Rgb, Rgb, Rgb] = [
  [66, 112, 219], // #4270db blue (data-heavy)
  [25, 184, 154], // #19b89a teal
  [245, 197, 24], // #f5c518 yellow (index-heavy)
];

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}
type Rgb = [number, number, number];

function lerp3(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function toHex(c: number) {
  const s = c.toString(16);
  return s.length < 2 ? `0${s}` : s;
}

// ratio (0..∞) → [r,g,b], clamped at 1.0 (100%+ index overhead = the top stop).
// `Number.isFinite` is the guard: a missing ratio colours as zero overhead.
function overheadRgb(ratio: number | null | undefined): Rgb {
  const t = Math.max(0, Math.min(1, Number.isFinite(ratio) ? (ratio as number) : 0));
  const [lo, mid, hi] = SCALE_STOPS;
  return t < 0.5 ? lerp3(lo, mid, t / 0.5) : lerp3(mid, hi, (t - 0.5) / 0.5);
}

export function overheadColor(ratio: number | null | undefined): string {
  const c = overheadRgb(ratio);
  return `#${toHex(c[0])}${toHex(c[1])}${toHex(c[2])}`;
}

// WCAG relative luminance → pick readable tile text over a given overhead color
// (the yellow end is light and needs dark text; the blue end needs white).
function relLuminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function overheadTextColor(ratio: number): string {
  return relLuminance(overheadRgb(ratio)) > 0.45 ? '#10223a' : '#ffffff';
}

// totalIndexSize / storageSize, guarded. 0 when storage is absent/zero.
export function indexOverhead(row: any): number {
  const s = row && row.storageSize;
  if (!s || s <= 0) return 0;
  const i = typeof row.totalIndexSize === 'number' ? row.totalIndexSize : 0;
  return i / s;
}

// On-disk footprint: document storage plus every regular index. Atlas Search
// indexes are not in $collStats, so they are not counted.
export function footprint(row: any): number {
  const s = typeof row?.storageSize === 'number' ? row.storageSize : 0;
  const i = typeof row?.totalIndexSize === 'number' ? row.totalIndexSize : 0;
  return s + i;
}

// Area transform for the treemap. Linear is honest (area = share); sqrt/log
// compress so small collections stay visible when one collection dominates.
export function scaleArea(bytes: number, mode: string): number {
  const b = bytes > 0 ? bytes : 0;
  if (mode === 'sqrt') return Math.sqrt(b);
  if (mode === 'log') return b > 0 ? Math.log10(b + 1) : 0;
  return b;
}

// rows → treemap items: the top `topN` collections by footprint, plus a single
// aggregated "Other (k)" item folding the long tail (or none if it fits). The
// Other item keeps its `members`, largest first, so the tile can name them and
// be area-scaled member by member.
export function treemapItems(rows: any[], topN = TOP_N): any[] {
  const valid = (rows || []).filter(
    (r) => r && !r.error && typeof r.storageSize === 'number' && footprint(r) > 0,
  );
  const sorted = valid.slice().sort((a, b) => footprint(b) - footprint(a));
  const head = sorted.slice(0, topN);
  const tail = sorted.slice(topN);
  const items: any[] = head.map((r) => ({
    name: r.name,
    storageSize: r.storageSize,
    totalIndexSize: r.totalIndexSize,
    footprint: footprint(r),
    overhead: indexOverhead(r),
    isOther: false,
    row: r,
  }));
  if (tail.length) {
    const storageSize = tail.reduce((s: number, r) => s + r.storageSize, 0);
    const totalIndexSize = tail.reduce((s: number, r) => s + (r.totalIndexSize || 0), 0);
    items.push({
      name: `Other (${tail.length})`,
      storageSize,
      totalIndexSize,
      footprint: storageSize + totalIndexSize,
      overhead: storageSize > 0 ? totalIndexSize / storageSize : 0,
      isOther: true,
      memberCount: tail.length,
      members: tail.map((r) => ({ name: r.name, footprint: footprint(r) })),
    });
  }
  return items;
}

// Squarified treemap (Bruls, Huizing & van Wijk). `items` carry a numeric
// `value` (already area-scaled); returns each item augmented with {x,y,w,h}.
export function squarify(items: any[], width: number, height: number): any[] {
  const positive = (items || []).filter((it) => it.value > 0);
  if (positive.length === 0 || width <= 0 || height <= 0) return [];
  const total = positive.reduce((s: number, it) => s + it.value, 0);
  const scale = (width * height) / total;
  const vals = positive.map((it) => ({ it, a: it.value * scale }));

  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  const out: any[] = [];
  let row: any[] = [];

  const worst = (r: any[], side: number) => {
    let sum = 0;
    let mx = 0;
    let mn = Infinity;
    for (const o of r) {
      sum += o.a;
      if (o.a > mx) mx = o.a;
      if (o.a < mn) mn = o.a;
    }
    const s2 = sum * sum;
    const d2 = side * side;
    return Math.max((d2 * mx) / s2, s2 / (d2 * mn));
  };

  const layout = (r: any[]) => {
    let sum = 0;
    for (const o of r) sum += o.a;
    if (w >= h) {
      const sw = sum / h;
      let yy = y;
      for (const o of r) {
        const hh = o.a / sw;
        out.push({ ...o.it, x, y: yy, w: sw, h: hh });
        yy += hh;
      }
      x += sw;
      w -= sw;
    } else {
      const sh = sum / w;
      let xx = x;
      for (const o of r) {
        const ww = o.a / sh;
        out.push({ ...o.it, x: xx, y, w: ww, h: sh });
        xx += ww;
      }
      y += sh;
      h -= sh;
    }
  };

  for (const v of vals) {
    const side = Math.min(w, h);
    if (row.length === 0) {
      row.push(v);
      continue;
    }
    if (worst(row.concat([v]), side) <= worst(row, side)) row.push(v);
    else {
      layout(row);
      row = [v];
    }
  }
  if (row.length) layout(row);
  return out;
}

// Full treemap: items → scaled value → squarified rects → color attached.
// "Other" is scaled member by member and then summed: sqrt and log are
// concave, so scaling the summed bytes would shrink the tail below the area its
// members get as separate tiles. Other stays last even when its area is larger
// than some named tiles: squarify ends its final strip in the bottom-right
// corner, so that is always where Other lands.
export function buildTreemap(
  rows: any[],
  {
    width,
    height,
    topN = TOP_N,
    mode = 'linear',
  }: { width: number; height: number; topN?: number; mode?: string } = {} as any,
) {
  const items = treemapItems(rows, topN).map((it) => ({
    ...it,
    value: it.isOther
      ? it.members.reduce((s: number, m: any) => s + scaleArea(m.footprint, mode), 0)
      : scaleArea(it.footprint, mode),
  }));
  return squarify(items, width, height).map((t) => ({
    ...t,
    color: t.isOther ? null : overheadColor(t.overhead),
    textColor: t.isOther ? null : overheadTextColor(t.overhead),
  }));
}
