import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wgp/game-core"],
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
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
