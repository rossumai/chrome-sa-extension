// Column widths for the grid's measured width. Every column has a base width; Label is
// sized to the space left, between LABEL_MIN and LABEL_MAX. Space beyond that widens ID (up
// to ID_MAX), then the Value column; whatever is left stays blank at the right edge, so the
// columns never drift apart on a big screen.
export const WIDTHS: Record<string, number> = {
  grip: 22,
  id: 200,
  source: 96,
  type: 84,
  ai: 130,
  flags: 110,
  rules: 56,
  matching: 72,
  actions: 60,
  rule: 110,
  mdh: 110,
  value: 160,
};
export const LABEL_MIN = 160;
const LABEL_MAX = 420;
const ID_MAX = 320;

export function fitColumns(cols: string[], avail: number): Record<string, number> {
  const w: Record<string, number> = {};
  for (const c of cols) w[c] = WIDTHS[c] ?? 0;
  let slack = avail - cols.reduce((sum, c) => sum + w[c], 0);
  if (cols.includes('label')) {
    w.label = Math.min(LABEL_MAX, Math.max(LABEL_MIN, slack));
    slack -= w.label;
  }
  if (slack > 0 && cols.includes('id')) {
    const extra = Math.min(slack, ID_MAX - w.id);
    w.id += extra;
    slack -= extra;
  }
  if (slack > 0 && cols.includes('value')) w.value += slack;
  return w;
}
