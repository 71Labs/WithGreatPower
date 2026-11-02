/**
 * Fills a local PGlite database with players and scores so /play/leaderboard has
 * something to show. `PGLITE_DIR=… pnpm --filter wgp exec tsx src/server/db/seed-dev.ts`
 * (stop `next dev` first: PGlite is single-process). Never runs against DATABASE_URL.
 */
import { newSave, reduce } from "@wgp/game-core/engine";
import type { SuitId } from "@wgp/game-core/types";

import { utcDay } from "@/server/rate-limit";

import { openPglite } from "./client";
import { ALLTIME_PERIOD, countEntries, recordScore } from "./leaderboard";
import { ensureSave, findOrCreatePlayer, writeSave } from "./players";
import { runs } from "./schema";

const SUITS: SuitId[] = ["classic", "midnight", "mint", "snow"];
const NAMES = ["peter", "miles", "gwen", "mj", "harry", "ned", "felicia", "eddie", "kraven", "otto", "norman", "may", "ben", "jonah", "betty", "flash"];

async function main() {
  if (process.env.DATABASE_URL) throw new Error("seed-dev only seeds PGlite; unset DATABASE_URL");
  const dir = process.env.PGLITE_DIR;
  if (!dir) throw new Error("Set PGLITE_DIR");
  const db = await openPglite(dir);
  const count = Number(process.env.SEED_PLAYERS ?? 60);
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const handle = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ""}`;
    const player = await findOrCreatePlayer(db, { nearAccountId: `${handle}.wgp.testnet`, authKind: "near_auth", authSub: `seed:${handle}`, handle });
    const { rev } = await ensureSave(db, player.id);
    const save = reduce(newSave(), { type: "create-hero", name: handle[0].toUpperCase() + handle.slice(1), suit: SUITS[i % SUITS.length], powers: ["web-sling", "web-shield", "node-sense"] });
    await writeSave(db, player.id, save, rev);
    const score = 24_000 - i * 350 + (i % 3) * 40;
    const [run] = await db
      .insert(runs)
      .values({ playerId: player.id, night: 1, seed: i, ruleset: "seed", saveRevAtStart: rev, startSave: save, status: "verified", issuedAt: now, expiresAt: now, verifiedScore: score, ticks: 18_000 + i })
      .returning({ id: runs.id });
    await db.transaction((tx) => recordScore(tx, { playerId: player.id, runId: run.id, score, ticks: 18_000 + i, issuedAt: now, now }));
  }
  console.log(`tonight ${utcDay(now)}: ${await countEntries(db, "tonight", utcDay(now))} · alltime: ${await countEntries(db, "alltime", ALLTIME_PERIOD)}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
