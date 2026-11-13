import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Unit tests for server code and pure helpers. UI is checked in the browser, not here. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // PGlite-backed tests are slow when many files run at once; give them room.
  // src/test/no-network.ts fails any test that makes a real network request.
  test: { include: ["src/**/*.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 30_000, setupFiles: ["./src/test/no-network.ts"] },
});
