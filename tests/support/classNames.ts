// Every class name our own code can put in the DOM, for the collision guard in
// tests/css-class-collision-boundary.test.ts.
//
// Two sources: class strings in src/**/*.ts(x), and class selectors in the built global
// sheets. Both return class -> the files it was seen in.
//
// The source scanner works on WHOLE STATEMENTS, never lines (see the CLAUDE.md trap on line
// scanners): each pattern below finds a starting point and then reads a balanced expression
// forward across any number of newlines. It reads:
//   - `class="…"` / `className="…"` (also inside HTML built as a string, quoted ' or "),
//     including a value that wraps across lines;
//   - `class={…}` / `className={…}` JSX expressions;
//   - `class: …` / `className: …` object properties (`h()` props);
//   - `.className = …` / `+=` assignments;
//   - `classList.add|remove|replace|toggle|contains(…)`, `setAttribute('class', …)`,
//     `attrSet|attrJoin('class', …)` (markdown-it tokens).
// Inside an expression it collects every string literal — `+` pieces, ternary branches,
// template-literal text and the strings inside its `${…}` — except an operand of a comparison
// (`view === 'list'` is not a class). Each string is split on whitespace; a token holding `${`
// is a dynamic fragment and is ignored.
//
// NOT seen: a class string held in a variable first (`const c = a ? 'x' : 'y'; class={c}`).
// None in src/ is hyphen-less today; a new one is invisible to the guard.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const CLASS_TOKEN = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;

function walk(dir: string, filter: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter.test(name)) out.push(p);
  }
  return out;
}

function add(map: Map<string, string[]>, name: string, file: string) {
  const files = map.get(name);
  if (!files) map.set(name, [file]);
  else if (!files.includes(file)) files.push(file);
}

function addTokens(map: Map<string, string[]>, text: string, file: string) {
  for (const tok of text.split(/\s+/)) {
    if (tok.includes('${')) continue;
    if (CLASS_TOKEN.test(tok)) add(map, tok, file);
  }
}

// Index just past the string/template literal opening at `i` (text[i] is the quote).
function skipString(text: string, i: number): number {
  const q = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') j += 2;
    else if (c === q) return j + 1;
    else if (q === '`' && c === '$' && text[j + 1] === '{') j = skipBalanced(text, j + 1) + 1;
    else j++;
  }
  return j;
}

// Index of the bracket closing the one at `i`, skipping string literals.
function skipBalanced(text: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const c = text[j];
    if (c === "'" || c === '"' || c === '`') {
      j = skipString(text, j);
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return j;
}

// End of an unbracketed expression starting at `i` (an assignment's right-hand side, an
// object property's value): the first `;` or `,` at depth 0, a closer that leaves depth 0, or a
// newline at depth 0 that neither ends nor starts a continued line (an operator).
function exprEnd(text: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const c = text[j];
    if (c === "'" || c === '"' || c === '`') {
      j = skipString(text, j);
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) return j;
      depth--;
    } else if (depth === 0 && (c === ';' || c === ',')) return j;
    else if (depth === 0 && c === '\n') {
      const before = text.slice(i, j).trimEnd();
      const after = text.slice(j).trimStart();
      const continues = /[+?:|&(]$/.test(before) || /^[+?:|&.]/.test(after);
      if (!continues && before.length) return j;
    }
    j++;
  }
  return j;
}

