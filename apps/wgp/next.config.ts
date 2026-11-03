import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { NextConfig } from "next";

const PUBLIC = join(process.cwd(), "public");

/**
 * A short hash of everything under public/<dir>: the `?v=` the app puts on those files' URLs
 * (src/lib/assets.ts), so they can be cached for good and still change with a deploy.
 */
function version(dir: string): string {
  const root = join(PUBLIC, dir);
  if (!existsSync(root)) return "";
  const hash = createHash("sha256");
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(path.slice(root.length)).update(readFileSync(path));
    }
  };
  walk(root);
  return hash.digest("hex").slice(0, 12);
}

/** Versioned URLs never change content: a year, no revalidation. */
const IMMUTABLE = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];

const nextConfig: NextConfig = {
  transpilePackages: ["@wgp/game-core"],
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  env: {
    WGP_MODELS_V: version("models"),
    WGP_AUDIO_V: version("audio"),
    WGP_MEDIA_V: version("media"),
    // The licensed webfonts are copied in at deploy (scripts/deploy-prod.sh), never committed.
    WGP_NEUE_MONTREAL: existsSync(join(PUBLIC, "fonts", "NeueMontreal-Regular.woff2")) ? "1" : "",
  },
  images: {
    // AVIF where the browser takes it (about a fifth smaller than WebP for the landing's stills).
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    const versioned = (source: string) => ({ source, has: [{ type: "query" as const, key: "v" }], headers: IMMUTABLE });
    return [
      versioned("/models/:path*"),
      versioned("/audio/:path*"),
      versioned("/media/:path*"),
      // The webfonts change only with a new licence drop: a week, then refreshed in the background.
      { source: "/fonts/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
