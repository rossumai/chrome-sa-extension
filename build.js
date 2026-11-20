const esbuild = require('esbuild');
const { execSync } = require('child_process');
const { cpSync, existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } = require('fs');

// The Console's global stylesheet, dist/console/console.base.css, is assembled from these
// partials: the tokens, and the few rules no CSS Module can hold (global.css). They are what
// is left of the former src/console/console.css monolith once every area moved to CSS Modules.
// Each `/* @order N */` comment in a partial starts a segment, and consoleBaseCss() emits the
// segments of every partial by N — the monolith's original rule order. The order of this list
// does not matter; a rule's N does. Do not add a partial: new styles go in a *.module.css.
// Exported for tests/console-css-split.test.ts, which requires this file without building.
const CONSOLE_GLOBAL_PARTS = [
  'src/console/tokens.css',
  'src/console/global.css',
];
// Text before a partial's first marker (its header comment) is not emitted.
function consoleBaseCss() {
  const segments = [];
  for (const part of CONSOLE_GLOBAL_PARTS) {
    for (const seg of readFileSync(part, 'utf8').split(/(?=\/\* @order \d+ \*\/)/).slice(1)) {
      segments.push({ n: Number(/\d+/.exec(seg)[0]), seg });
    }
  }
  return segments.sort((a, b) => a.n - b.n).map((s) => s.seg).join('');
}
module.exports = { CONSOLE_GLOBAL_PARTS, consoleBaseCss };
if (require.main !== module) return;

const isWatch = process.argv.includes('--watch');

// ── Git-based versioning ───────────────────────────
const gitHash = execSync('git rev-parse --short HEAD').toString().trim();
const commitCount = Number(execSync('git rev-list --count HEAD').toString().trim());
const chromeMajor = Math.floor(commitCount / 65535);
const chromeMinor = commitCount % 65535;
const chromeVersion = `${chromeMajor}.${chromeMinor}`;

rmSync('dist', { recursive: true, force: true });

for (const dir of ['dist/popup', 'dist/icons', 'dist/console', 'dist/devtools', 'dist/sidepanel']) {
  mkdirSync(dir, { recursive: true });
}

// Inject version + version_name into manifest.json
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = chromeVersion;
manifest.version_name = gitHash;
writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');

cpSync('icons', 'dist/icons', { recursive: true });
cpSync('src/popup/popup.html', 'dist/popup/popup.html');
// The popup, side panel and DevTools pages link their GLOBAL tokens.css first (copied), and
// then the sheet esbuild emits beside each bundle from its imported *.module.css
// (dist/popup/popup.css, …). tokens.css is deliberately NOT named after a bundle, so esbuild can
// never write over it.
cpSync('src/popup/tokens.css', 'dist/popup/tokens.css');
cpSync('src/console/console.html', 'dist/console/console.html');
// The global base stylesheet: the partials (CONSOLE_GLOBAL_PARTS, above), merged in their
// original rule order by consoleBaseCss(). esbuild emits dist/console/app.css from the imported
// CSS Modules, which hold every other Console style. console.html links both (base first, then
// the modules).
writeFileSync('dist/console/console.base.css', consoleBaseCss());
cpSync('src/devtools/devtools.html', 'dist/devtools/devtools.html');
cpSync('src/devtools/panel.html', 'dist/devtools/panel.html');
cpSync('src/devtools/tokens.css', 'dist/devtools/tokens.css');
// The side panel links ../popup/tokens.css, then the sheet its bundle emits — which carries the
// popup's own MDH card modules, so the card has one source of truth.
cpSync('src/sidepanel/sidepanel.html', 'dist/sidepanel/sidepanel.html');

