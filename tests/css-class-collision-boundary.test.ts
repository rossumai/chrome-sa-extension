import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { sourceClassNames, globalSheetClassNames } from './support/classNames.js';

// CSS-module / hand-written-class collision boundary.
//
// esbuild's identifier minifier renames CSS Modules' local class names down to short globals in
// dist/console/app.css (and dist/popup/popup.css), and guarantees them unique only AMONG MODULES. A hand-written class our
// code puts in the DOM can therefore receive a module's rule whenever the two names happen to
// coincide — which one is hit changes from build to build. Shipped twice: a generated `.k` drew a
// 320px blob across the Inspector's `class="k"` cells, and a generated `.on` (Academy's legend
// swatch) drew an empty square on every active segmented control.
//
// The invariant: esbuild's minified names match [A-Za-z_][A-Za-z0-9_]* — never a hyphen — so a
// class name WITH a hyphen can never collide. Every class our code can put in the DOM (a class
// string in src/, or a class selector in a built global sheet; see support/classNames.ts for
// what the scanner reads) must contain one, or be on ALLOWLIST below.
//
// ALLOWLIST is a ratchet: it may only shrink. Each entry names the global sheet that styles it
// ('none' when no global sheet does). The CSS Modules migration removes entries as their sheets
// go; the stale-entry test fails when a listed name no longer occurs, so none can linger.
// `permanent` entries are emitted by the document renderer / SpecView and styled by
// src/docs/theme.css; renaming them would change rendered HTML and the docs goldens. For those,
// and for every entry until it is gone, the direct check against the module sheets (app.css,
// popup.css, …) is the protection.
const ROOT = process.cwd();

const GLOBAL_SHEETS = [
  'dist/console/console.base.css',
  'dist/console/doc-theme.css',
  'dist/console/print.css',
  'dist/popup/tokens.css',
  'dist/popup/legacy.css',
  'dist/devtools/tokens.css',
  'dist/devtools/legacy.css',
  'dist/sidepanel/legacy.css',
];

// The sheets esbuild emits from CSS Modules, one per bundle that imports any — each with its own
// minified names. The Console's and the popup's always exist; the others once their bundle
// imports a module, and are checked from then on.
const MODULE_SHEETS = ['dist/console/app.css', 'dist/popup/popup.css'];
const OPTIONAL_MODULE_SHEETS = ['dist/sidepanel/sidepanel.css', 'dist/devtools/panel.css'];

const ALLOWLIST: Record<string, { sheet: string; permanent?: true }> = {
  active: {
    sheet:
      'src/console/legacy/shared.css, src/mdh/legacy.css, src/console/legacy.css, src/fabry/legacy.css, src/docs/theme.css, src/devtools/legacy.css',
    permanent: true,
  },
  added: { sheet: 'src/fabry/legacy.css' },
  anchor: { sheet: 'src/docs/theme.css', permanent: true },
  asc: { sheet: 'src/mdh/legacy.css' },
  bad: { sheet: 'src/fabry/legacy.css' },
  card: { sheet: 'src/popup/legacy.css' },
  copied: { sheet: 'src/docs/theme.css, src/popup/legacy.css', permanent: true },
  danger: { sheet: 'src/fabry/legacy.css' },
  desc: { sheet: 'src/mdh/legacy.css' },
  dimmed: { sheet: 'src/popup/legacy.css' },
  dismiss: { sheet: 'src/mdh/legacy.css' },
  done: { sheet: 'src/mdh/legacy.css' },
  dot: { sheet: 'src/mdh/legacy.css' },
  dragging: { sheet: 'src/mdh/legacy.css, src/fabry/legacy.css' },
  expanded: { sheet: 'src/audit/legacy.css' },
  fail: { sheet: 'src/fabry/legacy.css' },
  failed: {
    sheet: 'src/mdh/legacy.css, src/fabry/legacy.css, src/docs/theme.css',
    permanent: true,
  },
  filter: { sheet: 'src/audit/legacy.css' },
  filters: { sheet: 'src/audit/legacy.css' },
  finished: { sheet: 'src/mdh/legacy.css' },
  footer: { sheet: 'src/popup/legacy.css' },
  header: { sheet: 'src/popup/legacy.css' },
  hidden: { sheet: 'src/galaxy/legacy.css, src/popup/legacy.css' },
  hljs: { sheet: 'src/docs/theme.css', permanent: true },
  inconclusive: { sheet: 'src/fabry/legacy.css' },
  indeterminate: { sheet: 'src/mdh/legacy.css' },
  info: { sheet: 'src/mdh/legacy.css' },
  loading: { sheet: 'none' },
  menuopen: { sheet: 'src/fabry/legacy.css' },
  muted: { sheet: 'src/console/legacy.css' },
  none: { sheet: 'none' },
  off: { sheet: 'src/fabry/legacy.css' },
  offsite: { sheet: 'src/popup/legacy.css' },
  ok: { sheet: 'src/mdh/legacy.css, src/fabry/legacy.css' },
  open: { sheet: 'src/mdh/legacy.css, src/docs/theme.css', permanent: true },
  panel: { sheet: 'src/mdh/legacy.css' },
  partial: { sheet: 'src/mdh/legacy.css' },
  pass: { sheet: 'src/fabry/legacy.css' },
  pending: { sheet: 'src/fabry/legacy.css' },
  reused: { sheet: 'src/fabry/legacy.css' },
  run: { sheet: 'src/fabry/legacy.css' },
  running: { sheet: 'src/mdh/legacy.css, src/fabry/legacy.css' },
  selected: { sheet: 'src/devtools/legacy.css' },
  sidebar: { sheet: 'src/mdh/legacy.css' },
  sidepanel: { sheet: 'src/sidepanel/legacy.css' },
  skipped: { sheet: 'src/fabry/legacy.css' },
  spin: { sheet: 'src/mdh/legacy.css' },
  spinner: { sheet: 'src/mdh/legacy.css' },
  stale: { sheet: 'src/fabry/legacy.css' },
  success: { sheet: 'src/mdh/legacy.css' },
  toc: { sheet: 'src/docs/theme.css', permanent: true },
  toggle: { sheet: 'src/popup/legacy.css' },
  toolbar: { sheet: 'src/mdh/legacy.css' },
  uncertain: { sheet: 'src/fabry/legacy.css' },
  unused: { sheet: 'src/fabry/legacy.css' },
  version: { sheet: 'src/popup/legacy.css' },
  warn: { sheet: 'src/fabry/legacy.css' },
  warning: { sheet: 'src/mdh/legacy.css' },
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
      const offenders = [...union.keys()]
        .filter((n) => topLevel.has(n))
        .map((n) => `${n} @ ${union.get(n)!.join(', ')}`);
      expect(offenders, sheet).toEqual([]);
    }
  });

  it('the on class is gone', () => {
    expect(union.has('on')).toBe(false);
  });
});
