/**
 * The database handle. Neon (serverless Pool over WebSockets, so interactive
 * transactions work) when DATABASE_URL is set; otherwise PGlite: on disk under
 * ./.data/pglite for local dev, in memory for tests. PGlite applies ./drizzle on boot;
 * Neon is migrated ahead of deploys with `drizzle-kit migrate`.
 *
 * PGlite is single-process: run one `next dev` per data directory.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "./schema";

export type Schema = typeof schema;
/** Either driver, or a transaction on either (PgTransaction extends PgDatabase). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

interface Holder {
  db?: Promise<Db>;
  override?: Db;
}

// Survives dev hot reloads, so one PGlite instance holds the data directory.
const g = globalThis as typeof globalThis & { __wgpDb?: Holder };
const holder: Holder = (g.__wgpDb ??= {});

/** Where the generated SQL migrations live (apps/wgp/drizzle). */
export function migrationsFolder(): string {
  return process.env.WGP_MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle");
}

export function getDb(): Promise<Db> {
  if (holder.override) return Promise.resolve(holder.override);
  holder.db ??= connect().catch((error: unknown) => {
    holder.db = undefined;
    throw error;
  });
  return holder.db;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const [{ Pool }, { drizzle }] = await Promise.all([import("@neondatabase/serverless"), import("drizzle-orm/neon-serverless")]);
    const pool = new Pool({ connectionString: url, max: 5 });
    return drizzle({ client: pool, schema });
  }
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is not set");
  return openPglite(process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite"));
}

/** Rows of a raw SQL query. Both drivers answer `{ rows }`; the shared Db type can't say so. */
export async function queryRows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

/** A migrated PGlite database: on disk at `dataDir`, or in memory without one. */
export async function openPglite(dataDir?: string): Promise<Db> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}

/** A fresh in-memory database with every migration applied. */
export function createTestDb(): Promise<Db> {
  return openPglite();
}

/** Points getDb() at `db` (tests), or back at the real connection with undefined. */
export function setDb(db: Db | undefined): void {
  holder.override = db;
}
