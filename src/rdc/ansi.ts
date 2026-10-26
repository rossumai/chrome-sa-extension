// rdc's log lines carry ANSI colour (its embedding path always logs in colour mode). This
// turns one line into styled segments: SGR only — reset, bold, dim, italic, underline and
// the foreground colour (16 basic, 256-colour, 24-bit, default). Every other SGR code is
// ignored, and every other escape sequence (cursor moves, line clearing, OSC) is removed,
// so no raw escape ever reaches the page. No dependency, no eval, no HTML.

export type AnsiStyle = {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** A CSS colour: `var(--rdc-ansi-N)` for the 16 basic ones, `rgb(…)` otherwise. */
  color?: string;
};
export type AnsiSegment = { text: string; style: AnsiStyle };

// CSI (`ESC [ params final`), OSC (`ESC ] … BEL|ESC \`), any other `ESC [intermediates] x`
// (`ESC 7`, `ESC ( B`), and a lone trailing ESC.
const ESCAPE =
  /\x1b\[([0-9;:?<=>]*)[ -/]*([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[ -/]*[0-~]?/g;

// The 16 basic colours are theme tokens (App.module.css), so they follow light and dark.
const basic = (n: number) => `var(--rdc-ansi-${n})`;

function color256(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
  if (n < 16) return basic(n);
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v}, ${v}, ${v})`;
  }
  const i = n - 16;
  const step = (c: number) => (c === 0 ? 0 : 55 + c * 40);
  return `rgb(${step(Math.floor(i / 36))}, ${step(Math.floor(i / 6) % 6)}, ${step(i % 6)})`;
}

// Applies one SGR parameter list to `s` (a fresh copy is returned).
function applySgr(params: string, s: AnsiStyle): AnsiStyle {
  const codes = params === '' ? [0] : params.split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
  let next: AnsiStyle = { ...s };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) next = {};
    else if (c === 1) next.bold = true;
    else if (c === 2) next.dim = true;
    else if (c === 3) next.italic = true;
    else if (c === 4) next.underline = true;
    else if (c >= 30 && c <= 37) next.color = basic(c - 30);
    else if (c >= 90 && c <= 97) next.color = basic(c - 90 + 8);
    else if (c === 39) delete next.color;
    else if (c === 38 || c === 48 || c === 58) {
      // Extended colour: consume its arguments whatever it is, so they are never read as
      // codes of their own. Only the foreground (38) is applied.
      let color: string | undefined;
      if (codes[i + 1] === 5) {
        color = color256(codes[i + 2]);
        i += 2;
      } else if (codes[i + 1] === 2) {
        const [r, g, b] = codes.slice(i + 2, i + 5);
        if ([r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
          color = `rgb(${r}, ${g}, ${b})`;
        i += 4;
      } else break; // malformed: the rest of the list cannot be read reliably
      if (c === 38 && color) next.color = color;
    }
    // anything else: ignored
  }
  return next;
}

const KEYS = ['bold', 'dim', 'italic', 'underline', 'color'] as const;
const sameStyle = (a: AnsiStyle, b: AnsiStyle) => KEYS.every((k) => a[k] === b[k]);

export function parseAnsi(line: string): AnsiSegment[] {
  const out: AnsiSegment[] = [];
  let style: AnsiStyle = {};
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && sameStyle(prev.style, style)) prev.text += text;
    else out.push({ text, style });
  };
  for (const m of line.matchAll(ESCAPE)) {
    push(line.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] === 'm') style = applySgr(m[1], style);
  }
  push(line.slice(last));
  return out;
}
