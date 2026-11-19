import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { sourceClassNames, globalSheetClassNames } from './support/classNames.js';

// CSS-module / hand-written-class collision boundary.
//
// esbuild's identifier minifier renames CSS Modules' local class names down to short globals in
// dist/console/app.css, and guarantees them unique only AMONG MODULES. A hand-written class our
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
// and for every entry until it is gone, the direct check against app.css is the protection.
const ROOT = process.cwd();

const GLOBAL_SHEETS = [
  'dist/console/console.base.css',
  'dist/console/doc-theme.css',
  'dist/console/print.css',
  'dist/popup/popup.css',
  'dist/devtools/panel.css',
  'dist/sidepanel/sidepanel.css',
];

const ALLOWLIST: Record<string, { sheet: string; permanent?: true }> = {
  active: {
    sheet: 'src/console/console.css, src/docs/theme.css, src/devtools/panel.css',
    permanent: true,
  },
  added: { sheet: 'src/console/console.css' },
  anchor: { sheet: 'src/docs/theme.css', permanent: true },
  asc: { sheet: 'src/console/console.css' },
  bad: { sheet: 'src/console/console.css' },
  body: { sheet: 'src/console/console.css' },
  btn: { sheet: 'src/console/console.css' },
  busy: { sheet: 'src/console/console.css' },
  card: { sheet: 'src/popup/popup.css' },
  copied: { sheet: 'src/docs/theme.css, src/popup/popup.css', permanent: true },
  current: { sheet: 'src/console/console.css' },
  danger: { sheet: 'src/console/console.css' },
  desc: { sheet: 'src/console/console.css' },
  dimmed: { sheet: 'src/popup/popup.css' },
  dismiss: { sheet: 'src/console/console.css' },
  done: { sheet: 'src/console/console.css' },
  dot: { sheet: 'src/console/console.css' },
  dragging: { sheet: 'src/console/console.css' },
  error: { sheet: 'src/console/console.css' },
  expanded: { sheet: 'src/console/console.css' },
  fail: { sheet: 'src/console/console.css' },
  failed: { sheet: 'src/console/console.css, src/docs/theme.css', permanent: true },
  filter: { sheet: 'src/console/console.css' },
  filters: { sheet: 'src/console/console.css' },
  finished: { sheet: 'src/console/console.css' },
  fname: { sheet: 'src/console/console.css' },
  footer: { sheet: 'src/popup/popup.css' },
  header: { sheet: 'src/popup/popup.css' },
  hidden: { sheet: 'src/console/console.css, src/popup/popup.css' },
  hljs: { sheet: 'src/docs/theme.css', permanent: true },
  inconclusive: { sheet: 'src/console/console.css' },
  indeterminate: { sheet: 'src/console/console.css' },
  info: { sheet: 'src/console/console.css' },
  input: { sheet: 'src/console/console.css' },
  lbl: { sheet: 'src/console/console.css' },
  loading: { sheet: 'none' },
  main: { sheet: 'src/console/console.css' },
  mc: { sheet: 'src/console/console.css' },
  menuopen: { sheet: 'src/console/console.css' },
  meta: { sheet: 'src/console/console.css' },
  mono: { sheet: 'src/console/console.css' },
  muted: { sheet: 'src/console/console.css' },
  name: { sheet: 'src/console/console.css' },
  nm: { sheet: 'src/console/console.css' },
  nocolor: { sheet: 'src/console/console.css' },
  none: { sheet: 'src/console/console.css' },
  off: { sheet: 'src/console/console.css' },
  offsite: { sheet: 'src/popup/popup.css' },
  ok: { sheet: 'src/console/console.css' },
  open: { sheet: 'src/console/console.css, src/docs/theme.css', permanent: true },
  pagination: { sheet: 'src/console/console.css' },
  panel: { sheet: 'src/console/console.css' },
  partial: { sheet: 'src/console/console.css' },
  pass: { sheet: 'src/console/console.css' },
  pend: { sheet: 'src/console/console.css' },
  pending: { sheet: 'src/console/console.css' },
  ran: { sheet: 'src/console/console.css' },
  rank: { sheet: 'src/console/console.css' },
  reused: { sheet: 'src/console/console.css' },
  row: { sheet: 'src/console/console.css' },
  run: { sheet: 'src/console/console.css' },
  running: { sheet: 'src/console/console.css' },
  selected: { sheet: 'src/devtools/panel.css' },
  sidebar: { sheet: 'src/console/console.css' },
  sidepanel: { sheet: 'src/sidepanel/sidepanel.css' },
  skipped: { sheet: 'src/console/console.css' },
  spin: { sheet: 'src/console/console.css' },
  spinner: { sheet: 'src/console/console.css' },
  stale: { sheet: 'src/console/console.css' },
  success: { sheet: 'src/console/console.css' },
  tab: { sheet: 'src/console/console.css' },
  thr: { sheet: 'src/console/console.css' },
  toc: { sheet: 'src/docs/theme.css', permanent: true },
  toggle: { sheet: 'src/popup/popup.css' },
  toolbar: { sheet: 'src/console/console.css' },
  ttl: { sheet: 'src/console/console.css' },
  uncertain: { sheet: 'src/console/console.css' },
  unused: { sheet: 'src/console/console.css' },
  version: { sheet: 'src/popup/popup.css' },
  warn: { sheet: 'src/console/console.css' },
  warning: { sheet: 'src/console/console.css' },
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
  for (const p of [...GLOBAL_SHEETS, 'dist/console/app.css']) {
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

  it('no DOM class equals a top-level selector in app.css', () => {
    const topLevel = topLevelSelectorClasses(
      readFileSync(join(ROOT, 'dist', 'console', 'app.css'), 'utf8'),
    );
    const offenders = [...union.keys()]
      .filter((n) => topLevel.has(n))
      .map((n) => `${n} @ ${union.get(n)!.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('the on class is gone', () => {
    expect(union.has('on')).toBe(false);
  });
});
