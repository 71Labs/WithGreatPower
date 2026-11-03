#!/usr/bin/env bash
# Packs apps/wgp/public/models/*.glb in place with compress.mjs (meshopt, see there). The tools
# are pinned and installed into a throwaway directory, so they never become dependencies:
#
#   apps/wgp/scripts/models/compress.sh [file.glb ...]     (default: every model)
#
# launch/brand/hero/make.sh runs it after writing new models.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MODELS="$(cd "$HERE/../../public/models" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

files=()
if [[ $# -gt 0 ]]; then
  for f in "$@"; do files+=("$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"); done
else
  files=("$MODELS"/*.glb)
fi

cp "$HERE/compress.mjs" "$TMP/"
cd "$TMP"
echo '{"type":"module","private":true}' > package.json
npm install --silent --no-audit --no-fund \
  @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@1.1.1
node compress.mjs "${files[@]}"
