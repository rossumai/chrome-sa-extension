#!/bin/sh
# DEVELOPER OVERRIDE. Normal builds use the rdc release pinned in rdc-wasm.json (see
# scripts/rdc-vendor.cjs). This builds rdc's wasm bindings from a local rdc checkout into
# vendor/rdc/ (git-ignored) instead, with a `{ "local": … }` marker. Only a build run with
# RDC_WASM_LOCAL=1 uses it; a plain `npm run build` replaces it with the pinned release.
#
#   scripts/build-rdc-wasm.sh <path-to-rdc-checkout>     (or RDC_DIR=<path>)
#   RDC_WASM_LOCAL=1 npm run build
#
# Needs the wasm32-unknown-unknown target and wasm-bindgen-cli at EXACTLY the version
# <rdc>/wasm/Cargo.toml pins: the CLI refuses a module built by another wasm-bindgen.
set -eu

RDC="${1:-${RDC_DIR:-}}"
if [ -z "$RDC" ]; then
  echo "usage: $0 <path-to-rdc-checkout>   (or set RDC_DIR)" >&2
  exit 2
fi
if [ ! -f "$RDC/wasm/Cargo.toml" ]; then
  echo "error: $RDC/wasm/Cargo.toml not found — is $RDC an rdc checkout?" >&2
  exit 2
fi

OUT="$(cd "$(dirname "$0")/.." && pwd)/vendor/rdc"

# The pin, from a line like: wasm-bindgen = "=0.2.129"
PIN="$(sed -n 's/^wasm-bindgen *= *"=\([0-9][0-9.]*\)".*/\1/p' "$RDC/wasm/Cargo.toml")"
if [ -z "$PIN" ]; then
  echo "error: no exact wasm-bindgen pin (\"=X.Y.Z\") in $RDC/wasm/Cargo.toml" >&2
  exit 1
fi
if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "error: wasm-bindgen not installed; run: cargo install wasm-bindgen-cli --version $PIN --locked" >&2
  exit 1
fi
HAVE="$(wasm-bindgen --version | awk '{print $2}')"
if [ "$HAVE" != "$PIN" ]; then
  echo "error: wasm-bindgen $HAVE installed, rdc pins $PIN; run: cargo install wasm-bindgen-cli --version $PIN --locked" >&2
  exit 1
fi

# --target-dir pins where the module lands, whatever CARGO_TARGET_DIR says.
(cd "$RDC/wasm" && cargo build --release --target wasm32-unknown-unknown --target-dir "$RDC/wasm/target")

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
wasm-bindgen --target web --out-dir "$TMP" "$RDC/wasm/target/wasm32-unknown-unknown/release/rdc_wasm.wasm"

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$TMP/rdc_wasm.js" "$TMP/rdc_wasm_bg.wasm" "$TMP/rdc_wasm.d.ts" "$TMP/rdc_wasm_bg.wasm.d.ts" "$OUT/"
printf '{\n  "local": "%s"\n}\n' "$(cd "$RDC" && pwd)" > "$OUT/.source.json"
echo "wrote $OUT from $RDC — build with RDC_WASM_LOCAL=1 npm run build to use it"
