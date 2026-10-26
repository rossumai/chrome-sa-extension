// The experimental rdc Console app's build step, kept out of build.js so a test can pin it.
//
// vendor/rdc/ (git-ignored, written by scripts/build-rdc-wasm.sh) holds rdc's wasm-bindgen
// output. When it is present, build.js copies the glue and the module into dist/console/rdc/
// and relaxes the extension-page CSP by exactly 'wasm-unsafe-eval': Chrome's default MV3 CSP
// (`script-src 'self'`) refuses to compile any WebAssembly — measured in Chrome for Testing
// 156. When it is absent (a clean checkout, CI, every Web Store release) the manifest is left
// untouched and the app says the build is missing. Shipping the app for real needs that CSP
// in manifest.json itself — a decision not taken yet.
const { existsSync } = require('fs');
const { join } = require('path');

const RDC_VENDOR_DIR = 'vendor/rdc';
// Copied into dist/console/rdc/; the .d.ts is for people, not for the browser.
const RDC_SHIPPED_FILES = ['rdc_wasm.js', 'rdc_wasm_bg.wasm'];
const RDC_CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";

function hasRdcVendor(root = '.') {
  return RDC_SHIPPED_FILES.every((f) => existsSync(join(root, RDC_VENDOR_DIR, f)));
}

// A new manifest object; with the vendor build, the one extra key.
function withRdcCsp(manifest, hasVendor) {
  if (!hasVendor) return { ...manifest };
  return { ...manifest, content_security_policy: { extension_pages: RDC_CSP } };
}

module.exports = { RDC_VENDOR_DIR, RDC_SHIPPED_FILES, RDC_CSP, hasRdcVendor, withRdcCsp };
