import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

// The popup, side panel and DevTools pages link their GLOBAL sheets first — tokens.css, then
// legacy.css where one is left, both copied by build.js — and then the sheet esbuild emits beside the page's bundle
// from its imported *.module.css. The global sheets are named so that esbuild can never write
// over one (the emitted sheet takes the bundle's name: popup.css, sidepanel.css, panel.css).
// These assertions read the BUILT pages, since a link to a missing sheet fails silently.
const DIST = join(process.cwd(), 'dist');
const SRC = join(process.cwd(), 'src');

// page → the sheet esbuild emits for its bundle, when the bundle imports any CSS Module
const PAGES: Record<string, string> = {
  'popup/popup.html': 'popup/popup.css',
  'sidepanel/sidepanel.html': 'sidepanel/sidepanel.css',
  'devtools/panel.html': 'devtools/panel.css',
};

// Stylesheet hrefs of a built page, in link order, resolved against dist/.
function linkedSheets(page: string): string[] {
  const path = join(DIST, page);
  if (!existsSync(path))
    throw new Error('run `npm run build` before this test — it inspects dist/');
  const html = readFileSync(path, 'utf8');
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /rel=["']?stylesheet/.test(tag))
    .map((tag) => /href=["']([^"']+)["']/.exec(tag)![1])
    .map((href) => join(dirname(page), href));
}

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

describe('popup, side panel and DevTools stylesheets', () => {
  it('every linked stylesheet exists', () => {
    for (const page of Object.keys(PAGES)) {
      for (const sheet of linkedSheets(page))
        expect(existsSync(join(DIST, sheet)), sheet).toBe(true);
    }
  });

  it('each page links its tokens first', () => {
    expect(linkedSheets('popup/popup.html').slice(0, 1)).toEqual(['popup/tokens.css']);
    // The side panel shares the popup's tokens; the MDH card's modules ride in its own bundle sheet.
    expect(linkedSheets('sidepanel/sidepanel.html').slice(0, 1)).toEqual(['popup/tokens.css']);
    expect(linkedSheets('devtools/panel.html')).toEqual([
      'devtools/tokens.css',
      'devtools/panel.css',
    ]);
  });

  it('a bundle sheet esbuild emitted is linked, and linked last', () => {
    for (const [page, emitted] of Object.entries(PAGES)) {
      const sheets = linkedSheets(page);
      if (existsSync(join(DIST, emitted))) expect(sheets.at(-1), page).toBe(emitted);
      else expect(sheets, page).not.toContain(emitted);
    }
  });

  it('the popup bundle emits its module sheet, after the copied tokens', () => {
    // App.module.css is imported, so esbuild writes dist/popup/popup.css. It must be module
    // output, not a copy of a global sheet: the accent bar's rule, and no :root tokens.
    const emitted = readFileSync(join(DIST, 'popup/popup.css'), 'utf8');
    expect(emitted).toContain('linear-gradient(');
    expect(emitted).not.toContain(':root');
    const tokens = readFileSync(join(DIST, 'popup/tokens.css'), 'utf8');
    expect(tokens).toMatch(/:root\s*\{[^}]*--accent:/);
  });

  it('tokens.css holds only :root / html / body / @media (prefers-color-scheme) rules', () => {
    const page = /^(:root(\[[^\]]+\]|:not\(\[[^\]]+\]\))?|html|body)(\s*,\s*(html|body))*$/;
    for (const p of ['popup/tokens.css', 'devtools/tokens.css']) {
      for (const [prelude, body] of topLevel(readFileSync(join(SRC, p), 'utf8'))) {
        if (prelude.startsWith('@')) {
          expect(prelude, p).toMatch(/^@media\s*\(prefers-color-scheme:\s*(dark|light)\)$/);
          for (const [inner] of topLevel(body)) expect(inner, p).toMatch(page);
        } else expect(prelude, p).toMatch(page);
      }
    }
  });

  it('every global sheet says it is global on purpose', () => {
    for (const p of ['popup/tokens.css', 'devtools/tokens.css']) {
      const head = readFileSync(join(SRC, p), 'utf8').slice(0, 2000);
      expect(head, p).toMatch(/^\/\* GLOBAL STYLESHEET/);
      expect(head, p).toContain('must contain a hyphen');
    }
  });
});
