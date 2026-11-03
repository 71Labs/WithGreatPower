#!/usr/bin/env bash
# Rebuilds The Node end to end. Blender 5.1 with the MPFB extension enabled; nothing is
# downloaded (the preview step loads the header's Google Fonts, like ../render.sh).
#
#   launch/brand/hero/make.sh            body, three renders, backdrop, previews, hero.glb and
#                                        the game's models and clips (apps/wgp/public/models)
#   launch/brand/hero/make.sh renders    just the renders and previews
#   launch/brand/hero/make.sh cast       just the rest of the cast (build_cast.py, cast.py) and
#                                        their extra clips: apps/wgp/public/models/cast-*.glb
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
BLEND=build/hero-base.blend
step="${1:-all}"
MODELS="$HERE/../../../apps/wgp/public/models"

cast() {
  # Each character on its own MPFB body, the same skeleton as the hero's (~1 min each).
  for who in aunt-mainnet uncle-gen mary-jpeg bearson gwei gas-goblin sandwich-man doc-octochain sybil; do
    blender -b -P build_cast.py -- --who "$who"
  done
  # The cast's extra clips (interact, crouch, spell cast, sword stance, treading water).
  blender -b "$BLEND" -P retarget.py -- --cast --out "$MODELS/cast-anims.glb"
}

# The game loads packed files (meshopt): pack whatever was just written.
pack() {
  "$HERE/../../../apps/wgp/scripts/models/compress.sh"
}

if [[ "$step" == cast ]]; then
  cast
  pack
  exit 0
fi

if [[ "$step" == all ]]; then
  blender -b -P build.py
fi
blender -b "$BLEND" -P render.py -- --pose a --out hero-swing.png
blender -b "$BLEND" -P render.py -- --pose b --out hero-swing-b.png
blender -b "$BLEND" -P render.py -- --pose c --out hero-swing-c.png
if [[ "$step" == all ]]; then
  # Frames captured from the game (see backdrop.py); 27 is the header's, 43 the alternate.
  python3 backdrop.py build/frames/play-027.png --keep right --out ../art/city-backdrop.png
  python3 backdrop.py build/frames/play-043.png --keep right --out city-backdrop-alt.png
fi
python3 preview.py --hero hero-swing.png --out preview-header.png
python3 preview.py --hero hero-swing-b.png --out preview-header-b.png
python3 preview.py --hero hero-swing-c.png --out preview-header-c.png
if [[ "$step" == all ]]; then
  blender -b "$BLEND" -P export.py
  blender -b "$BLEND" -P export.py -- --game --tris 16000 --out "$MODELS/hero.glb"
  blender -b "$BLEND" -P export.py -- --game --tris 5000 --out "$MODELS/hero-lo.glb"
  # The motion: Quaternius' UAL (mocap/, CC0) retargeted onto the same skeleton.
  blender -b "$BLEND" -P retarget.py -- --out "$MODELS/hero-anims.glb"
  cast
  pack
fi
