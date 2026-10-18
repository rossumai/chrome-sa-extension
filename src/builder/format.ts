// src/builder/format.ts
// Python formatting for formula fields, by Ruff's WebAssembly build. The ~11MB formatter is
// its own bundle (dist/console/ruff.js + ruff.wasm, see src/builder/ruffEntry.ts), loaded by
// a same-package <script> the first time someone clicks Format — like the Mermaid renderer.

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

let pending: Promise<PythonFormatter> | null = null;

function loadRuff(): Promise<PythonFormatter> {
  if (window.__builderRuffFormat) return Promise.resolve(window.__builderRuffFormat);
  if (pending) return pending;
  pending = new Promise<PythonFormatter>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'ruff.js';
    script.onload = () =>
      window.__builderRuffFormat
        ? resolve(window.__builderRuffFormat)
        : reject(new Error('the formatter loaded but did not register'));
    script.onerror = () => reject(new Error('failed to load the formatter'));
    document.head.appendChild(script);
  });
  pending.catch(() => {
    pending = null; // a later click may retry
  });
  return pending;
}

/** The formatter, loading it on first use. */
export const ruffFormat: PythonFormatter = async (src) => (await loadRuff())(src);
