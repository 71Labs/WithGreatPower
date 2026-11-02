import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Unit tests for server code and pure helpers. UI is checked in the browser, not here. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
