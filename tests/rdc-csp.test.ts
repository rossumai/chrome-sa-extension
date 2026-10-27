import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The extension pages' CSP is the MV3 default plus exactly 'wasm-unsafe-eval', which the
// WebAssembly of rdc and of the Builder's Ruff formatter needs (the default refuses to compile
// any wasm). Nothing else: no 'unsafe-eval', no remote script source.
describe('manifest CSP', () => {
  it('is exactly the default plus wasm-unsafe-eval', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'manifest.json'), 'utf8'));
    expect(manifest.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    });
  });
});
