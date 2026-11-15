import { defineConfig } from "vitest/config";

// Some simulation tests replay whole nights for many seeds. They take a few seconds on an idle
// machine and many more on a busy one, so the default 5 s limit fails them under load
// (STACK_TRACE_ERROR) although nothing is wrong. A longer default changes no test's assertions.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000 },
});
