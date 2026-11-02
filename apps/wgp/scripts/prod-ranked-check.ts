/**
 * Checks the ranked loop against a real database without leaving a trace: inside one
 * transaction that is always rolled back, a throwaway player gets a hero, starts a run, a bot
 * plays the night through game-core, the server verifies it by replay, and the score is read
 * back from Tonight's board.
 *
 *   DATABASE_URL=… pnpm exec tsx scripts/prod-ranked-check.ts
 */
import { chooseErrand, needsErrand, runHash, runLog, startRun as startClientRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";

import { getDb } from "../src/server/db/client";
import { topEntries } from "../src/server/db/leaderboard";
import { ensureSave } from "../src/server/db/players";
import { startRun, submitRun } from "../src/server/db/runs";
import { givePlayerHero, makePlayer } from "../src/server/db/test-helpers";

class Rollback extends Error {}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
  const db = await getDb();
  const handle = `rollback-check-${Date.now().toString(36)}`;
  let report: Record<string, unknown> = {};
  try {
    await db.transaction(async (tx) => {
      const player = await makePlayer(tx, handle);
      await givePlayerHero(tx, player.id);
      const issuedAt = new Date();
      const started = await startRun(tx, { playerId: player.id, now: issuedAt });
      const { save } = await ensureSave(tx, player.id);

      const run = startClientRun(save, started.seed);
      if (run.error) throw new Error(run.error);
      const mem = newBotMemory();
      while (!run.over && !run.error && run.sim.tick < 54_000) {
        if (needsErrand(run)) chooseErrand(run, 0);
        else stepRun(run, botFrame(run.sim, mem));
      }

      // Submit as if the night's game time had passed on the wall clock.
      const submittedAt = new Date(issuedAt.getTime() + Math.ceil(run.sim.tick / 60) * 1000 + 5000);
      const result = await submitRun(tx, { playerId: player.id, runId: started.runId, log: runLog(run), clientHash: runHash(run), now: submittedAt });
      const day = submittedAt.toISOString().slice(0, 10);
      const board = await topEntries(tx, "tonight", day);
      const mine = board.find((r) => r.handle === handle);
      report = { status: result.status, score: result.status === "verified" ? result.score : null, reason: result.status === "rejected" ? result.reason : null, onTonightBoard: !!mine, boardScore: mine?.score ?? null, ticks: run.sim.tick };
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  console.log(JSON.stringify(report));
  process.exit(report.status === "verified" && report.onTonightBoard ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
