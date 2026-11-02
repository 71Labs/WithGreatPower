import { defineConfig } from "drizzle-kit";

/**
 * `pnpm --filter wgp exec drizzle-kit generate` writes SQL migrations into ./drizzle from
 * the schema. `drizzle-kit migrate` applies them to DATABASE_URL (a Neon branch); PGlite
 * (local dev and tests) applies the same folder on boot, see src/server/db/client.ts.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