// Every string literal in a JS expression into `map`, except:
//   - an operand of a comparison (`view === 'list'`);
//   - a function argument or a member key (`dimClass('rossum')`, `styles['seg_' + s]`) — not
//     the class itself, and what the helper returns is out of reach;
//   - the leading token of a GLUED piece — one appended to a value with no whitespace between,
//     after `+` or right after text in a template (`'type-' + (k || 'unknown')`,
//     `` `culprit-${k || 'none'}` ``): it is the tail of a longer class, not a class.
function collectStrings(map: Map<string, string[]>, expr: string, file: string, glued = false) {
  let j = 0;
  // Set by `+`: the next operand is glued unless the one before it ended in whitespace.
  let pendingGlue = false;
  let prevEndsInSpace = false;
  while (j < expr.length) {
    const c = expr[j];
    if (c === '(' || c === '[' || c === '{') {
      const close = skipBalanced(expr, j);
      const isCallOrMember = c !== '{' && /[A-Za-z0-9_$.)\]]\s*$/.test(expr.slice(0, j));
      if (!isCallOrMember)
        collectStrings(map, expr.slice(j + 1, close), file, glued || pendingGlue);
      pendingGlue = prevEndsInSpace = false;
      j = close + 1;
      continue;
    }
    if (c === '+') {
      pendingGlue = !prevEndsInSpace;
      j++;
      continue;
    }
    if (c !== "'" && c !== '"' && c !== '`') {
      if (!/\s/.test(c)) pendingGlue = prevEndsInSpace = false;
      j++;
      continue;
    }
    const end = skipString(expr, j);
    const compared = /[=!]==?\s*$/.test(expr.slice(0, j)) || /^\s*[=!]==?/.test(expr.slice(end));
    const body = expr.slice(j + 1, end - 1);
    let text = body;
    if (c === '`') {
      // Text with each `${…}` replaced by a marker, then the expressions themselves.
      text = '';
      let k = 0;
      while (k < body.length) {
        if (body[k] === '\\') {
          text += body.slice(k, k + 2);
          k += 2;
        } else if (body[k] === '$' && body[k + 1] === '{') {
          const close = skipBalanced(body, k + 1);
          const gluedHere = text.length > 0 ? !/\s$/.test(text) : glued || pendingGlue;
          if (!compared) collectStrings(map, body.slice(k + 2, close), file, gluedHere);
          text += '${}';
          k = close + 1;
        } else text += body[k++];
      }
    }
    if (!compared)
      addTokens(map, (glued || pendingGlue) && !/^\s/.test(text) ? '${}' + text : text, file);
    prevEndsInSpace = /\s$/.test(text);
    pendingGlue = false;
    j = end;
  }
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');
}

export function scanSource(map: Map<string, string[]>, text: string, file: string) {
  const src = stripComments(text);
  // class="a b" / className='a b' — JSX attributes and HTML built in strings.
  for (const m of src.matchAll(/\bclass(?:Name)?=\\?(["'])([\s\S]*?)\\?\1/g))
    addTokens(map, m[2], file);
  // class={…} — a balanced JSX expression.
  for (const m of src.matchAll(/\bclass(?:Name)?=\{/g)) {
    const open = m.index! + m[0].length - 1;
    collectStrings(map, src.slice(open + 1, skipBalanced(src, open)), file);
  }
  // class: …, className: … (props objects) and .className = / += …
  for (const m of src.matchAll(/(?:\bclass(?:Name)?\s*:|\.className\s*\+?=(?!=))\s*/g)) {
    const start = m.index! + m[0].length;
    collectStrings(map, src.slice(start, exprEnd(src, start)), file);
  }
  // classList.add(…), setAttribute('class', …), attrSet/attrJoin('class', …) — balanced args.
  const calls =
    /(?:\.classList\s*\.\s*(?:add|remove|replace|toggle|contains)\s*\(|\b(?:setAttribute|attrSet|attrJoin)\s*\(\s*(['"])class\1\s*,)/g;
  for (const m of src.matchAll(calls)) {
    const open = m[0].endsWith('(')
      ? m.index! + m[0].length - 1
      : src.lastIndexOf('(', m.index! + m[0].length);
    collectStrings(map, src.slice(m.index! + m[0].length, skipBalanced(src, open)), file);
  }
}

// class -> files, over every .ts/.tsx under `root` (a path relative to the cwd).
export function sourceClassNames(root: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of walk(join(process.cwd(), root), /\.tsx?$/)) {
    if (file.endsWith('.d.ts')) continue;
    scanSource(map, readFileSync(file, 'utf8'), relative(process.cwd(), file));
  }
  return map;
}

// class -> sheets, over the class selectors of the given stylesheets (paths relative to cwd).
export function globalSheetClassNames(paths: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const path of paths) {
    const css = readFileSync(join(process.cwd(), path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
    for (const m of css.matchAll(/([^{};]+)\{/g)) {
      const prelude = m[1].trim();
      if (prelude.startsWith('@')) continue;
      for (const c of prelude.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) add(map, c[1], path);
    }
  }
  return map;
}
