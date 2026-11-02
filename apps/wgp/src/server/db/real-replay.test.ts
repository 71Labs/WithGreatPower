/**
 * The whole ranked loop with the real verifier: the server issues a run, a bot plays the
 * night through game-core in "the browser", the log is submitted, the server replays it,
 * and the score lands on the board. No fakes between the client and the database.
 */
import { chooseErrand, needsErrand, runHash, runLog, startRun as startClientRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { Save } from "@wgp/game-core/types";
import { describe, expect, it } from "vitest";

import { setVerifier } from "../verify";
import { topEntries } from "./leaderboard";
import { ensureSave } from "./players";
import { startRun, submitRun } from "./runs";
import { freshDb, givePlayerHero, makePlayer } from "./test-helpers";

/** Plays a night as the client would: same save, same seed, the bot's inputs recorded. */
function playNight(save: Save, seed: number) {
  const run = startClientRun(save, seed);
  if (run.error) throw new Error(run.error);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) {
    if (needsErrand(run)) chooseErrand(run, 0);
    else stepRun(run, botFrame(run.sim, mem));
  }
  return { log: runLog(run), hash: runHash(run), ticks: run.sim.tick };
}

describe("a ranked night with the real verifier", () => {
  it("verifies a bot-played night, saves it and ranks it", async () => {
    setVerifier(undefined);
    const db = await freshDb();
    const player = await makePlayer(db, "replayer");
    await givePlayerHero(db, player.id);

    const issuedAt = new Date("2026-11-06T20:00:00Z");
    const started = await startRun(db, { playerId: player.id, now: issuedAt });
    const { save } = await ensureSave(db, player.id);
    const played = playNight(save, started.seed);

    // Submit after the night's game time has passed on the wall clock.
    const submittedAt = new Date(issuedAt.getTime() + Math.ceil(played.ticks / 60) * 1000 + 5000);
    const result = await submitRun(db, { playerId: player.id, runId: started.runId, log: played.log, clientHash: played.hash, now: submittedAt });

    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(result.score).toBeGreaterThan(0);
    expect(result.ticks).toBe(played.ticks);

    const board = await topEntries(db, "tonight", "2026-11-06");
    expect(board[0]?.score).toBe(result.score);
  }, 60_000);

  it("rejects a log that was tampered with", async () => {
    setVerifier(undefined);
    const db = await freshDb();
    const player = await makePlayer(db, "cheater");
    await givePlayerHero(db, player.id);

    const issuedAt = new Date("2026-11-06T20:00:00Z");
    const started = await startRun(db, { playerId: player.id, now: issuedAt });
    const { save } = await ensureSave(db, player.id);
    const played = playNight(save, started.seed);

    // Claim a different outcome than the inputs produce.
    const submittedAt = new Date(issuedAt.getTime() + Math.ceil(played.ticks / 60) * 1000 + 5000);
    const result = await submitRun(db, { playerId: player.id, runId: started.runId, log: played.log, clientHash: "deadbeef", now: submittedAt });
    expect(result.status).toBe("rejected");
  }, 60_000);
});
