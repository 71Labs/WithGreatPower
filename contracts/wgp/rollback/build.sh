#!/usr/bin/env bash
# Builds the rollback wasm: the v2 contract exactly as it runs on mainnet (commit BASE),
# plus v2-rollback.patch, which teaches its `migrate` to read a v3 state.
#
#   bash contracts/wgp/rollback/build.sh
#     -> contracts/wgp/target/near/wgp-v2-rollback.wasm
#
# The live v2 wasm can't be used to roll back: its `migrate` refuses a v3 state (the
# upgrade fails whole and v3 stays). This one converts the v3 root back to the v2 layout,
# as long as no Bits are invested (send stakes home first: `market_refund`), and leaves
# the token index and metadata roots under the `V3TAIL` storage key so a later upgrade to
# v3 finds them again. See docs/CONTRACT-V3.md, "Rolling back".
set -euo pipefail

BASE=e88271ffd2f9c0e62362e15fe5a7bfc039bdb319
root="$(git rev-parse --show-toplevel)"
out="$root/contracts/wgp/target/near/wgp-v2-rollback.wasm"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git -C "$root" archive "$BASE" contracts/wgp | tar -x -C "$work"
patch -s -d "$work/contracts/wgp" -p1 < "$root/contracts/wgp/rollback/v2-rollback.patch"
(cd "$work/contracts/wgp" && cargo near build non-reproducible-wasm --locked)
mkdir -p "$(dirname "$out")"
cp "$work/contracts/wgp/target/near/wgp.wasm" "$out"
node "$root/scripts/near/check-wasm-imports.mjs" "$out"
echo "  $(wc -c < "$out" | tr -d ' ') bytes -> $out"
