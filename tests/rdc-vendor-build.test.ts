import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
// build.js's own helper, so this pins what the build does rather than a copy of it.
import { RDC_CSP, hasRdcVendor, withRdcCsp } from '../scripts/rdc-vendor.cjs';

const ROOT = process.cwd();
const source = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

// The rdc proof of concept relaxes the extension-page CSP by 'wasm-unsafe-eval' ONLY in a
// build that has vendor/rdc/ — never in a clean checkout, which is what CI and every Web Store
// release build.
describe('rdc vendor build and the CSP', () => {
  it('the committed manifest declares no CSP', () => {
    expect(source).not.toHaveProperty('content_security_policy');
  });

  it('without the vendor build the manifest is unchanged', () => {
    expect(withRdcCsp(source, false)).toEqual(source);
    expect(withRdcCsp(source, false)).not.toHaveProperty('content_security_policy');
  });

  it('with the vendor build it gains exactly the wasm CSP', () => {
    expect(RDC_CSP).toBe("script-src 'self' 'wasm-unsafe-eval'; object-src 'self';");
    expect(withRdcCsp(source, true)).toEqual({
      ...source,
      content_security_policy: { extension_pages: RDC_CSP },
    });
  });

  it('the built dist/ matches whether vendor/rdc/ exists', () => {
    const built = join(ROOT, 'dist', 'manifest.json');
    if (!existsSync(built))
      throw new Error('run `npm run build` before this test — it inspects dist/');
    const manifest = JSON.parse(readFileSync(built, 'utf8'));
    const glue = existsSync(join(ROOT, 'dist', 'console', 'rdc', 'rdc_wasm_bg.wasm'));
    if (hasRdcVendor(ROOT)) {
      expect(manifest.content_security_policy).toEqual({ extension_pages: RDC_CSP });
      expect(glue).toBe(true);
    } else {
      expect(manifest).not.toHaveProperty('content_security_policy');
      expect(glue).toBe(false);
    }
  });
});
