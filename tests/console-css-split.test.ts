import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

// The Console's global stylesheet is built from per-area partials (CONSOLE_GLOBAL_PARTS in
// build.js): consoleBaseCss() cuts each partial into segments at its `@order N` comments and
// emits the segments of every partial by N, the original rule order of the former
// src/console/console.css monolith. The split was proven against Chrome's CSSOM when it landed
// (rule-for-rule identical); these assertions keep the build honest about what it ships.
const ROOT = process.cwd();
// build.js returns before building when it is required, so this reads the list and builds nothing.
const { CONSOLE_GLOBAL_PARTS, consoleBaseCss } = createRequire(import.meta.url)('../build.js') as {
  CONSOLE_GLOBAL_PARTS: string[];
  consoleBaseCss: () => string;
};
const MARKER = /\/\* @order (\d+) \*\//g;
const ordersOf = (p: string) => [...read(p).matchAll(MARKER)].map((m) => Number(m[1]));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// Top-level statements of a stylesheet: [prelude, block body], comments removed.
function topLevel(css: string): [string, string][] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: [string, string][] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let depth = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    out.push([text.slice(i, open).trim(), text.slice(open + 1, j)]);
    i = j + 1;
  }
  return out;
}

describe('Console global stylesheet partials', () => {
  it('build output equals the segments of CONSOLE_GLOBAL_PARTS merged by order', () => {
    const built = join(ROOT, 'dist/console/console.base.css');
    if (!existsSync(built))
      throw new Error('run `npm run build` before this test — it inspects dist/');
    expect(readFileSync(built, 'utf8')).toBe(consoleBaseCss());
  });

  it('every order number is used once, ascending within each partial', () => {
    const all: number[] = [];
    for (const p of CONSOLE_GLOBAL_PARTS) {
      const orders = ordersOf(p);
      expect(orders.length, p).toBeGreaterThan(0);
      expect(orders, p).toEqual([...orders].sort((a, b) => a - b));
      all.push(...orders);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it('nothing but the header comment precedes a partial’s first segment', () => {
    // consoleBaseCss() drops that text, so a rule placed there would silently not ship.
    for (const p of CONSOLE_GLOBAL_PARTS) {
      const text = read(p);
      const head = text.slice(0, text.search(/\/\* @order \d+ \*\//));
      expect(head.replace(/\/\*[\s\S]*?\*\//g, '').trim(), p).toBe('');
    }
  });

  it('starts with the tokens, and every partial exists', () => {
    expect(CONSOLE_GLOBAL_PARTS[0]).toBe('src/console/tokens.css');
    expect(ordersOf('src/console/tokens.css')[0]).toBe(1);
    for (const p of CONSOLE_GLOBAL_PARTS) expect(existsSync(join(ROOT, p)), p).toBe(true);
  });

  it('tokens.css holds only :root / html / body / @media (prefers-color-scheme) rules', () => {
    const page = /^(:root|html|body)(\s*,\s*(:root|html|body))*$/;
    for (const [prelude, body] of topLevel(read('src/console/tokens.css'))) {
      if (prelude.startsWith('@')) {
        expect(prelude).toMatch(/^@media\s*\(prefers-color-scheme:\s*(dark|light)\)$/);
        for (const [inner] of topLevel(body)) expect(inner).toMatch(page);
      } else expect(prelude).toMatch(page);
    }
  });

  it('every partial says it is global on purpose', () => {
    for (const p of CONSOLE_GLOBAL_PARTS) {
      const head = read(p).slice(0, 2000);
      expect(head, p).toMatch(/^\/\* GLOBAL STYLESHEET/);
      expect(head, p).toContain('must contain a hyphen');
    }
  });
});
