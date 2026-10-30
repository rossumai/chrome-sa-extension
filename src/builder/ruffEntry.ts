// Separate esbuild entry: dist/console/ruff.js, script-injected on demand by
// src/builder/format.ts. Ruff's formatter is ~11MB of WebAssembly, so it stays out of
// console.js. The .wasm is copied next to it by build.js and fetched relative to the page.
import init, { Workspace, PositionEncoding } from '@astral-sh/ruff-wasm-web';

let workspace: Workspace | null = null;

window.__builderRuffFormat = async (src: string) => {
  if (!workspace) {
    await init({ module_or_path: 'ruff.wasm' });
    workspace = new Workspace(Workspace.defaultSettings(), PositionEncoding.Utf16);
  }
  return workspace.format(src);
};