const options = {
  entryPoints: {
    'scripts/rossum': 'src/rossum/index.ts',
    'scripts/netsuite': 'src/netsuite/index.ts',
    'scripts/coupa': 'src/coupa/index.ts',
    'popup/popup': 'src/popup/popup.tsx',
    'console/app': 'src/console/index.tsx',
    // The print page's own script (dist/console/print.html → doc-print.js). A real extension
    // page rather than a blob: URL, because a blob inherits the creator's CSP and could not
    // run an inline script — measured during the port.
    'console/doc-print': 'src/docs/printEntry.ts',
    // Lazy-loaded by the Fabry chat's MermaidBlock (script-injected on the
    // first mermaid fence): beautiful-mermaid ships one flat ~1.5MB module,
    // so it gets its own bundle instead of weighing down app.js.
    'console/mermaid': 'src/fabry/mermaidEntry.ts',
    // Lazy-loaded by the Builder's Format button (src/builder/format.ts): Ruff's Python
    // formatter as WebAssembly, ~11MB, so it gets its own bundle; ruff.wasm is copied below.
    'console/ruff': 'src/builder/ruffEntry.ts',
    'background': 'src/background/index.ts',
    'devtools/devtools': 'src/devtools/devtools.ts',
    'devtools/panel': 'src/devtools/panel.tsx',
    'sidepanel/sidepanel': 'src/sidepanel/index.tsx',
  },
  bundle: true,
  // Full minification, INCLUDING identifier renaming — which also shortens CSS
  // Modules' local class names (e.g. Academy.module.css's `.heroBlobA`) into
  // one/two-character globals emitted to dist/console/app.css. esbuild only
  // guarantees those generated names are unique AMONG THEMSELVES, not against
  // hand-written classes in JSX or a global sheet. That is not hypothetical: a
  // generated `.k` once painted a 320px blurred hero blob across the Inspector's
  // `class="k"` cells, and a generated `.on` a square on every active control.
  //
  // What keeps this safe is NOT the minifier — it is that a generated name never
  // contains a hyphen, and every hand-written class does, enforced on every run
  // by tests/css-class-collision-boundary.test.ts against the BUILT sheets.
  // Adding a hyphen-less class outside `styles.x` fails that test. Turning
  // identifier minification off would also fix it, but costs ~774KB on app.js.
  minify: true,
  outdir: 'dist',
  format: 'iife',
  logLevel: 'info',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
};

// ── Document stylesheets (src/docs/, the localpages port) ─────────────────────
// Both surfaces that render a document — the Architect's preview pane and the print
// page — are extension pages, so they LINK these as ordinary stylesheets and nothing
// needs inlining. (Until 2026-08-18 they were also baked, together with a client
// bundle, into a `doc-assets.js` registrar the Console injected on demand: an exported
// ZIP had to be self-contained. That export was removed, and the registrar with it.)
function copyDocStylesheets() {
  cpSync('node_modules/github-markdown-css/github-markdown.css', 'dist/console/github-markdown.css');
  cpSync('src/docs/theme.css', 'dist/console/doc-theme.css');
  writeFileSync('dist/console/hljs-github.css', hljsCombinedCss());
  // The print page links the three sheets above plus its own extras.
  cpSync('src/docs/print.html', 'dist/console/print.html');
  cpSync('src/docs/print.css', 'dist/console/print.css');
  // The Builder's formatter binary, fetched by dist/console/ruff.js relative to the page.
  cpSync('node_modules/@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm', 'dist/console/ruff.wasm');
}

function hljsCombinedCss() {
  const light = readFileSync('node_modules/highlight.js/styles/github.css', 'utf8');
  const dark = readFileSync('node_modules/highlight.js/styles/github-dark.css', 'utf8');
  return `${light}\n@media (prefers-color-scheme: dark) {\n${dark}\n}\n`;
}


// The experimental rdc app's wasm, from the OPTIONAL dependency @mrtnzlml/rdc-wasm. It lives on
// GitHub Packages, which needs a token even to install, so a clone without one (CI and the
// Web Store release included) has no package and builds without it; the app then says so.
// RDC_WASM_DIR points at a local wasm-bindgen build instead (for example `.rdc-wasm-local/pkg`,
// git-ignored), to try an unreleased rdc without touching package.json.
const RDC_PKG = process.env.RDC_WASM_DIR || 'node_modules/@mrtnzlml/rdc-wasm';
function copyRdcWasm() {
  if (!existsSync(`${RDC_PKG}/rdc_wasm_bg.wasm`)) {
    console.log(`rdc wasm: no rdc_wasm_bg.wasm in ${RDC_PKG}, building without the rdc app`);
    return;
  }
  mkdirSync('dist/console/rdc', { recursive: true });
  for (const f of ['rdc_wasm.js', 'rdc_wasm_bg.wasm']) cpSync(`${RDC_PKG}/${f}`, `dist/console/rdc/${f}`);
}

// The popup and the side panel build in a pass of their own. esbuild allocates minified CSS
// Module names across the WHOLE build, so in one pass every popup module renamed the Console's
// classes too (and could hand one a name a hand-written Console class still uses). Their own
// pass keeps each surface's names independent of the other's modules.
const OWN_PASS = ['popup/popup', 'sidepanel/sidepanel'];
const pass = (own) => ({
  ...options,
  entryPoints: Object.fromEntries(
    Object.entries(options.entryPoints).filter(([out]) => OWN_PASS.includes(out) === own),
  ),
});
const passes = [pass(false), pass(true)];

copyRdcWasm();
if (isWatch) {
  // Once, up front: the watcher rebuilds JS only, so re-run `npm run build` after editing a
  // stylesheet or an HTML page.
  copyDocStylesheets();
  for (const o of passes) esbuild.context(o).then((ctx) => ctx.watch());
} else {
  for (const o of passes) esbuild.buildSync(o);
  copyDocStylesheets();
}
