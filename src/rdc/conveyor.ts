// The header band's conveyor geometry. Pure: the component measures the track and asks here.
export const SPAWN_MS = 2700; // one object per spawn, so icons never bunch
export const CROSS_MS = 9000; // one crossing, at one speed
export const FADE = 0.1; // fade in over the first, out over the last, tenth of the crossing
export const ICON_PX = 30;

const X0 = 6;

// Where an icon starts and stops: it halts before the arrowhead (18 right inset, 14 arrow, 8 air).
export function beltStops(trackWidth: number): { x0: number; x1: number } {
  return { x0: X0, x1: Math.max(X0, trackWidth - 18 - 14 - ICON_PX - 8) };
}

// Three icons at rest, for reduced motion: at 1/4, 2/4 and 3/4 of the belt.
export function stillPositions(trackWidth: number): number[] {
  const { x0, x1 } = beltStops(trackWidth);
  return [1, 2, 3].map((i) => x0 + ((x1 - x0) * i) / 4);
}
