/**
 * How long the cast art (src/components/cast) takes to build its paths, and a fingerprint of
 * every avatar's SVG, so a speed-up can prove it draws exactly the same thing.
 *
 *   apps/wgp/node_modules/.bin/tsx --tsconfig apps/wgp/tsconfig.json apps/wgp/scripts/perf/cast-art-bench.tsx
 */
import { createHash } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";

async function main() {
  const t0 = performance.now();
  const { AVATARS, HeroArt, NODE_COLORS } = await import("../../src/components/cast/avatars");
  const ms = performance.now() - t0;
  const svgs = Object.entries(AVATARS).map(([id, Avatar]) => `${id}:${renderToStaticMarkup(<Avatar />)}`);
  svgs.push(`hero:${renderToStaticMarkup(<HeroArt {...NODE_COLORS} />)}`);
  const hash = createHash("sha256").update(svgs.join("\n")).digest("hex").slice(0, 16);
  console.log(`module load ${ms.toFixed(0)} ms, ${svgs.length} avatars, ${svgs.join("").length} chars of SVG, sha256 ${hash}`);
}

void main();
