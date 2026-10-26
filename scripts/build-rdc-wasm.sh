#!/bin/sh
# Builds rdc's wasm bindings from a local rdc checkout into vendor/rdc/ (git-ignored),
# for the experimental rdc Console app. build.js copies them into dist/ when present.
#
#   scripts/build-rdc-wasm.sh <path-to-rdc-checkout>     (or RDC_DIR=<path>)
#
# Needs the wasm32-unknown-unknown target and wasm-bindgen-cli at EXACTLY the version
# <rdc>/wasm/Cargo.toml pins: the CLI refuses a module built by another wasm-bindgen.
# To switch to a pinned release download later, replace the build steps below with a
# download that writes the same three files into vendor/rdc/.
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
cp "$TMP/rdc_wasm.js" "$TMP/rdc_wasm_bg.wasm" "$TMP/rdc_wasm.d.ts" "$OUT/"
echo "wrote $OUT (rdc_wasm.js, rdc_wasm_bg.wasm, rdc_wasm.d.ts)"
