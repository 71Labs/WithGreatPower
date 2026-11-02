import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestDb, queryRows } from "./client";

describe("migrations", () => {
  it("apply to a fresh PGlite database", async () => {
    const db = await createTestDb();
    const rows = await queryRows<{ table_name: string }>(
      db,
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const tables = rows.map((r) => r.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "auth_sessions",
        "budget_counters",
        "chain_ops",
        "items_mirror",
        "leaderboard_entries",
        "players",
        "runs",
        "saves",
        "seasons",
        "session_keys",
      ]),
    );
  });
});
