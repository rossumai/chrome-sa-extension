// src/builder/format.ts
// Python formatting for formula fields, by Ruff's WebAssembly build. The ~11MB formatter is
// its own bundle (dist/console/ruff.js + ruff.wasm, see src/builder/ruffEntry.ts), loaded by
// a same-package <script> the first time someone clicks Format — like the Mermaid renderer.

import { lazyScript } from '../ui/lazyScript.js';

export type PythonFormatter = (src: string) => Promise<string>;
export type FormatResult = { ok: true; text: string } | { ok: false; error: string };

declare global {
  interface Window {
    __builderRuffFormat?: PythonFormatter;
  }
}

/** Format `src`; a syntax error or a failed load comes back as a message, never a throw. */
export async function formatPython(src: string, format: PythonFormatter): Promise<FormatResult> {
  try {
    const out = await format(src);
    return { ok: true, text: out.replace(/\n+$/, '') };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

const loadRuff = lazyScript('ruff.js', () => window.__builderRuffFormat, 'the formatter');

/** The formatter, loading it on first use. */
export const ruffFormat: PythonFormatter = async (src) => (await loadRuff())(src);
