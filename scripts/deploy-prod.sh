#!/usr/bin/env bash
# Deploy origin/main to production on Vercel, from a clean worktree.
#
#   scripts/deploy-prod.sh
#
# The Vercel project builds apps/wgp. The licensed Neue Montreal webfonts are not in git, so
# they're copied in from this checkout's apps/wgp/public/fonts before the upload; without
# them the site falls back to Inter. Needs a logged-in Vercel CLI and apps/wgp/.vercel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WT="$(mktemp -d)/wgp-deploy"
cleanup() { git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true; }
trap cleanup EXIT

git -C "$ROOT" fetch -q origin main
git -C "$ROOT" worktree add -q --detach "$WT" origin/main
echo "Deploying $(git -C "$WT" log --oneline -1)"

mkdir -p "$WT/.vercel" "$WT/apps/wgp/public/fonts"
cp "$ROOT/apps/wgp/.vercel/project.json" "$WT/.vercel/project.json"
fonts=("$ROOT"/apps/wgp/public/fonts/NeueMontreal-*.woff2)
if [[ -e "${fonts[0]}" ]]; then
  cp "${fonts[@]}" "$WT/apps/wgp/public/fonts/"
  echo "With ${#fonts[@]} Neue Montreal files"
else
  echo "No Neue Montreal files in apps/wgp/public/fonts; the site will use Inter"
fi

(cd "$WT" && vercel deploy --prod --yes)
