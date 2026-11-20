import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { sourceClassNames, globalSheetClassNames } from './support/classNames.js';

// CSS-module / hand-written-class collision boundary.
//
// esbuild's identifier minifier renames CSS Modules' local class names down to short globals in
// each bundle's module sheet (dist/console/app.css, dist/popup/popup.css, …), and guarantees them
// unique only AMONG MODULES. A hand-written class our code puts in the DOM can therefore receive
// a module's rule whenever the two names happen to coincide — which one is hit changes from
// build to build. Shipped twice: a generated `.k` drew a 320px blob across the Inspector's
// `class="k"` cells, and a generated `.on` (Academy's legend swatch) drew an empty square on
// every active segmented control.
//
// The invariant: esbuild's minified names match [A-Za-z_][A-Za-z0-9_]* — never a hyphen — so a
// class name WITH a hyphen can never collide. Every class our code can put in the DOM (a class
// string in src/, or a class selector in a built global sheet; see support/classNames.ts for
// what the scanner reads) must contain one, or be on ALLOWLIST below.
//
// ALLOWLIST may only shrink, and the stale-entry test fails when a listed name no longer occurs.
// The CSS Modules migration (2026-11-19) emptied it of everything but the `permanent` entries:
// names emitted by the document renderer / SpecView and styled by src/docs/theme.css, which are
// not renamed because that would change rendered HTML and the docs goldens. For those, the
// direct check against the module sheets (app.css, popup.css, …) is the protection. Do not add
// an entry for new code: give the class a hyphen, or make it a CSS Module class.
const ROOT = process.cwd();

const GLOBAL_SHEETS = [
  'dist/console/console.base.css',
  'dist/console/doc-theme.css',
  'dist/console/print.css',
  'dist/popup/tokens.css',
  'dist/devtools/tokens.css',
];

// The sheets esbuild emits from CSS Modules, one per bundle that imports any — each with its own
// minified names. The Console's and the popup's always exist; the others once their bundle
// imports a module, and are checked from then on.
const MODULE_SHEETS = ['dist/console/app.css', 'dist/popup/popup.css'];
const OPTIONAL_MODULE_SHEETS = ['dist/sidepanel/sidepanel.css', 'dist/devtools/panel.css'];

// A module sheet whose page renders only its own bundle is checked against that page's classes
// alone: the source files its entry imports, and the global sheets its page links. A class of
// another page can never meet it — the DevTools panel's minified `.mc` and the Inspector's
// hand-written `mc` live in different documents. A sheet not listed here meets every class.
const PAGE_OF_SHEET: Record<string, { entry: string; sheets: string[] }> = {
  'dist/devtools/panel.css': {
    entry: 'src/devtools/panel.tsx',
    sheets: ['dist/devtools/tokens.css'],
  },
};

// The source files an entry reaches through relative imports (`./x.js` resolves to x.ts or
// x.tsx, `./x.jsx` to x.tsx), as cwd-relative paths. Whole-file regex, so a wrapped import counts.
function reachableSources(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const m of text.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = join(dirname(file), m[1]).replace(/\.jsx?$/, '');
      const hit = ['.ts', '.tsx'].map((ext) => base + ext).find((p) => existsSync(join(ROOT, p)));
      if (hit) todo.push(hit);
    }
  }
  return seen;
}

const ALLOWLIST: Record<string, { sheet: string; permanent?: true }> = {
  active: { sheet: 'src/docs/theme.css', permanent: true },
  anchor: { sheet: 'src/docs/theme.css', permanent: true },
  copied: { sheet: 'src/docs/theme.css', permanent: true },
  failed: { sheet: 'src/docs/theme.css', permanent: true },
  hljs: { sheet: 'src/docs/theme.css', permanent: true },
  open: { sheet: 'src/docs/theme.css', permanent: true },
  toc: { sheet: 'src/docs/theme.css', permanent: true },
  wide: { sheet: 'src/docs/theme.css', permanent: true },
};

// Bare top-level class selectors in the built CSS — `.foo{…}` or `.foo, .bar
// {…}` or `.foo:hover{…}`, but NOT `.foo .bar{…}` or `.foo.bar{…}`.
function topLevelSelectorClasses(css: string) {
  const names = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of m[1].split(',')) {
      const bare = sel.trim().match(/^\.([A-Za-z_][A-Za-z0-9_-]*)(::?[A-Za-z-]+(\([^)]*\))?)?$/);
      if (bare) names.add(bare[1]);
    }
  }
  return names;
}

function domClassNames(): Map<string, string[]> {
  for (const p of [...GLOBAL_SHEETS, ...MODULE_SHEETS]) {
    if (!existsSync(join(ROOT, p)))
      throw new Error('run `npm run build` before this test — it inspects dist/');
  }
  const union = sourceClassNames('src');
  for (const [name, files] of globalSheetClassNames(GLOBAL_SHEETS)) {
    union.set(name, [...(union.get(name) ?? []), ...files]);
  }
  return union;
}

describe('CSS class collision boundary', () => {
  const union = domClassNames();

  it('every DOM class without a hyphen is allowlisted', () => {
    const unlisted = [...union.keys()]
      .filter((n) => !n.includes('-') && !(n in ALLOWLIST))
      .sort()
      .map((n) => `${n} @ ${union.get(n)!.join(', ')}`);
    expect(unlisted).toEqual([]);
  });

  it('no allowlist entry is stale', () => {
    expect(Object.keys(ALLOWLIST).filter((n) => !union.has(n))).toEqual([]);
  });

  it('no DOM class equals a top-level selector in a module sheet', () => {
    for (const sheet of [
      ...MODULE_SHEETS,
      ...OPTIONAL_MODULE_SHEETS.filter((p) => existsSync(join(ROOT, p))),
    ]) {
      const topLevel = topLevelSelectorClasses(readFileSync(join(ROOT, sheet), 'utf8'));
      const page = PAGE_OF_SHEET[sheet];
      const onPage = page && new Set([...reachableSources(page.entry), ...page.sheets]);
      const offenders = [...union.keys()]
        .filter((n) => !onPage || union.get(n)!.some((f) => onPage.has(f)))
        .filter((n) => topLevel.has(n))
        .map((n) => `${n} @ ${union.get(n)!.join(', ')}`);
      expect(offenders, sheet).toEqual([]);
    }
  });

  it('the on class is gone', () => {
    expect(union.has('on')).toBe(false);
  });
});
