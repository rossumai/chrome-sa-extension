export type Rect = { left: number; top: number; width: number; height: number };

export const NATURAL_WIDTH = 712;

/** The help window's frame, in viewport pixels. */
export type WinRect = { x: number; y: number; w: number; h: number };

export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MARGIN = 12; // the window stays this far inside every viewport edge
const MIN_W = 360;
const MIN_H = 320;
const DEFAULT_W = 480;
const DEFAULT_TOP = 48; // a bit below the Console's connection bar, so its Help button shows

export type Searchable = { id: string; title: string; keywords: string };

/**
 * Calculate zoom level to fit content in stage width.
 * Returns min(1, (stageWidth − 32) / natural), never below 0.1
 */
export function fitZoom(stageWidth: number, natural = NATURAL_WIDTH): number {
  const zoom = (stageWidth - 32) / natural;
  return Math.max(0.1, Math.min(1, zoom));
}

/**
 * Get target box relative to stage, grown by padding on each side.
 */
export function calloutBox(target: Rect, stage: Rect, pad = 3): Rect {
  return {
    left: target.left - stage.left - pad,
    top: target.top - stage.top - pad,
    width: target.width + pad * 2,
    height: target.height + pad * 2,
  };
}

// the lower bound wins, so a viewport smaller than the minimum still gets the minimum
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Size within [minimum, viewport − margins], then pull the rect wholly inside the margins. */
function fit(r: WinRect, vw: number, vh: number): WinRect {
  const w = clamp(r.w, MIN_W, vw - 2 * MARGIN);
  const h = clamp(r.h, MIN_H, vh - 2 * MARGIN);
  return {
    x: clamp(r.x, MARGIN, vw - MARGIN - w),
    y: clamp(r.y, MARGIN, vh - MARGIN - h),
    w,
    h,
  };
}

/** Docked right, from just below the top bar to the bottom margin. */
export function defaultRect(vw: number, vh: number): WinRect {
  return fit(
    {
      x: vw - DEFAULT_W - MARGIN,
      y: DEFAULT_TOP,
      w: DEFAULT_W,
      h: vh - DEFAULT_TOP - MARGIN,
    },
    vw,
    vh,
  );
}

/** A stored rect, made safe for this viewport. Junk (`r` is untyped storage) gives the default. */
export function clampRect(r: unknown, vw: number, vh: number): WinRect {
  if (!r || typeof r !== 'object') return defaultRect(vw, vh);
  const { x, y, w, h } = r as Record<string, unknown>;
  const nums = [x, y, w, h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return defaultRect(vw, vh);
  return fit(r as WinRect, vw, vh);
}

export function moveRect(r0: WinRect, dx: number, dy: number, vw: number, vh: number): WinRect {
  return fit({ ...r0, x: r0.x + dx, y: r0.y + dy }, vw, vh);
}

/**
 * Drag one edge or corner by (dx, dy). A west or north edge keeps the opposite edge fixed,
 * also when it stops at the minimum size or at the viewport margin.
 */
export function resizeRect(
  r0: WinRect,
  edge: Edge,
  dx: number,
  dy: number,
  vw: number,
  vh: number,
): WinRect {
  let { x, y, w, h } = r0;
  if (edge.includes('e')) w = clamp(r0.w + dx, MIN_W, vw - MARGIN - r0.x);
  if (edge.includes('s')) h = clamp(r0.h + dy, MIN_H, vh - MARGIN - r0.y);
  if (edge.includes('w')) {
    const right = r0.x + r0.w;
    w = clamp(r0.w - dx, MIN_W, right - MARGIN);
    x = right - w;
  }
  if (edge.includes('n')) {
    const bottom = r0.y + r0.h;
    h = clamp(r0.h - dy, MIN_H, bottom - MARGIN);
    y = bottom - h;
  }
  return fit({ x, y, w, h }, vw, vh);
}

/**
 * Match sections by case-insensitive substring search on title + ' ' + keywords.
 * Empty query returns everything.
 */
export function matchSections<T extends Searchable>(sections: T[], q: string): T[] {
  const trimmed = q.trim();

  if (trimmed === '') {
    return sections;
  }

  const query = trimmed.toLowerCase();

  return sections.filter((section) => {
    const searchText = `${section.title} ${section.keywords}`.toLowerCase();
    return searchText.includes(query);
  });
}
